// =============================================================
// ガボールパッチ・アイ・トレーナー VR版
// スマホ + カードボード型ゴーグルでのステレオ表示・視線(注視)操作
// PC版(script.js)と同じ課題内容・難易度・採点ロジックを使用し、
// 環境（PC / VR）による効果の比較実験ができるようにしている。
// =============================================================

// --- 設定（PC版と同一） ---
const TRAINING_QUESTIONS = 10; // 通常トレーニング1セットの問題数
const TEST_QUESTIONS = 30;     // 事前/事後テスト1セットの問題数（休憩なしの1ブロック）
let MAX_QUESTIONS = TRAINING_QUESTIONS; // フェーズに応じて動的に切り替える

const PATCH_COUNT = 9;

// 難易度は中級固定（参加者数が少なく難易度別の分析ができないため一本化した）
const DIFFICULTY_SETTINGS = {
    intermediate: { timeLimit: 5, name: '中級' }
};

const PHASE_SETTINGS = {
    training: { name: 'トレーニング', questions: TRAINING_QUESTIONS },
    pre_test: { name: '事前テスト', questions: TEST_QUESTIONS },
    post_test: { name: '事後テスト', questions: TEST_QUESTIONS }
};

const DWELL_TIME_MS = 1200; // 注視でボタンを選択するまでの時間

// --- ゲーム状態 ---
let currentDifficulty = 'intermediate';
let currentPhase = 'training'; // training / pre_test / post_test
let TIME_LIMIT = 5;
let currentQuestionNumber = 0;
let correctScore = 0;
let questionStartTime = 0;
let totalClearTime = 0;
let questionTimer = null;
let remainingTime = TIME_LIMIT;
let targetConfig = null;
let hasTarget = false;
let gaborPatchConfigs = [];
let gameActive = false;
let answering = false; // 二重回答防止
let trialLog = []; // 問題単位のログ（信号検出理論のd′計算に使用）

// --- 画面の向き制御 ---
// screen.orientation.lock()はSafari(iOS)が未対応でサイレントに失敗するため、
// 実際の向きを監視してゲート表示でブロックする方式を併用する。
let orientationPaused = false;
let pendingGameStart = false;

function isPortrait() {
    return window.matchMedia('(orientation: portrait)').matches;
}

// 縦向きなら（スタート画面/結果画面/プレイ中どれでも）ゲートを表示して視線操作をブロックし、
// 横向きに戻ったら自動再開する。
function updateOrientationGate() {
    const gate = document.getElementById('orientation-gate');
    if (!gate) return;
    const portrait = isPortrait();
    gate.classList.toggle('hidden', !portrait);

    const wasPaused = orientationPaused;
    orientationPaused = portrait;

    if (portrait && !wasPaused && gameActive) {
        stopQuestionTimer();
    } else if (!portrait && wasPaused && gameActive) {
        startQuestionTimer();
    }

    if (!portrait) tryStartPendingGame();
}

// 「VR開始」タップ後、横向きになるまでカウントダウンを保留する。
function tryStartPendingGame() {
    if (!pendingGameStart || isPortrait()) return;
    pendingGameStart = false;
    setTimeout(() => {
        recenterView();
        startVrGame();
    }, 300);
}

// --- ユーティリティ ---
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// =============================================================
// Three.js セットアップ
// =============================================================
let renderer, scene, cameraRig, leftCamera, rightCamera;
let uiPanel, gameplayGroup;
let targetMesh, patchMeshes = [];
let btnYesMesh, btnNoMesh;
let hudCanvas, hudCtx, hudTexture, hudMesh;
let feedbackCanvas, feedbackCtx, feedbackTexture, feedbackMesh;
let reticleLeftEl, reticleRightEl;

// --- スタート画面（VR限定：ゴーグルを外さず視線で「VR開始」を選べるようにする） ---
let startScreenActive = true;
let startGroup, startTextCanvas, startTextCtx, startTextTexture, startTextMesh;
let startMesh;

// --- 結果画面（VR限定：ゴーグルを外さず視線で「もう一度プレイ」「ホームに戻る」を選べるようにする） ---
let resultScreenActive = false;
let resultGroup, resultTextCanvas, resultTextCtx, resultTextTexture, resultTextMesh;
let retryMesh, homeMesh;

const clock = new THREE.Clock();

// --- 目の間隔(レンズ位置)調整 ---
// ダンボールゴーグルのレンズ間隔は機種・スマホごとにバラつきがあり、左右の映像が
// 綺麗に重ならないことがあるため、その場でプレイヤーが微調整できるようにする。
// カメラの3D位置をわずかに動かす方式だと、パネルが正面2.5m先にあるため見た目の
// 変化がほぼ感じられなかった（角度にしてtaps数十回でも1〜2度程度）。
// 代わりにsetViewOffsetで各目の描画そのものを画面上でピクセル単位に水平シフトし、
// タップ1回あたりの効果がはっきりわかるようにする。
// 調整値は端末ごとにlocalStorageへ保存し、次回以降も引き継ぐ。
const EYE_OFFSET_STEP_PX = 20;
const EYE_OFFSET_MAX_PX = 200;

