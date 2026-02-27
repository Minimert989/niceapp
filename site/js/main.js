
import { parseNeisHtml } from './parser.js';
import { calculateGrades } from './calculator.js';

document.addEventListener('DOMContentLoaded', () => {

    // ── 엘리먼트 참조 ──────────────────────────────────────────────────
    const dropZone      = document.getElementById('dropZone');
    const fileInput     = document.getElementById('fileInput');
    const uploadSection = document.getElementById('uploadSection');
    const dashboard     = document.getElementById('dashboard');
    const backBtn       = document.getElementById('backBtn');

    // 로그인 폼 요소
    const loginBtn      = document.getElementById('loginBtn');
    const loginBtnText  = document.getElementById('loginBtnText');
    const loginSpinner  = document.getElementById('loginSpinner');
    const loginIdInput  = document.getElementById('loginId');
    const loginPwInput  = document.getElementById('loginPw');
    const loginError    = document.getElementById('loginError');

    // ── 상태 ───────────────────────────────────────────────────────────
    let byteDataState   = {};
    let currentData     = null;   // calculateGrades 결과 전체 보관
    let barChart        = null;
    let lineChart       = null;
    let pieChart        = null;

    // ── 탭 전환 ────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`tab-${tabName}`).classList.remove('hidden');

            // 차트 탭으로 전환할 때 지연 렌더 (hidden 상태에서 canvas 크기가 0일 수 있음)
            if (tabName === 'chart' && currentData) {
                setTimeout(() => renderCharts(currentData), 60);
            }
        });
    });

    // ── 로그인 폼: Enter 키 처리 ───────────────────────────────────────
    [loginIdInput, loginPwInput].forEach(inp => {
        if (inp) inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') loginBtn?.click();
        });
    });

    // ── 로그인 버튼 클릭 ────────────────────────────────────────────────
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const userId   = loginIdInput?.value.trim();
            const password = loginPwInput?.value;

            if (!userId || !password) {
                showLoginError('아이디와 비밀번호를 모두 입력하세요.');
                return;
            }

            setLoginLoading(true);
            hideLoginError();

            try {
                const apiBase = (window.API_BASE_URL || '').replace(/\/$/, '');
                const res  = await fetch(`${apiBase}/api/fetch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, password }),
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: '서버 오류' }));
                    throw new Error(err.detail || `HTTP ${res.status}`);
                }

                const { html } = await res.json();
                if (!html) throw new Error('서버에서 빈 응답을 반환했습니다.');

                processContent(html);

            } catch (err) {
                showLoginError(err.message || '불러오기 실패. 다시 시도해주세요.');
            } finally {
                setLoginLoading(false);
            }
        });
    }

    function setLoginLoading(on) {
        if (!loginBtn) return;
        loginBtn.disabled       = on;
        loginBtnText.textContent = on ? '불러오는 중...' : '자동 불러오기';
        loginSpinner?.classList.toggle('hidden', !on);
    }

    function showLoginError(msg) {
        if (!loginError) return;
        loginError.textContent = msg;
        loginError.classList.remove('hidden');
    }

    function hideLoginError() {
        loginError?.classList.add('hidden');
    }

    // ── 뒤로가기 버튼 ──────────────────────────────────────────────────
    backBtn.addEventListener('click', () => {
        dashboard.classList.add('hidden');
        uploadSection.classList.remove('hidden');
        fileInput.value = '';

        [barChart, lineChart, pieChart].forEach(c => { if (c) c.destroy(); });
        barChart = lineChart = pieChart = null;
        currentData = null;

        // 탭 초기화
        document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
        document.querySelectorAll('.tab-content').forEach((c, i) => c.classList.toggle('hidden', i !== 0));
    });

    // ── 드래그 앤 드롭 ─────────────────────────────────────────────────
    dropZone.addEventListener('click',     () => fileInput.click());
    dropZone.addEventListener('dragover',  e  => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    // ── 파일 처리 ──────────────────────────────────────────────────────
    function handleFile(file) {
        if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
            alert('HTML 파일을 업로드해주세요.');
            return;
        }
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const buffer = e.target.result;
                let decoder = new TextDecoder('utf-8');
                let content = decoder.decode(buffer);

                // UTF-8 디코딩 실패 시 EUC-KR 재시도
                if (!content.includes('학기') && !content.includes('과목') && !content.includes('성명')) {
                    console.log('UTF-8 키워드 없음 → EUC-KR 재시도');
                    decoder = new TextDecoder('euc-kr');
                    content  = decoder.decode(buffer);
                }
                processContent(content);
            } catch (err) {
                console.error(err);
                alert('파일 처리 중 오류: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function processContent(html) {
        const { records, seteuk, creative, behavior } = parseNeisHtml(html);

        if (!records || records.length === 0) {
            alert('성적 데이터를 찾을 수 없습니다.\n올바른 NEIS 생기부 HTML 파일인지 확인하세요.');
            return;
        }

        const result   = calculateGrades(records);
        currentData    = result;

        renderDashboard(result, seteuk, creative, behavior);

        // 화면 전환
        uploadSection.classList.add('hidden');
        dashboard.classList.remove('hidden');

        // 버튼 이벤트
        document.getElementById('btnDownloadTxt').onclick = () => downloadTxt(result, seteuk, creative, behavior);
        document.getElementById('btnPrint').onclick       = () => window.print();

        // 파이차트는 바로 렌더 (score-row 영역에 항상 표시)
        renderPieChart(result);
    }

    // ── 대시보드 렌더 ──────────────────────────────────────────────────
    function renderDashboard(data, seteuk, creative, behavior) {
        // 연세대 점수
        setEl('yonseiScore',   data.yonsei.finalScore.toFixed(2));
        setEl('yonseiCommon',  data.yonsei.common.term.toFixed(2));
        setEl('yonseiGeneral', data.yonsei.general.term.toFixed(2));
        setEl('yonseiCareer',  data.yonsei.career.term.toFixed(2));
        setEl('yonseiPenalty', '-' + data.yonsei.penalty.toFixed(2));

        // 단순 평균등급
        setEl('gpaAll',   data.simple.all.toFixed(2));
        setEl('gpaKem',   data.simple.kem.toFixed(2));
        setEl('gpaKems',  data.simple.kems.toFixed(2));
        setEl('gpaKemss', data.simple.kemss.toFixed(2));

        // 성적표 탭
        renderTable(data.details);
        setupFilters(data);

        // 세특 탭
        renderSeteuk(seteuk, behavior);

        // 바이트 계산기 탭
        renderByteCalculator(creative, seteuk, behavior);
    }

    function setEl(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    // ── 성적표 테이블 ───────────────────────────────────────────────────
    function renderTable(records) {
        const tbody = document.getElementById('gradeTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        records.forEach(r => {
            const tr = document.createElement('tr');
            const badgeClass = r.type === 'General' ? 'badge-general'
                             : r.type === 'Career'  ? 'badge-career'
                             :                        'badge-common';
            const typeLabel  = r.type === 'Common'  ? '공통'
                             : r.type === 'General' ? '일반'
                             : r.type === 'Career'  ? '진로' : '-';
            const rankHtml   = r.rank
                ? `<span class="rank-badge rank-${r.rank}">${r.rank}</span>`
                : '<span style="color:var(--muted)">-</span>';

            tr.innerHTML = `
                <td>${r.semester   || '-'}</td>
                <td class="kyogwa-cell">${r.kyogwa || '-'}</td>
                <td class="subject-name">${r.name}</td>
                <td>${r.credit}</td>
                <td>${rankHtml}</td>
                <td>${r.achievement || '-'}</td>
                <td>${r.raw  !== null && r.raw  !== undefined ? r.raw  : '-'}</td>
                <td>${r.mean !== null && r.mean !== undefined ? r.mean : '-'}</td>
                <td>${r.std  !== null && r.std  !== undefined ? r.std  : '-'}</td>
                <td><span class="badge ${badgeClass}">${typeLabel}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    function setupFilters(data) {
        const semesterSet = new Set(data.details.map(r => r.semester).filter(Boolean));
        const kyogwaSet   = new Set(data.details.map(r => r.kyogwa).filter(Boolean));

        const fSem = document.getElementById('filterSemester');
        const fCat = document.getElementById('filterCategory');

        if (fSem) {
            fSem.innerHTML = '<option value="">전체 학기</option>';
            [...semesterSet].sort().forEach(s => {
                const o = document.createElement('option');
                o.value = s; o.textContent = s;
                fSem.appendChild(o);
            });
        }
        if (fCat) {
            fCat.innerHTML = '<option value="">전체 교과</option>';
            [...kyogwaSet].sort().forEach(k => {
                const o = document.createElement('option');
                o.value = k; o.textContent = k;
                fCat.appendChild(o);
            });
        }

        const refilter = () => {
            const sv = fSem?.value;
            const cv = fCat?.value;
            renderTable(data.details.filter(r =>
                (!sv || r.semester === sv) && (!cv || r.kyogwa === cv)
            ));
        };

        if (fSem) fSem.onchange = refilter;
        if (fCat) fCat.onchange = refilter;
    }

    // ── 세특 열람 ───────────────────────────────────────────────────────
    function renderSeteuk(seteuk, behavior) {
        const container = document.getElementById('seteukContainer');
        if (!container) return;
        container.innerHTML = '';
        let hasContent = false;

        // 과목별 세특
        if (seteuk && Object.keys(seteuk.subjects).length > 0) {
            const sec = createSection('📚 과목별 세부능력 및 특기사항');
            for (const [subj, content] of Object.entries(seteuk.subjects)) {
                createDetailItem(sec, subj, content);
            }
            container.appendChild(sec);
            hasContent = true;
        }

        // 개인별 세특
        if (seteuk?.individual) {
            const sec = createSection('👤 개인별 세부능력');
            createDetailItem(sec, '개인별 세특', seteuk.individual);
            container.appendChild(sec);
            hasContent = true;
        }

        // 행동특성 — behavior는 { grade1, grade2, grade3 } 객체이므로 순회
        if (behavior) {
            const sec = createSection('🏫 행동특성 및 종합의견');
            let added = false;
            ['grade1', 'grade2', 'grade3'].forEach((key, i) => {
                if (behavior[key]) {
                    createDetailItem(sec, `${i + 1}학년`, behavior[key]);
                    hasContent = true;
                    added = true;
                }
            });
            if (added) container.appendChild(sec);
        }

        if (!hasContent) {
            container.innerHTML = '<p class="empty-msg">세특/행특 데이터를 찾을 수 없습니다.</p>';
        }
    }

    function createSection(title) {
        const div = document.createElement('div');
        div.className = 'seteuk-section';
        div.innerHTML = `<h3 class="seteuk-section-title">${title}</h3>`;
        return div;
    }

    function createDetailItem(container, title, content) {
        const div = document.createElement('div');
        div.className = 'detail-item';
        div.innerHTML = `
            <span class="detail-title">${escHtml(title)}</span>
            <p class="detail-content">${escHtml(String(content))}</p>
        `;
        container.appendChild(div);
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ── 바이트 계산기 ───────────────────────────────────────────────────
    function getByteLength(str) {
        if (!str) return 0;
        let b = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if      (c === 10)  b += 2;  // 줄바꿈 LF
            else if (c > 127)   b += 3;  // 한글 등 멀티바이트
            else                b += 1;  // ASCII
        }
        return b;
    }

    function renderByteCalculator(creative, seteuk, behavior) {
        const select = document.getElementById('byteSelector');
        if (!select) return;

        byteDataState = {};
        const add = (key, content, max) => {
            byteDataState[key] = { content: content || '', max };
        };

        // 창의적 체험활동
        if (creative) {
            ['grade1', 'grade2', 'grade3'].forEach((gk, i) => {
                const n = i + 1;
                const g = creative[gk];
                if (g?.autonomy) add(`${n}학년 자율활동`,   g.autonomy, 1500);
                if (g?.club)     add(`${n}학년 동아리활동`, g.club,     1500);
                if (g?.career)   add(`${n}학년 진로활동`,   g.career,   2100);
            });
        }

        // 행동특성
        if (behavior) {
            ['grade1', 'grade2', 'grade3'].forEach((gk, i) => {
                if (behavior[gk]) add(`${i + 1}학년 행동특성`, behavior[gk], 1500);
            });
        }

        // 개인별 세특
        if (seteuk?.individual) add('개인별 세특', seteuk.individual, 1500);

        // 과목별 세특
        if (seteuk?.subjects) {
            Object.entries(seteuk.subjects).forEach(([subj, content]) => {
                add(subj, content, 1500);
            });
        }

        // 셀렉트 옵션 생성
        select.innerHTML = '<option value="" disabled selected>항목을 선택하세요</option>';
        Object.keys(byteDataState).forEach(key => {
            const o = document.createElement('option');
            o.value = key; o.textContent = key;
            select.appendChild(o);
        });

        // 첫 번째 항목 자동 선택
        const firstKey = Object.keys(byteDataState)[0];
        if (firstKey) {
            select.value = firstKey;
            showByteItem(firstKey);
        }

        select.onchange = e => showByteItem(e.target.value);

        const textarea = document.getElementById('byteTextarea');
        if (textarea) {
            textarea.oninput = e => {
                const key = select.value;
                if (!key || !byteDataState[key]) return;
                byteDataState[key].content = e.target.value;
                updateByteDisplay(e.target.value, byteDataState[key].max);
            };
        }
    }

    function showByteItem(key) {
        const display     = document.getElementById('byteDisplay');
        const placeholder = document.getElementById('bytePlaceholder');
        const labelTitle  = document.getElementById('byteLabelTitle');
        const textarea    = document.getElementById('byteTextarea');
        if (!display || !placeholder || !labelTitle || !textarea) return;

        const data = byteDataState[key];
        if (!data) return;

        placeholder.classList.add('hidden');
        display.classList.remove('hidden');
        labelTitle.textContent = key;
        textarea.value = data.content;
        updateByteDisplay(data.content, data.max);
    }

    function updateByteDisplay(content, max) {
        const valueText   = document.getElementById('byteValueText');
        const progressBar = document.getElementById('byteProgressBar');
        if (!valueText || !progressBar) return;

        const bytes   = getByteLength(content);
        const percent = Math.min((bytes / max) * 100, 100);

        valueText.textContent     = `${bytes} / ${max} Byte`;
        progressBar.style.width   = `${percent}%`;
        progressBar.className     = 'progress-bar';
        valueText.style.color     = '';

        if (bytes > max) {
            progressBar.classList.add('progress-danger');
            valueText.style.color = 'var(--danger)';
        } else if (percent > 90) {
            progressBar.classList.add('progress-warning');
            valueText.style.color = 'var(--warning)';
        } else {
            progressBar.classList.add('progress-safe');
        }
    }

    // ── 차트 ────────────────────────────────────────────────────────────
    function catColor(cat, a) {
        const map = {
            K: [59,130,246], M: [239,68,68], E: [16,185,129],
            S: [139,92,246], Soc: [245,158,11], Other: [107,114,128]
        };
        const [r, g, b] = map[cat] || map.Other;
        return `rgba(${r},${g},${b},${a})`;
    }

    function renderPieChart(data) {
        const ctx = document.getElementById('yonseiPieChart')?.getContext('2d');
        if (!ctx || typeof Chart === 'undefined') return;
        if (pieChart) pieChart.destroy();

        pieChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['공통 (30%)', '일반 (50%)', '진로 (20%)'],
                datasets: [{
                    data: [
                        data.yonsei.common.term,
                        data.yonsei.general.term,
                        data.yonsei.career.term
                    ],
                    backgroundColor: ['#3b82f6', '#10b981', '#8b5cf6'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 11, padding: 10 }
                    },
                    tooltip: {
                        callbacks: { label: item => ` ${item.label}: ${item.raw.toFixed(2)}점` }
                    }
                }
            }
        });
    }

    function renderCharts(data) {
        // ── 막대차트: 과목별 석차등급 ─────────────────────────────────
        const ranked = data.details.filter(r => r.rank !== null);
        const barCtx = document.getElementById('gradeBarChart')?.getContext('2d');
        if (barCtx) {
            if (barChart) barChart.destroy();
            barChart = new Chart(barCtx, {
                type: 'bar',
                data: {
                    labels: ranked.map(r => r.name),
                    datasets: [{
                        label: '석차등급',
                        data:  ranked.map(r => r.rank),
                        backgroundColor: ranked.map(r => catColor(r.category, 0.7)),
                        borderColor:     ranked.map(r => catColor(r.category, 1)),
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            reverse: true, min: 0.5, max: 9.5,
                            ticks: { stepSize: 1, color: '#94a3b8' },
                            grid:  { color: 'rgba(255,255,255,0.05)' },
                            title: { display: true, text: '등급', color: '#94a3b8' }
                        },
                        x: {
                            ticks: { color: '#94a3b8', maxRotation: 50, font: { size: 11 } },
                            grid:  { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: items => ranked[items[0].dataIndex]?.name || '',
                                label: item  => [
                                    ` 등급: ${item.raw}`,
                                    ` 학기: ${ranked[item.dataIndex]?.semester}`,
                                    ` 교과: ${ranked[item.dataIndex]?.kyogwa}`
                                ]
                            }
                        }
                    }
                }
            });
        }

        // ── 꺾은선차트: 학기별 가중 평균등급 ─────────────────────────
        const semSum  = {};
        const semCred = {};
        data.details.forEach(r => {
            if (r.rank === null) return;
            const s = r.semester || '?';
            semSum[s]  = (semSum[s]  || 0) + r.rank * r.credit;
            semCred[s] = (semCred[s] || 0) + r.credit;
        });
        const semesters = Object.keys(semSum).sort();
        const semAvgs   = semesters.map(s => semSum[s] / semCred[s]);

        const lineCtx = document.getElementById('semesterLineChart')?.getContext('2d');
        if (lineCtx) {
            if (lineChart) lineChart.destroy();
            lineChart = new Chart(lineCtx, {
                type: 'line',
                data: {
                    labels: semesters,
                    datasets: [{
                        label: '가중 평균등급',
                        data: semAvgs,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99,102,241,0.1)',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true,
                        pointBackgroundColor: '#6366f1',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            reverse: true, min: 1, max: 9,
                            ticks: { stepSize: 1, color: '#94a3b8' },
                            grid:  { color: 'rgba(255,255,255,0.05)' },
                            title: { display: true, text: '등급', color: '#94a3b8' }
                        },
                        x: {
                            ticks: { color: '#94a3b8' },
                            grid:  { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: { label: item => ` 평균 ${item.raw.toFixed(2)}등급` }
                        }
                    }
                }
            });
        }
    }

    // ── TXT 다운로드 ────────────────────────────────────────────────────
    function downloadTxt(data, seteuk, creative, behavior) {
        const get = key => byteDataState[key]?.content || '';

        let t = `[나이스 생기부 분석 리포트]\n생성일: ${new Date().toLocaleString('ko-KR')}\n\n`;

        t += `━━━ 1. 점수 요약 ━━━\n`;
        t += `연세대 환산점수 : ${data.yonsei.finalScore.toFixed(2)}점\n`;
        t += `  공통(30%)    : ${data.yonsei.common.term.toFixed(2)}\n`;
        t += `  일반(50%)    : ${data.yonsei.general.term.toFixed(2)}\n`;
        t += `  진로(20%)    : ${data.yonsei.career.term.toFixed(2)}\n`;
        t += `  감점         : -${data.yonsei.penalty.toFixed(2)}\n`;
        t += `단순 평균등급 (전과목): ${data.simple.all.toFixed(2)}\n`;
        t += `단순 평균등급 (국영수): ${data.simple.kem.toFixed(2)}\n\n`;

        t += `━━━ 2. 과목별 성적 ━━━\n`;
        data.details.forEach(r => {
            t += `${r.semester} | ${r.kyogwa} | ${r.name} | 단위${r.credit} | `;
            t += r.rank ? `${r.rank}등급` : r.achievement;
            t += ` (${r.type})\n`;
        });
        t += '\n';

        t += `━━━ 3. 창의적 체험활동 ━━━\n`;
        ['grade1', 'grade2', 'grade3'].forEach((gk, i) => {
            const n = i + 1;
            const g = creative?.[gk];
            if (g && (g.autonomy || g.club || g.career)) {
                t += `\n[${n}학년]\n`;
                if (g.autonomy) t += `[자율활동]\n${get(`${n}학년 자율활동`)}\n\n`;
                if (g.club)     t += `[동아리활동]\n${get(`${n}학년 동아리활동`)}\n\n`;
                if (g.career)   t += `[진로활동]\n${get(`${n}학년 진로활동`)}\n\n`;
            }
        });

        t += `━━━ 4. 세부능력 및 특기사항 ━━━\n`;
        const skipKeys = new Set(['개인별 세특']);
        ['grade1', 'grade2', 'grade3'].forEach((_, i) => {
            const n = i + 1;
            ['자율활동','동아리활동','진로활동','행동특성'].forEach(v => skipKeys.add(`${n}학년 ${v}`));
        });
        Object.keys(byteDataState).forEach(key => {
            if (!skipKeys.has(key)) t += `[${key}]\n${byteDataState[key].content}\n\n`;
        });
        if (byteDataState['개인별 세특']?.content) {
            t += `[개인별 세특]\n${byteDataState['개인별 세특'].content}\n\n`;
        }

        t += `━━━ 5. 행동특성 및 종합의견 ━━━\n`;
        ['grade1', 'grade2', 'grade3'].forEach((gk, i) => {
            const n = i + 1;
            if (behavior?.[gk]) t += `\n[${n}학년]\n${get(`${n}학년 행동특성`)}\n`;
        });

        const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `생기부분석_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
    }

});
