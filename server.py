"""
MyGrade Backend Server
======================
FastAPI 서버:
  - GET  /          → site/ 정적 파일 서빙
  - POST /api/fetch → NEIS+ 자동 로그인 후 렌더링된 생기부 HTML 반환

실행:
  python server.py
  (또는) uvicorn server:app --host 0.0.0.0 --port 8765
"""

import asyncio
import traceback

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from playwright.async_api import async_playwright

# ── 앱 초기화 ────────────────────────────────────────────────────────────────
app = FastAPI(title="MyGrade API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── 요청 모델 ────────────────────────────────────────────────────────────────
class ScrapeRequest(BaseModel):
    userId: str
    password: str


# ── 커스텀 예외 ──────────────────────────────────────────────────────────────
class LoginError(Exception):
    pass

class ContentError(Exception):
    pass


# ── API 엔드포인트 ────────────────────────────────────────────────────────────
@app.post("/api/fetch")
async def fetch_data(req: ScrapeRequest):
    """
    NEIS+ 에 로그인하여 학교생활기록부 HTML을 반환합니다.
    반환값: { ok: true, html: "<rendered html>" }
    오류:   { detail: "..." }  (HTTP 4xx/5xx)
    """
    try:
        html = await scrape_neis_html(req.userId, req.password)
        return JSONResponse({"ok": True, "html": html})

    except LoginError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except ContentError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"서버 오류: {e}")


# ── Playwright 스크래퍼 ───────────────────────────────────────────────────────
async def scrape_neis_html(user_id: str, password: str) -> str:
    """
    1. NEIS+ OAuth 로그인
    2. /csp-std/#/std-edi/edi-slf/edi-slf-lh010 (학생부 조회 페이지) 이동
    3. Angular가 성적 테이블을 DOM 에 렌더링할 때까지 대기
    4. page.content() 로 완성된 HTML 반환
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context  = await browser.new_context(
            # 한국어 로케일 설정 (NEIS 인코딩 안정성 향상)
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = await context.new_page()

        try:
            # ── 1. 로그인 페이지 이동 ─────────────────────────────────────
            print("[1] 로그인 페이지로 이동...")
            await page.goto("https://www.neisplus.kr/")
            await page.evaluate(
                "window.location.href = "
                "'/oauth/oauth_csp_login_nxt.jsp?redirectUri=/csp-std/'"
            )
            await page.wait_for_url("**/SCSP_CLOUD/login.do", timeout=15_000)
            print(f"    → {page.url}")

            # ── 2. 학생 로그인 탭 클릭 ───────────────────────────────────
            print("[2] 학생 로그인 탭 선택...")
            # '로그인' 버튼이 여러 개일 때 두 번째가 학생 탭
            await page.get_by_role("button", name="로그인").nth(1).click()
            await page.wait_for_timeout(800)

            # ── 3. 아이디 / 비밀번호 입력 ────────────────────────────────
            print("[3] 인증 정보 입력...")
            await page.locator("input").nth(0).fill(user_id)
            await page.locator("input").nth(1).fill(password)

            # ── 4. 로그인 클릭 & 리다이렉트 대기 ─────────────────────────
            print("[4] 로그인 시도 중...")
            try:
                async with page.expect_navigation(
                    url="**/csp-std/**", timeout=20_000
                ):
                    await page.get_by_role("button", name="학생 로그인").click()
            except Exception:
                # 아직 로그인 페이지에 머물러 있으면 인증 실패
                if any(k in page.url for k in ("login.do", "SCSP_CLOUD", "oauth")):
                    # 오류 메시지가 있으면 추출
                    err_msg = await page.evaluate(
                        "() => document.querySelector('.error-msg, .alert, [class*=error]')?.textContent?.trim() || ''"
                    )
                    detail = err_msg or "아이디 또는 비밀번호가 올바르지 않습니다."
                    raise LoginError(detail)
                raise

            print(f"    → 로그인 성공: {page.url}")

            # ── 5. 학생부 조회 페이지 이동 ────────────────────────────────
            target = "https://www.neisplus.kr/csp-std/#/std-edi/edi-slf/edi-slf-lh010"
            print(f"[5] 학생부 페이지 이동 중...")
            await page.goto(target)

            # ── 6. 성적 테이블 렌더링 대기 ────────────────────────────────
            print("[6] Angular 렌더링 대기 중...")
            try:
                await page.wait_for_function(
                    """() => {
                        const tables = document.querySelectorAll('table');
                        return Array.from(tables).some(t =>
                            t.textContent.includes('학기') &&
                            t.textContent.includes('교과') &&
                            t.textContent.includes('과목')
                        );
                    }""",
                    timeout=25_000,
                )
            except Exception:
                raise ContentError(
                    "성적 테이블을 찾을 수 없습니다. "
                    "학교생활기록부 조회 권한이 있는지 확인하세요."
                )

            # 세특/행특 div.wsBs 로딩 추가 대기
            print("[7] 세특/행특 로딩 대기 중...")
            try:
                await page.wait_for_selector("div.wsBs", timeout=12_000)
                # 모든 wsBs 가 채워질 시간 여유
                await page.wait_for_timeout(1500)
            except Exception:
                print("    ⚠ wsBs 없음 — 성적만 처리합니다.")
                await page.wait_for_timeout(2000)

            # ── 7. 렌더링된 HTML 캡처 ────────────────────────────────────
            print("[8] 페이지 HTML 캡처...")
            html = await page.content()

            # 최소 유효성 검사
            if "학기" not in html or len(html) < 5000:
                raise ContentError("페이지 내용이 올바르게 로드되지 않았습니다.")

            print(f"    → 완료  ({len(html):,} bytes)")
            return html

        finally:
            await browser.close()


# ── 정적 파일 (API 라우트 이후에 마운트) ────────────────────────────────────
app.mount("/", StaticFiles(directory="site", html=True), name="static")


# ── 직접 실행 ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("=" * 55)
    print("  MyGrade Backend  →  http://localhost:8765")
    print("  API              →  POST /api/fetch")
    print("=" * 55)
    uvicorn.run("server:app", host="0.0.0.0", port=8765, reload=False)