function loadStoredEyeOffset() {
    const stored = parseInt(localStorage.getItem('vrEyeOffsetPx'), 10);
    return Number.isFinite(stored) ? Math.min(EYE_OFFSET_MAX_PX, Math.max(-EYE_OFFSET_MAX_PX, stored)) : 0;
}

let eyeOffsetPx = loadStoredEyeOffset();
const PANEL_DISTANCE = 2.5; // パネルまでの距離(m)

// 現在のズレ量を左右それぞれの描画に反映する（setViewOffsetで見た目上の
// 表示位置をピクセル単位でずらす。大きめの仮想フレームの中から半分の幅を
// 切り出す位置をずらすことで、レンズに対する見え方を調整する）
function applyEyeOffset() {
    if (!leftCamera || !rightCamera || !renderer) return;
    const halfW = Math.max(1, Math.floor(window.innerWidth / 2));
    const h = Math.max(1, window.innerHeight);
    const fullW = halfW + EYE_OFFSET_MAX_PX * 2;
    leftCamera.setViewOffset(fullW, h, EYE_OFFSET_MAX_PX - eyeOffsetPx, 0, halfW, h);
    rightCamera.setViewOffset(fullW, h, EYE_OFFSET_MAX_PX + eyeOffsetPx, 0, halfW, h);
    // レティクル（照準）は3D空間ではなく画面固定のHTML要素なので、
    // ここで一緒にずらさないと3D側の映像だけ調整されて位置がズレたままになる
    positionReticles();
}

function adjustEyeOffset(delta) {
    eyeOffsetPx = Math.min(EYE_OFFSET_MAX_PX, Math.max(-EYE_OFFSET_MAX_PX, eyeOffsetPx + delta));
    applyEyeOffset();
    localStorage.setItem('vrEyeOffsetPx', String(eyeOffsetPx));
}

function initThree() {
    const canvas = document.getElementById('vr-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.autoClear = false;
    renderer.setClearColor(0xf0f2f5, 1); // PC版のページ背景に近い明るいグレー（コントラスト条件をPC版に揃えるため）

    scene = new THREE.Scene();

    cameraRig = new THREE.Object3D();
    scene.add(cameraRig);

    leftCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
    cameraRig.add(leftCamera);

    rightCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
    cameraRig.add(rightCamera);

    // 環境光的な補助光（MeshBasicMaterialを主に使うため必須ではないが保険）
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    buildUiPanel();
    createReticles();

    window.addEventListener('resize', onResize);
    onResize();
}

function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    const eyeAspect = (width / 2) / height;
    leftCamera.aspect = eyeAspect;
    rightCamera.aspect = eyeAspect;
    applyEyeOffset(); // aspect変更後に呼ぶ（setViewOffset内でupdateProjectionMatrix()まで行う）
    positionReticles();
}

