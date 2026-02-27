
/**
 * Grade Calculator Logic
 * Ports the logic from calculate_grades.py
 */

// --- Constants & Tables ---

const RANK_SCORE_MAP = {
    1: 100, 2: 95, 3: 87.5, 4: 75, 5: 60,
    6: 40, 7: 25, 8: 12.5, 9: 5
};

const RANK_PERCENTILE_MAP = {
    1: 0.04, 2: 0.11, 3: 0.23, 4: 0.40, 5: 0.60,
    6: 0.77, 7: 0.89, 8: 0.96, 9: 1.00
};

const CAREER_SCORE_MAP = { 'A': 100, 'B': 75, 'C': 50 };

const COMMON_SUBJECTS = new Set([
    "국어", "수학", "영어", "한국사", "통합사회", "통합과학", "과학탐구실험"
]);

// --- Utilities ---

// Standard Normal CDF approximation (Abramowitz and Stegun)
function normCdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989423 * Math.exp(-x * x / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (x > 0) {
        p = 1 - p;
    }
    return p;
}

function roundHalfUp(n, decimals = 0) {
    const multiplier = Math.pow(10, decimals);
    return Math.round(n * multiplier) / multiplier; // JS Math.round handles .5 correctly for positive numbers mostly
}

function getCategory(subjectInfo) {
    const kyogwa = (subjectInfo.kyogwa || "").trim();
    const name = (subjectInfo.name || "").trim();

    if (kyogwa === '국어') return 'K';
    if (kyogwa === '수학') return 'M';
    if (kyogwa === '영어') return 'E';
    if (kyogwa === '과학') return 'S';
    if (kyogwa === '사회(역사/도덕포함)' || kyogwa === '한국사') return 'Soc';

    if (name.includes('국어')) return 'K';

    return 'Other';
}

// --- Main Calculation Logic ---

export function calculateGrades(records) {
    // 1. Enrich Records with Category and Type
    const processedRecords = records.map(r => {
        // Determine Rank (convert string to number if needed)
        let rank = null;
        if (r.rank && !isNaN(r.rank)) {
            rank = parseFloat(r.rank);
        }

        // Determine Category
        const category = getCategory({ kyogwa: r.kyogwa, name: r.name });

        // Determine Type (Common, General, Career, Other)
        let type = "Other";

        if (COMMON_SUBJECTS.has(r.name.trim())) {
            type = "Common";
        }

        // Logic Refinement
        if (rank !== null && rank >= 1 && rank <= 9) {
            if (type === "Other") type = "General";
        } else if (['A', 'B', 'C'].includes(r.achievement)) {
            if (type === "Common" && rank === null) {
                // Pass (e.g. Science Lab)
            } else {
                type = "Career";
            }
        }

        return { ...r, rank, category, type };
    });

    // 2. Simple GPA Calculations
    const simpleGPAs = {
        all: calculateSimpleGPA(processedRecords, new Set(['K', 'M', 'E', 'S', 'Soc', 'Other'])),
        kem: calculateSimpleGPA(processedRecords, new Set(['K', 'E', 'M'])),
        kems: calculateSimpleGPA(processedRecords, new Set(['K', 'E', 'M', 'S'])),
        kemss: calculateSimpleGPA(processedRecords, new Set(['K', 'E', 'M', 'S', 'Soc']))
    };

    // 3. Yonsei Calculation
    const yonsei = calculateYonsei(processedRecords);

    return {
        simple: simpleGPAs,
        yonsei: yonsei,
        details: processedRecords
    };
}

function calculateSimpleGPA(records, validCategories) {
    let totalWeightedRank = 0;
    let totalCredits = 0;

    for (const r of records) {
        if (validCategories.has(r.category) && r.rank !== null) {
            totalWeightedRank += r.credit * r.rank;
            totalCredits += r.credit;
        }
    }

    return totalCredits === 0 ? 0 : (totalWeightedRank / totalCredits);
}

