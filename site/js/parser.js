
/**
 * NEIS HTML Parser
 * Extracts student records from the uploaded HTML file.
 */

export function parseNeisHtml(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Find all tables
    const tables = Array.from(doc.querySelectorAll('table'));

    const records = [];

    tables.forEach(table => {
        // Check headers to identify table type
        const headers = Array.from(table.querySelectorAll('thead th, tbody tr:first-child td')).map(th => th.textContent.replace(/\s+/g, '').trim());
        const headerText = headers.join('|');

        // Identify Grade Tables
        const isGradeTable = (headerText.includes('학기') && headerText.includes('교과') && headerText.includes('과목') && (headerText.includes('단위') || headerText.includes('학점')));

        if (isGradeTable) {
            // Parse Rows
            const rows = Array.from(table.querySelectorAll('tbody tr'));

            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 5) return; // invalid row

                const ths = Array.from(table.querySelectorAll('thead th'));
                let map = {
                    semester: -1, kyogwa: -1, name: -1, credit: -1,
                    raw: -1, achievement: -1, rank: -1
                };

                ths.forEach((th, idx) => {
                    const txt = th.textContent.replace(/\s+/g, '');
                    if (txt.includes('학기')) map.semester = idx;
                    else if (txt.includes('교과')) map.kyogwa = idx;
                    else if (txt.includes('과목') && !txt.includes('평균') && !txt.includes('원점수')) map.name = idx;
                    else if (txt.includes('단위') || txt.includes('학점')) map.credit = idx;
                    else if (txt.includes('원점수')) map.raw = idx;
                    else if (txt.includes('성취도')) map.achievement = idx;
                    else if (txt.includes('석차등급')) map.rank = idx;
                });

                if (map.name === -1) {
                    map = { semester: 0, kyogwa: 1, name: 2, credit: 3, raw: 4, achievement: 5, rank: 6 };
                }

                const getText = (idx) => (cells[idx] ? cells[idx].textContent.trim() : "");

                const kyogwa = getText(map.kyogwa);
                const name = getText(map.name);
                const creditStr = getText(map.credit);
                const rawStr = getText(map.raw);
                const achStr = getText(map.achievement);
                const rankStr = getText(map.rank);

                if (!name || name === "과목") return; // Header row in tbody

                const credit = parseFloat(creditStr) || 0;

                let raw = null, mean = null, std = null;
                if (rawStr && !rawStr.includes("·")) {
                    const cleanRaw = rawStr.replace(' ', '');
                    if (cleanRaw.includes('/')) {
                        const parts = cleanRaw.split('/');
                        raw = parseFloat(parts[0]);
                        if (parts[1]) {
                            const stats = parts[1];
                            if (stats.includes('(')) {
                                const [m, s] = stats.split('(');
                                mean = parseFloat(m);
                                std = parseFloat(s.replace(')', ''));
                            } else {
                                mean = parseFloat(stats);
                            }
                        }
                    }
                }

                let achievement = achStr;
                if (achievement.includes('(')) {
                    achievement = achievement.split('(')[0].trim();
                }

                let rank = null;
                if (rankStr && !isNaN(rankStr)) {
                    rank = rankStr;
                }

                records.push({
                    semester: getText(map.semester),
                    kyogwa,
                    name,
                    credit,
                    raw, mean, std,
                    achievement,
                    rank
                });
            });
        }
    });

    // --- Extract Creative Experiential Activities (by grade) ---
    const creative = {
        grade1: { autonomy: '', club: '', career: '' },
        grade2: { autonomy: '', club: '', career: '' },
        grade3: { autonomy: '', club: '', career: '' }
    };

    // Find table rows and extract div.wsBs or tbl-inherit content
    const allRows = Array.from(doc.querySelectorAll('tr'));

    allRows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) return;

        // Find grade number (usually in first cell with rowspan)
        let grade = null;
        cells.forEach(cell => {
            const cellText = cell.textContent.trim();
            if (cellText === '1' || cellText === '2' || cellText === '3') {
                const rowspan = cell.getAttribute('rowspan');
                if (rowspan && parseInt(rowspan) >= 3) {
                    grade = parseInt(cellText);
                }
            }
        });

        // Find activity type and content
        const rowText = row.textContent.replace(/\s+/g, '');
        let activityType = null;

        if (rowText.includes('자율활동')) activityType = 'autonomy';
        else if (rowText.includes('동아리활동')) activityType = 'club';
        else if (rowText.includes('진로활동')) activityType = 'career';

        if (activityType && grade) {
            // Try div.wsBs first
            let content = '';
            const wsBsDiv = row.querySelector('div.wsBs');
            if (wsBsDiv) {
                content = wsBsDiv.textContent.trim();
            } else {
                // Fallback to tbl-inherit
                const tblInherit = row.querySelector('.tbl-inherit.ng-star-inserted');
                if (tblInherit) {
                    content = tblInherit.textContent.trim();
                }
            }

            if (content && content.length > 10) {
                const gradeKey = `grade${grade}`;
                if (creative[gradeKey]) {
                    creative[gradeKey][activityType] = content;
                }
            }
        }
    });

    // --- Extract Behavior (by grade) ---
    const behavior = {
        grade1: '',
        grade2: '',
        grade3: ''
    };

    allRows.forEach(row => {
        const rowText = row.textContent.replace(/\s+/g, '');

        if (rowText.includes('행동특성') && rowText.includes('종합의견')) {
            const cells = Array.from(row.querySelectorAll('td'));

            // Find grade number
            let grade = null;
            cells.forEach(cell => {
                const cellText = cell.textContent.trim();
                if (cellText === '1' || cellText === '2' || cellText === '3') {
                    grade = parseInt(cellText);
                }
            });

            // Extract content
            let content = '';
            const wsBsDiv = row.querySelector('div.wsBs');
            if (wsBsDiv) {
                content = wsBsDiv.textContent.trim();
            } else {
                const tblInherit = row.querySelector('.tbl-inherit.ng-star-inserted');
                if (tblInherit) {
                    content = tblInherit.textContent.trim();
                }
            }

            if (content && content.length > 10 && grade) {
                const gradeKey = `grade${grade}`;
                if (behavior[gradeKey] !== undefined) {
                    behavior[gradeKey] = content;
                }
            }
        }
    });

    // --- Extract Special Remarks (SeTeuk) ---
    const seteuk = {
        subjects: {},
        individual: ''
    };

    // Scan for SeTeuk in div.wsBs elements
    const detailSections = Array.from(doc.querySelectorAll('div.wsBs'));

    detailSections.forEach((section) => {
        const text = section.innerText || section.textContent;
        if (text.length < 20) return;

        // Skip if this is creative activities or behavior (already extracted)
        let isAlreadyExtracted = false;
        Object.values(creative).forEach(gradeData => {
            if (gradeData.autonomy === text || gradeData.club === text || gradeData.career === text) {
                isAlreadyExtracted = true;
            }
        });
        Object.values(behavior).forEach(behaviorText => {
            if (behaviorText === text) isAlreadyExtracted = true;
        });

        if (isAlreadyExtracted) return;

        const entries = text.split(/\n\s*\n/);

        entries.forEach(entry => {
            entry = entry.trim();
            if (!entry) return;

            const firstColon = entry.indexOf(':');
            if (firstColon > -1 && firstColon < 20) {
                let subjectName = entry.substring(0, firstColon).trim();
                const content = entry.substring(firstColon + 1).trim();

                if (subjectName.includes('학기)')) {
                    subjectName = subjectName.split('학기)').pop().trim();
                }

                if (subjectName.includes('개인별')) {
                    seteuk.individual += content + '\n';
                } else if (subjectName && content) {
                    seteuk.subjects[subjectName] = content;
                }
            }
        });
    });

    return { records, seteuk, creative, behavior };
}
