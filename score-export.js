// スコアをGoogleフォームへ自動送信し、実験データを一箇所に集約するための共通処理

const GOOGLE_FORM_ACTION_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdXYCtGYy05BJ9ZDLgC_tZX2ZMehMxcu0xf41DxbUmywTQWjg/formResponse';

const GOOGLE_FORM_ENTRIES = {
    name: 'entry.96162211',
    difficulty: 'entry.2124565469',
    platform: 'entry.368225870',
    score: 'entry.1014520924',
    totalTime: 'entry.723486941',
    grade: 'entry.1434940338',
    // d′(信号検出理論)算出用
    hits: 'entry.1336681947',
    misses: 'entry.488010692',
    falseAlarms: 'entry.1193150678',
    correctRejections: 'entry.876648791'
};

const DIFFICULTY_LABELS = {
    beginner: '初心者',
    intermediate: '中級者',
    advanced: '上級者'
};

const PLATFORM_LABELS = {
    pc: 'PC',
    vr: 'VR'
};

// 問題単位のログ(trialLog)から、信号検出理論(d′)計算に必要な4分類を集計する
function computeSignalDetectionCounts(trialLog) {
    const counts = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 };
    trialLog.forEach(trial => {
        if (trial.hasTarget && trial.userAnswer === true) counts.hits++;
        else if (trial.hasTarget && trial.userAnswer !== true) counts.misses++;
        else if (!trial.hasTarget && trial.userAnswer === true) counts.falseAlarms++;
        else counts.correctRejections++;
    });
    return counts;
}

// 同一端末での2回目以降のプレイでは、保存済みの名前を再利用してブレを防ぐ
function getPlayerName() {
    let name = localStorage.getItem('gaborPlayerName');
    if (!name) {
        name = window.prompt('お名前・ニックネームを入力してください\n（次回以降はこの端末で自動的に使われます）', '') || '匿名';
        localStorage.setItem('gaborPlayerName', name);
    }
    return name;
}

function submitScoreToGoogleForm({ difficulty, platform, score, totalTime, grade, trialLog }) {
    const formData = new FormData();
    formData.append(GOOGLE_FORM_ENTRIES.name, getPlayerName());
    formData.append(GOOGLE_FORM_ENTRIES.difficulty, DIFFICULTY_LABELS[difficulty] || difficulty);
    formData.append(GOOGLE_FORM_ENTRIES.platform, PLATFORM_LABELS[platform] || platform);
    formData.append(GOOGLE_FORM_ENTRIES.score, String(score));
    formData.append(GOOGLE_FORM_ENTRIES.totalTime, totalTime.toFixed(1));
    formData.append(GOOGLE_FORM_ENTRIES.grade, grade);

    if (Array.isArray(trialLog) && trialLog.length > 0) {
        const sdt = computeSignalDetectionCounts(trialLog);
        if (GOOGLE_FORM_ENTRIES.hits) formData.append(GOOGLE_FORM_ENTRIES.hits, String(sdt.hits));
        if (GOOGLE_FORM_ENTRIES.misses) formData.append(GOOGLE_FORM_ENTRIES.misses, String(sdt.misses));
        if (GOOGLE_FORM_ENTRIES.falseAlarms) formData.append(GOOGLE_FORM_ENTRIES.falseAlarms, String(sdt.falseAlarms));
        if (GOOGLE_FORM_ENTRIES.correctRejections) formData.append(GOOGLE_FORM_ENTRIES.correctRejections, String(sdt.correctRejections));
    }

    // no-corsのためレスポンス内容は読めないが、送信自体は行われる
    fetch(GOOGLE_FORM_ACTION_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: formData
    }).catch(() => {
        // オフライン等で送信できなくても、ローカル履歴(localStorage)には保存済みなので無視する
    });
}