// -------------------------------------------------------------
// UIパネル構築（PC版の「正面固定パネルに3x3グリッド」を踏襲）
// -------------------------------------------------------------
function buildUiPanel() {
    uiPanel = new THREE.Object3D();
    uiPanel.position.set(0, 0, -PANEL_DISTANCE);
    scene.add(uiPanel);

    // ゲームプレイ中のみ表示する要素をまとめておく（結果画面ではまとめて非表示にする）
    gameplayGroup = new THREE.Object3D();
    uiPanel.add(gameplayGroup);

    // --- HUD（スコア・問題数・タイマー）---
    hudCanvas = document.createElement('canvas');
    hudCanvas.width = 1024;
    hudCanvas.height = 160;
    hudCtx = hudCanvas.getContext('2d');
    hudTexture = new THREE.CanvasTexture(hudCanvas);
    const hudGeo = new THREE.PlaneGeometry(2.0, 0.3125);
    const hudMat = new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true });
    hudMesh = new THREE.Mesh(hudGeo, hudMat);
    hudMesh.position.set(0, 1.05, 0);
    gameplayGroup.add(hudMesh);
    drawHud();

    // --- お題画像 ---
    const targetGeo = new THREE.PlaneGeometry(0.5, 0.5);
    const targetMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
    targetMesh = new THREE.Mesh(targetGeo, targetMat);
    targetMesh.position.set(-1.15, 0.55, 0);
    gameplayGroup.add(targetMesh);

    // お題ラベル
    const targetLabel = makeTextPlane('お題', 0.5, 0.12, { font: 'bold 60px Arial', color: '#ffffff', bg: 'rgba(0,123,255,0.85)' });
    targetLabel.position.set(-1.15, 0.87, 0.001);
    gameplayGroup.add(targetLabel);

    // お題エリアの背景カード（PC版の白カード風の見た目に合わせる）
    const targetBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.62),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    targetBg.position.set(-1.15, 0.55, -0.01);
    gameplayGroup.add(targetBg);

    // --- 3x3 ガボールパッチグリッド ---
    const cols = 3, rows = 3;
    const cellSize = 0.42;
    const gap = 0.06;
    const gridWidth = cols * cellSize + (cols - 1) * gap;
    const gridHeight = rows * cellSize + (rows - 1) * gap;
    const gridOriginX = 0.15;
    const gridOriginY = 0.15;

    // グリッド全体の背景カード（PC版の #gabor-area 相当）
    const gridBg = new THREE.Mesh(
        new THREE.PlaneGeometry(gridWidth + 0.15, gridHeight + 0.15),
        new THREE.MeshBasicMaterial({ color: 0xf8f9fa })
    );
    gridBg.position.set(gridOriginX, gridOriginY, -0.01);
    gameplayGroup.add(gridBg);

    patchMeshes = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const geo = new THREE.PlaneGeometry(cellSize, cellSize);
            const mat = new THREE.MeshBasicMaterial({ color: 0x888888 });
            const mesh = new THREE.Mesh(geo, mat);
            const x = gridOriginX - gridWidth / 2 + cellSize / 2 + c * (cellSize + gap);
            const y = gridOriginY + gridHeight / 2 - cellSize / 2 - r * (cellSize + gap);
            mesh.position.set(x, y, 0);
            gameplayGroup.add(mesh);
            patchMeshes.push(mesh);
        }
    }

    // --- ある/ないボタン（3x3グリッドの下に横並びで配置） ---
    const btnOptsAnswer = { width: 0.68, height: 0.26, canvasWidth: 560, canvasHeight: 214, fontSize: 92 };
    const answerRowWidth = gridWidth + 0.15; // gridBg(背景カード)の幅に揃える
    const answerBtnGap = answerRowWidth - btnOptsAnswer.width * 2;
    const answerRowLeft = gridOriginX - answerRowWidth / 2;
    const answerBtnY = (gridOriginY - (gridHeight + 0.15) / 2) - 0.09 - btnOptsAnswer.height / 2;

    btnYesMesh = makeButtonPlane('ある！', 0x4CAF50, btnOptsAnswer);
    btnYesMesh.position.set(answerRowLeft + btnOptsAnswer.width / 2, answerBtnY, 0);
    gameplayGroup.add(btnYesMesh);

    btnNoMesh = makeButtonPlane('ない！', 0xF44336, btnOptsAnswer);
    btnNoMesh.position.set(answerRowLeft + btnOptsAnswer.width + answerBtnGap + btnOptsAnswer.width / 2, answerBtnY, 0);
    gameplayGroup.add(btnNoMesh);

    // --- フィードバック表示 ---
    feedbackCanvas = document.createElement('canvas');
    feedbackCanvas.width = 1024;
    feedbackCanvas.height = 160;
    feedbackCtx = feedbackCanvas.getContext('2d');
    feedbackTexture = new THREE.CanvasTexture(feedbackCanvas);
    const feedGeo = new THREE.PlaneGeometry(2.0, 0.3125);
    const feedMat = new THREE.MeshBasicMaterial({ map: feedbackTexture, transparent: true });
    feedbackMesh = new THREE.Mesh(feedGeo, feedMat);
    feedbackMesh.position.set(0, -1.25, 0);
    gameplayGroup.add(feedbackMesh);

    buildResultPanel();
    buildStartPanel();

    // 初期状態はスタート画面のみ表示（ゲームプレイ用の要素はまだ隠す）
    gameplayGroup.visible = false;
    startGroup.visible = true;
}

// -------------------------------------------------------------
// スタート画面パネル（VR限定）：「VR開始」をある/ないボタンと同じ
// 視線滞留(dwell)方式で選べるようにする（準備中にタッチ操作が不便なため）
// -------------------------------------------------------------
function buildStartPanel() {
    startGroup = new THREE.Object3D();
    uiPanel.add(startGroup);

    startTextCanvas = document.createElement('canvas');
    startTextCanvas.width = 1024;
    startTextCanvas.height = 460;
    startTextCtx = startTextCanvas.getContext('2d');
    startTextTexture = new THREE.CanvasTexture(startTextCanvas);
    const startTextGeo = new THREE.PlaneGeometry(1.9, 0.86);
    const startTextMat = new THREE.MeshBasicMaterial({ map: startTextTexture, transparent: true });
    startTextMesh = new THREE.Mesh(startTextGeo, startTextMat);
    startTextMesh.position.set(0, 0.42, 0);
    startGroup.add(startTextMesh);

    const startBg = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 0.96),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    startBg.position.set(0, 0.42, -0.01);
    startGroup.add(startBg);

    startMesh = makeButtonPlane('VR開始', 0x6f42c1, { width: 1.2, height: 0.4, canvasWidth: 860, canvasHeight: 290, fontSize: 70 });
    startMesh.position.set(0, -0.45, 0);
    startGroup.add(startMesh);
}

function drawStartText() {
    const w = startTextCanvas.width, h = startTextCanvas.height;
    startTextCtx.clearRect(0, 0, w, h);
    startTextCtx.textAlign = 'center';
    startTextCtx.textBaseline = 'middle';

    startTextCtx.fillStyle = '#222';
    startTextCtx.font = 'bold 56px Arial';
    startTextCtx.fillText('VRモード準備完了', w / 2, 70);

    const selectedPhase = localStorage.getItem('testPhase') || 'training';
    const phaseInfo = PHASE_SETTINGS[selectedPhase] || PHASE_SETTINGS.training;
    startTextCtx.font = 'bold 44px Arial';
    startTextCtx.fillStyle = '#6f42c1';
    startTextCtx.fillText(`${phaseInfo.name}（中級・全${phaseInfo.questions}問）`, w / 2, 160);

    startTextCtx.font = '32px Arial';
    startTextCtx.fillStyle = '#444';
    startTextCtx.fillText('下のボタンを見つめる（約1.2秒）か', w / 2, 250);
    startTextCtx.fillText('画面をタップすると開始します', w / 2, 300);
    startTextCtx.fillText('開始後、スマホをゴーグルにセットしてください', w / 2, 370);

    startTextTexture.needsUpdate = true;
}

