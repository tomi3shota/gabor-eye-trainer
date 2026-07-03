// 端末内だけで完結する簡易ログイン。
// パスワードはSHA-256でハッシュ化してこの端末のlocalStorageに保存するだけで、
// どこにも送信されない。目的は「同じ端末を家族・友達で共有したときに、
// 誰が今プレイしているか取り違えない」ことであり、真の認証・セキュリティ機能ではない。

const AUTH_ACCOUNTS_KEY = 'gaborAccounts';
const AUTH_CURRENT_USER_KEY = 'gaborCurrentUser';

async function hashPassword(password) {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAccounts() {
    return JSON.parse(localStorage.getItem(AUTH_ACCOUNTS_KEY) || '{}');
}

function saveAccounts(accounts) {
    localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function getRegisteredNames() {
    return Object.keys(getAccounts());
}

async function registerAccount(name, password) {
    name = name.trim();
    if (!name) return { ok: false, error: 'お名前・ニックネームを入力してください' };
    if (!password) return { ok: false, error: 'パスワードを入力してください' };

    const accounts = getAccounts();
    if (accounts[name]) {
        return { ok: false, error: 'その名前は既に登録されています。ログインするか、別の名前を使ってください' };
    }
    accounts[name] = { passwordHash: await hashPassword(password) };
    saveAccounts(accounts);
    localStorage.setItem(AUTH_CURRENT_USER_KEY, name);
    return { ok: true };
}

async function loginAccount(name, password) {
    const accounts = getAccounts();
    const account = accounts[name];
    if (!account) {
        return { ok: false, error: '登録されていない名前です。「新規登録」から始めてください' };
    }
    const hash = await hashPassword(password);
    if (hash !== account.passwordHash) {
        return { ok: false, error: 'パスワードが違います' };
    }
    localStorage.setItem(AUTH_CURRENT_USER_KEY, name);
    return { ok: true };
}

function getCurrentUser() {
    return localStorage.getItem(AUTH_CURRENT_USER_KEY);
}

function logout() {
    localStorage.removeItem(AUTH_CURRENT_USER_KEY);
    window.location.href = 'login.html';
}

// ログインが必要なページの先頭で呼ぶ。未ログインならlogin.htmlへ飛ばしてtrueを返さない
function requireLogin() {
    if (!getCurrentUser()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}
