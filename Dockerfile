# ── Playwright 공식 Python 이미지 (Chromium 포함) ──────────────────────────
FROM mcr.microsoft.com/playwright/python:v1.58.0-noble

WORKDIR /app

# ── Python 의존성 ────────────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── 앱 소스 복사 ─────────────────────────────────────────────────────────────
COPY server.py .
COPY site/ ./site/

# ── 포트 노출 ────────────────────────────────────────────────────────────────
EXPOSE 8765

# ── 실행 ─────────────────────────────────────────────────────────────────────
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