// -------------------------------------------------------------
// 結果画面パネル（VR限定）：スコア表示＋「もう一度プレイ」「ホームに戻る」を
// ある/ないボタンと同じ視線滞留(dwell)方式で選べるようにする
// -------------------------------------------------------------
function buildResultPanel() {
    resultGroup = new THREE.Object3D();
    resultGroup.visible = false;
    uiPanel.add(resultGroup);

    resultTextCanvas = document.createElement('canvas');
    resultTextCanvas.width = 1024;
    resultTextCanvas.height = 560;
    resultTextCtx = resultTextCanvas.getContext('2d');
    resultTextTexture = new THREE.CanvasTexture(resultTextCanvas);
    const resultGeo = new THREE.PlaneGeometry(1.9, 1.05);
    const resultMat = new THREE.MeshBasicMaterial({ map: resultTextTexture, transparent: true });
    resultTextMesh = new THREE.Mesh(resultGeo, resultMat);
    resultTextMesh.position.set(0, 0.55, 0);
    resultGroup.add(resultTextMesh);

    // 結果テキストの背景カード
    const resultBg = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 1.15),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    resultBg.position.set(0, 0.55, -0.01);
    resultGroup.add(resultBg);

    const btnOpts = { width: 0.85, height: 0.32, canvasWidth: 768, canvasHeight: 280, fontSize: 60 };
    retryMesh = makeButtonPlane('もう一度プレイ', 0x6f42c1, btnOpts);
    retryMesh.position.set(-0.48, -0.55, 0);
    resultGroup.add(retryMesh);

    homeMesh = makeButtonPlane('ホームに戻る', 0x6c757d, btnOpts);
    homeMesh.position.set(0.48, -0.55, 0);
    resultGroup.add(homeMesh);
}

function drawResultText(grade) {
    const w = resultTextCanvas.width, h = resultTextCanvas.height;
    resultTextCtx.clearRect(0, 0, w, h);
    resultTextCtx.textAlign = 'center';
    resultTextCtx.textBaseline = 'middle';

    resultTextCtx.fillStyle = '#222';
    resultTextCtx.font = 'bold 64px Arial';
    resultTextCtx.fillText(`${PHASE_SETTINGS[currentPhase].name}終了！`, w / 2, 80);

    const accuracy = (correctScore / MAX_QUESTIONS * 100).toFixed(0);
    resultTextCtx.font = '46px Arial';
    resultTextCtx.fillText(`スコア: ${correctScore} / ${MAX_QUESTIONS} (${accuracy}%)`, w / 2, 220);
    resultTextCtx.fillText(`総クリアタイム: ${totalClearTime.toFixed(1)}秒`, w / 2, 300);
    resultTextCtx.fillText(`(平均 ${(totalClearTime / MAX_QUESTIONS).toFixed(1)}秒/問)`, w / 2, 370);

    resultTextCtx.fillStyle = '#6f42c1';
    resultTextCtx.font = 'bold 110px Arial';
    resultTextCtx.fillText(`評価: ${grade}`, w / 2, 480);

    resultTextTexture.needsUpdate = true;
}

// 結果画面の表示/非表示を切り替え、視線の滞留状態もリセットする
function setResultScreen(active, grade) {
    resultScreenActive = active;
    resultGroup.visible = active;
    gameplayGroup.visible = !active;
    [btnYesMesh, btnNoMesh, retryMesh, homeMesh].forEach(mesh => {
        if (!mesh) return;
        mesh.userData.hovered = false;
        mesh.userData.dwell = 0;
        redrawButton(mesh);
    });
    if (active) drawResultText(grade);
}

function onResultRetry() {
    setResultScreen(false);
    startVrGame();
}

function onResultHome() {
    window.location.href = 'vr-index.html';
}

// 「VR開始」が選ばれた時の処理（視線での滞留選択・タップのどちらからも呼ばれる）
async function onStartSelected() {
    if (!startScreenActive) return; // 二重発火防止
    startScreenActive = false;
    startGroup.visible = false;
    gameplayGroup.visible = true;
    if (startMesh) {
        startMesh.userData.hovered = false;
        startMesh.userData.dwell = 0;
        redrawButton(startMesh);
    }

    // フルスクリーン化（対応ブラウザのみ）。視線での選択はブラウザのユーザー操作制約により
    // フルスクリーン化・画面向き固定が失敗することがあるが、その場合も後段の処理は続行する
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        }
    } catch (e) {
        console.warn('フルスクリーン化に失敗:', e);
    }
    try {
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
        }
    } catch (e) {
        console.warn('画面の向き固定に失敗:', e);
    }

    onResize();
    updateOrientationGate();
    // 縦向きのままならゲートで待機し、横向きになった時点で自動的に開始する
    pendingGameStart = true;
    tryStartPendingGame();
}

function makeTextPlane(text, w, h, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.round(512 * (h / w));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.bg || 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = opts.color || '#222';
    ctx.font = opts.font || 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    return new THREE.Mesh(geo, mat);
}