function calculateYonsei(records) {
    const refACats = new Set(['K', 'M', 'E', 'S', 'Soc']);

    const commonItems = [];
    const generalItems = [];
    const careerItems = [];
    const refBItems = [];

    for (const r of records) {
        const isRefA = refACats.has(r.category);

        if (!isRefA) {
            refBItems.push(r);
            continue;
        }

        if (r.type === 'Common') {
            if (r.rank !== null) commonItems.push(r);
        } else if (r.type === 'General') {
            if (r.rank !== null) generalItems.push(r);
        } else if (r.type === 'Career') {
            if (['A', 'B', 'C'].includes(r.achievement)) careerItems.push(r);
        }
    }

    const commonStats = calcGroupScore(commonItems);
    const generalStats = calcGroupScore(generalItems);

    // Career Score
    let scoreCareer = 0;
    let totalCareerCredit = 0;
    for (const r of careerItems) {
        const point = CAREER_SCORE_MAP[r.achievement] || 0;
        scoreCareer += r.credit * point;
        totalCareerCredit += r.credit;
    }
    if (totalCareerCredit > 0) scoreCareer /= totalCareerCredit;

    // Penalty
    let badCredits = 0;
    let totalBCredits = 0;
    for (const r of refBItems) {
        totalBCredits += r.credit;
        let isBad = false;
        if (r.rank === 9) isBad = true;
        if (r.achievement === 'C') isBad = true;
        if (isBad) badCredits += r.credit;
    }
    const penalty = totalBCredits > 0 ? (badCredits / totalBCredits) * 5 : 0;

    // Final
    // (Common * 0.3) + (General * 0.5) + (Career * 0.2) - Penalty
    const commonTerm = ((commonStats.rankAvg + commonStats.zAvg) / 2) * 0.3;
    const generalTerm = ((generalStats.rankAvg + generalStats.zAvg) / 2) * 0.5;
    const careerTerm = scoreCareer * 0.2;

    const finalScore = commonTerm + generalTerm + careerTerm - penalty;

    return {
        common: { ...commonStats, term: commonTerm },
        general: { ...generalStats, term: generalTerm },
        career: { avg: scoreCareer, term: careerTerm },
        penalty: penalty,
        finalScore: finalScore
    };
}

function calcGroupScore(items) {
    if (!items || items.length === 0) return { rankAvg: 0, zAvg: 0 };

    let totalCredit = 0;
    let sumRankScore = 0;
    let sumZScoreVal = 0;

    for (const r of items) {
        // Rank Score
        const rScore = RANK_SCORE_MAP[r.rank] || 0;

        // Z Score
        let zVal = 0;
        if (r.raw !== null && r.mean !== null && r.std !== null && r.std !== 0) {
            let z = (r.raw - r.mean) / r.std;
            z = roundHalfUp(z, 1);

            let cdf = normCdf(z);
            let zRankP = 1.0 - cdf;

            const rankPLimit = RANK_PERCENTILE_MAP[r.rank] || 1.0;

            if (zRankP > rankPLimit) {
                zRankP = rankPLimit;
            }

            zVal = (1 - zRankP) * 100;
        } else {
            // Fallback if Z cannot be calculated? 
            // For now assume 0 or handle logic later. 
            // In strict Yonsei logic, missing Z info might mean it's not a Z-score subject.
            // But we already filtered by 'rank is unlikely to be null'.
            // If data is missing, we might use Rank Score as proxy or 0.
            // Let's use 0 for safety but ideally data is complete.
        }

        sumRankScore += r.credit * rScore;
        sumZScoreVal += r.credit * zVal;
        totalCredit += r.credit;
    }

    if (totalCredit === 0) return { rankAvg: 0, zAvg: 0 };

    return {
        rankAvg: sumRankScore / totalCredit,
        zAvg: sumZScoreVal / totalCredit
    };
}
