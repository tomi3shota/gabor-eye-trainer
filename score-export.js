// スコアをGoogleフォームへ自動送信し、実験データを一箇所に集約するための共通処理

const GOOGLE_FORM_ACTION_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdXYCtGYy05BJ9ZDLgC_tZX2ZMehMxcu0xf41DxbUmywTQWjg/formResponse';

const GOOGLE_FORM_ENTRIES = {
    name: 'entry.96162211',
    difficulty: 'entry.2124565469',
    platform: 'entry.368225870',
    score: 'entry.1014520924',
    totalTime: 'entry.723486941',
    grade: 'entry.1434940338'
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

// ログイン中のユーザー名を使う(auth.js)。同じ端末を複数人で共有していても、
// ログインしている人の名前で送信されるため取り違えが起きない
function getPlayerName() {
    return getCurrentUser() || '匿名';
}

function submitScoreToGoogleForm({ difficulty, platform, score, totalTime, grade }) {
    const formData = new FormData();
    formData.append(GOOGLE_FORM_ENTRIES.name, getPlayerName());
    formData.append(GOOGLE_FORM_ENTRIES.difficulty, DIFFICULTY_LABELS[difficulty] || difficulty);
    formData.append(GOOGLE_FORM_ENTRIES.platform, PLATFORM_LABELS[platform] || platform);
    formData.append(GOOGLE_FORM_ENTRIES.score, String(score));
    formData.append(GOOGLE_FORM_ENTRIES.totalTime, totalTime.toFixed(1));
    formData.append(GOOGLE_FORM_ENTRIES.grade, grade);

    // no-corsのためレスポンス内容は読めないが、送信自体は行われる
    fetch(GOOGLE_FORM_ACTION_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: formData
    }).catch(() => {
        // オフライン等で送信できなくても、ローカル履歴(localStorage)には保存済みなので無視する
    });
}