// 「ある/ない」等の注視選択ボタン：注視の滞留(dwell)進捗をバーで表示するため
// canvasを都度再描画できるようにuserDataに情報を持たせる
function makeButtonPlane(label, colorHex, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = opts.canvasWidth || 512;
    canvas.height = opts.canvasHeight || 220;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(opts.width || 0.5, opts.height || 0.22);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { canvas, ctx, texture, label, colorHex, dwell: 0, hovered: false, fontSize: opts.fontSize || 90 };
    redrawButton(mesh);
    return mesh;
}

function redrawButton(mesh) {
    const { canvas, ctx, label, colorHex, dwell, hovered, fontSize } = mesh.userData;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const baseColor = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.fillStyle = hovered ? shadeColor(baseColor, 15) : baseColor;
    roundRect(ctx, 4, 4, w - 8, h - 8, 24);
    ctx.fill();

    ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = hovered ? 8 : 4;
    roundRect(ctx, 4, 4, w - 8, h - 8, 24);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 - 15);

    // 注視の滞留プログレスバー
    if (hovered && dwell > 0) {
        const progress = Math.min(dwell / DWELL_TIME_MS, 1);
        const barW = (w - 40) * progress;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        roundRect(ctx, 20, h - 34, barW, 16, 8);
        ctx.fill();
    }

    mesh.userData.texture.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function shadeColor(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00FF) + percent;
    let b = (num & 0x0000FF) + percent;
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

function drawHud() {
    const w = hudCanvas.width, h = hudCanvas.height;
    hudCtx.clearRect(0, 0, w, h);
    hudCtx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(hudCtx, 0, 0, w, h, 20);
    hudCtx.fill();

    hudCtx.fillStyle = '#ffffff';
    hudCtx.font = 'bold 54px Arial';
    hudCtx.textAlign = 'center';
    hudCtx.textBaseline = 'middle';
    const phaseName = PHASE_SETTINGS[currentPhase] ? PHASE_SETTINGS[currentPhase].name : '';
    const text = `${phaseName}　問題 ${currentQuestionNumber}/${MAX_QUESTIONS}　スコア ${correctScore}　残り ${remainingTime}秒`;
    hudCtx.fillText(text, w / 2, h / 2);
    hudTexture.needsUpdate = true;
}

function showFeedback(text, color) {
    const w = feedbackCanvas.width, h = feedbackCanvas.height;
    feedbackCtx.clearRect(0, 0, w, h);
    if (text) {
        feedbackCtx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(feedbackCtx, 0, 0, w, h, 20);
        feedbackCtx.fill();
        feedbackCtx.fillStyle = color || '#ffffff';
        feedbackCtx.font = 'bold 64px Arial';
        feedbackCtx.textAlign = 'center';
        feedbackCtx.textBaseline = 'middle';
        feedbackCtx.fillText(text, w / 2, h / 2);
    }
    feedbackTexture.needsUpdate = true;
}

// -------------------------------------------------------------
// 画面中央のレティクル（照準）。各目の視野の中心にHTML要素で表示
// -------------------------------------------------------------
function createReticles() {
    reticleLeftEl = document.createElement('div');
    reticleRightEl = document.createElement('div');
    [reticleLeftEl, reticleRightEl].forEach(el => {
        el.style.position = 'fixed';
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.marginLeft = '-9px';
        el.style.marginTop = '-9px';
        el.style.border = '2px solid rgba(255,255,255,0.9)';
        el.style.borderRadius = '50%';
        el.style.top = '50%';
        el.style.zIndex = '20';
        el.style.pointerEvents = 'none';
        el.style.boxShadow = '0 0 4px rgba(0,0,0,0.8)';
        document.body.appendChild(el);
    });
    positionReticles();
}

// カメラのローカル正面方向(0,0,-1)が、そのカメラ自身のビューポート内で
// どこに投影されるかをNDC(-1〜1)で返す。setViewOffset()で非対称フラスタムに
// なっている場合、正面はビューポート中央にはならないため実際に投影して求める。
function projectLocalForwardToNdc(camera) {
    const p = new THREE.Vector4(0, 0, -1, 1);
    p.applyMatrix4(camera.projectionMatrix);
    return [p.x / p.w, p.y / p.w];
}

function positionReticles() {
    if (!reticleLeftEl || !leftCamera || !rightCamera) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const halfW = width / 2;

    const [leftNdcX, leftNdcY] = projectLocalForwardToNdc(leftCamera);
    const [rightNdcX, rightNdcY] = projectLocalForwardToNdc(rightCamera);

    reticleLeftEl.style.left = ((leftNdcX + 1) / 2 * halfW) + 'px';
    reticleLeftEl.style.top = ((1 - (leftNdcY + 1) / 2) * height) + 'px';
    reticleRightEl.style.left = (halfW + (rightNdcX + 1) / 2 * halfW) + 'px';
    reticleRightEl.style.top = ((1 - (rightNdcY + 1) / 2) * height) + 'px';
}

function setReticleHover(hovered) {
    const color = hovered ? '#28a745' : 'rgba(255,255,255,0.9)';
    reticleLeftEl.style.borderColor = color;
    reticleRightEl.style.borderColor = color;
    reticleLeftEl.style.width = reticleRightEl.style.width = hovered ? '26px' : '18px';
    reticleLeftEl.style.height = reticleRightEl.style.height = hovered ? '26px' : '18px';
    reticleLeftEl.style.marginLeft = reticleRightEl.style.marginLeft = hovered ? '-13px' : '-9px';
    reticleLeftEl.style.marginTop = reticleRightEl.style.marginTop = hovered ? '-13px' : '-9px';
}

// =============================================================
// 頭の向きトラッキング（DeviceOrientationEvent → クォータニオン）
// 標準的な変換式を使用（three.js旧DeviceOrientationControls相当）
// =============================================================
let currentAlpha = 0, currentBeta = 0, currentGamma = 0;
let orientationAvailable = false;
const baseQuaternionInverse = new THREE.Quaternion();
const tmpDeviceQuat = new THREE.Quaternion();
const EULER_TMP = new THREE.Euler();
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const Q0 = new THREE.Quaternion();
const ZEE = new THREE.Vector3(0, 0, 1);

function getScreenOrientationAngleRad() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
        return THREE.MathUtils.degToRad(screen.orientation.angle);
    }
    if (typeof window.orientation === 'number') {
        return THREE.MathUtils.degToRad(window.orientation);
    }
    return 0;
}

function setQuaternionFromDeviceOrientation(quaternion, alpha, beta, gamma, screenOrient) {
    EULER_TMP.set(
        THREE.MathUtils.degToRad(beta),
        THREE.MathUtils.degToRad(alpha),
        THREE.MathUtils.degToRad(-gamma),
        'YXZ'
    );
    quaternion.setFromEuler(EULER_TMP);
    quaternion.multiply(Q1);
    quaternion.multiply(Q0.setFromAxisAngle(ZEE, -screenOrient));
}

function onDeviceOrientation(event) {
    if (event.alpha === null) return;
    const firstReading = !orientationAvailable;
    currentAlpha = event.alpha || 0;
    currentBeta = event.beta || 0;
    currentGamma = event.gamma || 0;
    orientationAvailable = true;
    // センサーが初めて値を返した時点で一度基準方向を合わせておくと、
    // スタート画面のボタンが最初から見やすい位置に出やすくなる
    if (firstReading) recenterView();
}

function recenterView() {
    const screenOrient = getScreenOrientationAngleRad();
    setQuaternionFromDeviceOrientation(tmpDeviceQuat, currentAlpha, currentBeta, currentGamma, screenOrient);
    baseQuaternionInverse.copy(tmpDeviceQuat).invert();
}

function updateCameraRigFromOrientation() {
    if (!orientationAvailable) return;
    const screenOrient = getScreenOrientationAngleRad();
    setQuaternionFromDeviceOrientation(tmpDeviceQuat, currentAlpha, currentBeta, currentGamma, screenOrient);
    cameraRig.quaternion.copy(baseQuaternionInverse).multiply(tmpDeviceQuat);
}

// =============================================================
// 視線レイキャスト（ボタンの注視判定）
// =============================================================
const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();

// 現在の画面状態（スタート画面 or プレイ中 or 結果画面）に応じて、注視対象にするボタンを切り替える
function getActiveGazeTargets() {
    if (startScreenActive) return [startMesh].filter(Boolean);
    if (resultScreenActive) return [retryMesh, homeMesh].filter(Boolean);
    if (gameActive && !answering) return [btnYesMesh, btnNoMesh].filter(Boolean);
    return [];
}

function onGazeTargetSelected(mesh) {
    if (mesh === btnYesMesh) triggerAnswer(true);
    else if (mesh === btnNoMesh) triggerAnswer(false);
    else if (mesh === retryMesh) onResultRetry();
    else if (mesh === homeMesh) onResultHome();
    else if (mesh === startMesh) onStartSelected();
}

function updateGazeInteraction(deltaMs) {
    cameraRig.getWorldPosition(rayOrigin);
    rayDir.set(0, 0, -1).applyQuaternion(cameraRig.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(rayOrigin, rayDir);

    const targets = orientationPaused ? [] : getActiveGazeTargets();
    const hits = raycaster.intersectObjects(targets);
    const hitMesh = hits.length > 0 ? hits[0].object : null;

    setReticleHover(!!hitMesh);

    targets.forEach(mesh => {
        const ud = mesh.userData;
        if (mesh === hitMesh) {
            if (!ud.hovered) {
                ud.hovered = true;
                ud.dwell = 0;
            }
            ud.dwell += deltaMs;
            redrawButton(mesh);
            if (ud.dwell >= DWELL_TIME_MS) {
                ud.dwell = 0;
                ud.hovered = false;
                redrawButton(mesh);
                onGazeTargetSelected(mesh);
            }
        } else if (ud.hovered || ud.dwell > 0) {
            ud.hovered = false;
            ud.dwell = 0;
            redrawButton(mesh);
        }
    });

    return hitMesh;
}

let lastGazeHit = null;

// 画面タップ／クリックでも即座に選択できるようにする（カードボードのタッチ穴経由の操作を想定）
function onScreenTap() {
    if (!lastGazeHit) return;
    onGazeTargetSelected(lastGazeHit);
}

// =============================================================
// ゲームロジック（PC版 script.js と同等）
// =============================================================
async function startVrGame() {
    // 難易度は中級固定
    currentDifficulty = 'intermediate';
    TIME_LIMIT = DIFFICULTY_SETTINGS.intermediate.timeLimit;

    // フェーズ（training/pre_test/post_test）を読み込み、問題数を切り替える
    const selectedPhase = localStorage.getItem('testPhase') || 'training';
    currentPhase = PHASE_SETTINGS[selectedPhase] ? selectedPhase : 'training';
    MAX_QUESTIONS = PHASE_SETTINGS[currentPhase].questions;

    currentQuestionNumber = 0;
    correctScore = 0;
    totalClearTime = 0;
    remainingTime = TIME_LIMIT;
    trialLog = [];
    drawHud();

    await runCountdown();

    gameActive = true;
    nextQuestion();
}

function runCountdown() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('start-overlay');
        overlay.classList.remove('hidden');
        overlay.innerHTML = `
            <h1>まもなく開始します</h1>
            <div id="countdown-num" style="font-size:100px;font-weight:bold;color:#6f42c1;">3</div>
            <p>準備はよろしいですか？</p>
        `;
        let count = 3;
        const numEl = document.getElementById('countdown-num');
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                numEl.textContent = count;
            } else {
                numEl.textContent = 'START!';
                numEl.style.color = '#28a745';
                clearInterval(interval);
                setTimeout(() => {
                    overlay.classList.add('hidden');
                    resolve();
                }, 500);
            }
        }, 1000);
    });
}

function nextQuestion() {
    if (currentQuestionNumber >= MAX_QUESTIONS) {
        endVrGame();
        return;
    }
    currentQuestionNumber++;
    remainingTime = TIME_LIMIT;
    answering = false;
    showFeedback('', null);
    drawHud();
    generateQuestion();
    startQuestionTimer();
}

function generateQuestion() {
    // ターゲットのガボールパッチをその場でランダム生成（固定画像を使い回さないことで記憶による正答を防ぐ）
    targetConfig = randomGaborConfig();
    hasTarget = Math.random() < 0.5;

    gaborPatchConfigs = [];
    if (hasTarget) {
        gaborPatchConfigs.push(targetConfig); // ターゲットと同一パラメータの1枚を含める
        for (let i = 0; i < PATCH_COUNT - 1; i++) {
            gaborPatchConfigs.push(randomDistractorConfig(targetConfig));
        }
    } else {
        for (let i = 0; i < PATCH_COUNT; i++) {
            gaborPatchConfigs.push(randomDistractorConfig(targetConfig));
        }
    }
    gaborPatchConfigs = shuffleArray(gaborPatchConfigs);

    questionStartTime = Date.now();

    // お題画像を適用
    applyTextureToMesh(targetMesh, new THREE.CanvasTexture(renderGaborCanvas(targetConfig)));

    // 9枚のパッチ画像を適用
    for (let i = 0; i < patchMeshes.length; i++) {
        applyTextureToMesh(patchMeshes[i], new THREE.CanvasTexture(renderGaborCanvas(gaborPatchConfigs[i])));
    }
}

function applyTextureToMesh(mesh, texture) {
    if (mesh.material.map) {
        mesh.material.map.dispose(); // 毎問題ごとに新しいCanvasTextureを作るため、古いテクスチャのGPUメモリを解放する
    }
    if (texture) {
        fitTextureCover(texture, 1); // 正方形プレーンに対して中央クロップ表示（PC版のobject-fit:coverと見た目を揃える）
        mesh.material.map = texture;
        mesh.material.color.set(0xffffff);
        mesh.material.transparent = true; // 透過PNG（背景なしのガボールパッチ）に対応
        mesh.material.alphaTest = 0.05;   // 透明部分の縁が黒くにじむのを防ぐ
    } else {
        mesh.material.map = null;
        mesh.material.color.set(0x555555); // 読み込み失敗時のフォールバック表示
        mesh.material.transparent = false;
        mesh.material.alphaTest = 0;
    }
    mesh.material.needsUpdate = true;
}

// テクスチャ画像の縦横比とプレーンの縦横比が異なる場合に、
// 引き伸ばさず中央を基準にクロップ表示する（CSSのobject-fit: coverに相当）
function fitTextureCover(texture, planeAspect) {
    const img = texture.image;
    if (!img || !img.width || !img.height) {
        texture.repeat.set(1, 1);
        texture.offset.set(0, 0);
        return;
    }
    const imgAspect = img.width / img.height;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    if (imgAspect > planeAspect) {
        // 画像の方が横長 → 左右をクロップ
        const scale = planeAspect / imgAspect;
        texture.repeat.set(scale, 1);
        texture.offset.set((1 - scale) / 2, 0);
    } else {
        // 画像の方が縦長 → 上下をクロップ
        const scale = imgAspect / planeAspect;
        texture.repeat.set(1, scale);
        texture.offset.set(0, (1 - scale) / 2);
    }
    texture.needsUpdate = true;
}

function startQuestionTimer() {
    stopQuestionTimer();
    questionTimer = setInterval(() => {
        remainingTime--;
        drawHud();
        if (remainingTime <= 0) {
            triggerAnswer(false, true);
        }
    }, 1000);
}

function stopQuestionTimer() {
    if (questionTimer) {
        clearInterval(questionTimer);
        questionTimer = null;
    }
}

function triggerAnswer(userAnswer, isTimeout = false) {
    if (answering || !gameActive) return;
    answering = true;
    stopQuestionTimer();

    const responseTime = (Date.now() - questionStartTime) / 1000;
    const isCorrect = userAnswer === hasTarget;

    trialLog.push({
        questionNo: currentQuestionNumber,
        hasTarget: hasTarget,
        userAnswer: userAnswer,
        correct: isCorrect,
        isTimeout: isTimeout,
        responseTime: responseTime
    });

    if (isCorrect && !isTimeout) {
        correctScore++;
        totalClearTime += responseTime;
        showFeedback(`正解！ (${responseTime.toFixed(1)}秒)`, '#4CAF50');
    } else if (isTimeout) {
        showFeedback('時間切れ！', '#F44336');
    } else {
        showFeedback(`不正解 (正解: ${hasTarget ? 'ある' : 'ない'})`, '#F44336');
    }

    drawHud();

    setTimeout(() => {
        nextQuestion();
    }, 1500);
}

function calculateGrade(score, averageTime) {
    const accuracy = (score / MAX_QUESTIONS) * 100;
    const avgTime = averageTime / MAX_QUESTIONS;
    if (accuracy === 100 && avgTime <= 5) return 'S';
    if (accuracy >= 80 && avgTime <= 7) return 'A';
    if (accuracy >= 60 && avgTime <= 8) return 'B';
    if (accuracy >= 40) return 'C';
    return 'D';
}

function endVrGame() {
    gameActive = false;
    stopQuestionTimer();

    const grade = calculateGrade(correctScore, totalClearTime);
    const sdt = computeSignalDetectionCounts(trialLog);
    const history = JSON.parse(localStorage.getItem('gaborGameHistory') || '[]');
    history.push({
        date: new Date().toISOString(),
        score: correctScore,
        totalTime: totalClearTime,
        grade: grade,
        accuracy: (correctScore / MAX_QUESTIONS) * 100,
        difficulty: currentDifficulty,
        totalQuestions: MAX_QUESTIONS,
        phase: currentPhase, // training / pre_test / post_test
        platform: 'vr', // VR版であることを記録（PC版との比較用）
        trialLog: trialLog,
        signalDetection: sdt
    });
    localStorage.setItem('gaborGameHistory', JSON.stringify(history));

    submitScoreToGoogleForm({
        difficulty: currentDifficulty,
        phase: currentPhase,
        platform: 'vr',
        score: correctScore,
        totalTime: totalClearTime,
        grade: grade,
        trialLog: trialLog
    });

    // 結果はVRゴーグルを外さず見られるよう3Dパネル上に表示し、
    // 「もう一度プレイ」「ホームに戻る」も視線の滞留(dwell)で選べるようにする
    setResultScreen(true, grade);
}

// =============================================================
// レンダリングループ
// =============================================================
function animate() {
    requestAnimationFrame(animate);
    const deltaMs = clock.getDelta() * 1000;

    updateCameraRigFromOrientation();
    lastGazeHit = updateGazeInteraction(deltaMs);

    const width = window.innerWidth, height = window.innerHeight;

    // clear()は直前に設定されたシザー範囲だけを対象にするため、まず全画面分の
    // シザーに戻してからクリアする（そうしないと片目側だけ前フレームの内容が
    // 残り、背景が黒くなるなどの表示崩れが起きる）
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.clear();

    renderer.setViewport(0, 0, width / 2, height);
    renderer.setScissor(0, 0, width / 2, height);
    renderer.render(scene, leftCamera);

    renderer.setViewport(width / 2, 0, width / 2, height);
    renderer.setScissor(width / 2, 0, width / 2, height);
    renderer.render(scene, rightCamera);
}

// =============================================================
// 起動処理
// =============================================================
window.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE === 'undefined') {
        document.getElementById('start-overlay').innerHTML =
            '<h1>⚠️ エラー</h1><p>Three.jsの読み込みに失敗しました。通信環境を確認して再読み込みしてください。</p>';
        return;
    }

    initThree();
    drawStartText();

    window.addEventListener('deviceorientation', onDeviceOrientation, true);
    document.addEventListener('click', onScreenTap);
    document.addEventListener('touchend', onScreenTap);

    window.addEventListener('resize', updateOrientationGate);
    window.addEventListener('orientationchange', updateOrientationGate);
    updateOrientationGate();

    const recenterBtn = document.getElementById('recenter-btn');
    if (recenterBtn) {
        recenterBtn.addEventListener('click', () => recenterView());
    }

    const ipdMinusBtn = document.getElementById('ipd-minus-btn');
    const ipdPlusBtn = document.getElementById('ipd-plus-btn');
    if (ipdMinusBtn) ipdMinusBtn.addEventListener('click', () => adjustEyeOffset(-EYE_OFFSET_STEP_PX));
    if (ipdPlusBtn) ipdPlusBtn.addEventListener('click', () => adjustEyeOffset(EYE_OFFSET_STEP_PX));

    // 読み込み中オーバーレイを消し、スタート画面（3Dパネル）に切り替える
    document.getElementById('start-overlay').classList.add('hidden');

    animate();
});
