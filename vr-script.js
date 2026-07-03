// =============================================================
// ガボールパッチ・アイ・トレーナー VR版
// スマホ + カードボード型ゴーグルでのステレオ表示・視線(注視)操作
// PC版(script.js)と同じ課題内容・難易度・採点ロジックを使用し、
// 環境（PC / VR）による効果の比較実験ができるようにしている。
// =============================================================

// --- 設定（PC版と同一） ---
const MAX_QUESTIONS = 10;
const PATCH_COUNT = 9;

const DIFFICULTY_SETTINGS = {
    beginner: { timeLimit: 10, name: '初級' },
    intermediate: { timeLimit: 5, name: '中級' },
    advanced: { timeLimit: 3, name: '上級' }
};

const DWELL_TIME_MS = 1200; // 注視でボタンを選択するまでの時間

// --- ゲーム状態 ---
let currentDifficulty = 'beginner';
let TIME_LIMIT = 10;
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
let uiPanel;
let targetMesh, patchMeshes = [];
let btnYesMesh, btnNoMesh;
let hudCanvas, hudCtx, hudTexture, hudMesh;
let feedbackCanvas, feedbackCtx, feedbackTexture, feedbackMesh;
let reticleLeftEl, reticleRightEl;

const clock = new THREE.Clock();

const IPD = 0.064; // 瞳孔間距離(m)の近似値
const PANEL_DISTANCE = 2.5; // パネルまでの距離(m)

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
    leftCamera.position.set(-IPD / 2, 0, 0);
    cameraRig.add(leftCamera);

    rightCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
    rightCamera.position.set(IPD / 2, 0, 0);
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
    leftCamera.updateProjectionMatrix();
    rightCamera.updateProjectionMatrix();
    positionReticles();
}

// -------------------------------------------------------------
// UIパネル構築（PC版の「正面固定パネルに3x3グリッド」を踏襲）
// -------------------------------------------------------------
function buildUiPanel() {
    uiPanel = new THREE.Object3D();
    uiPanel.position.set(0, 0, -PANEL_DISTANCE);
    scene.add(uiPanel);

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
    uiPanel.add(hudMesh);
    drawHud();

    // --- お題画像 ---
    const targetGeo = new THREE.PlaneGeometry(0.5, 0.5);
    const targetMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
    targetMesh = new THREE.Mesh(targetGeo, targetMat);
    targetMesh.position.set(-1.15, 0.55, 0);
    uiPanel.add(targetMesh);

    // お題ラベル
    const targetLabel = makeTextPlane('お題', 0.5, 0.12, { font: 'bold 60px Arial', color: '#ffffff', bg: 'rgba(0,123,255,0.85)' });
    targetLabel.position.set(-1.15, 0.87, 0.001);
    uiPanel.add(targetLabel);

    // お題エリアの背景カード（PC版の白カード風の見た目に合わせる）
    const targetBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.62),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    targetBg.position.set(-1.15, 0.55, -0.01);
    uiPanel.add(targetBg);

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
    uiPanel.add(gridBg);

    patchMeshes = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const geo = new THREE.PlaneGeometry(cellSize, cellSize);
            const mat = new THREE.MeshBasicMaterial({ color: 0x888888 });
            const mesh = new THREE.Mesh(geo, mat);
            const x = gridOriginX - gridWidth / 2 + cellSize / 2 + c * (cellSize + gap);
            const y = gridOriginY + gridHeight / 2 - cellSize / 2 - r * (cellSize + gap);
            mesh.position.set(x, y, 0);
            uiPanel.add(mesh);
            patchMeshes.push(mesh);
        }
    }

    // --- ある/ないボタン ---
    btnYesMesh = makeButtonPlane('ある！', 0x4CAF50);
    btnYesMesh.position.set(-1.15, -0.55, 0);
    uiPanel.add(btnYesMesh);

    btnNoMesh = makeButtonPlane('ない！', 0xF44336);
    btnNoMesh.position.set(-1.15, -0.9, 0);
    uiPanel.add(btnNoMesh);

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
    uiPanel.add(feedbackMesh);
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

// 「ある/ない」ボタン：注視の滞留(dwell)進捗をバーで表示するため
// canvasを都度再描画できるようにuserDataに情報を持たせる
function makeButtonPlane(label, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 220;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(0.5, 0.22);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { canvas, ctx, texture, label, colorHex, dwell: 0, hovered: false };
    redrawButton(mesh);
    return mesh;
}

function redrawButton(mesh) {
    const { canvas, ctx, label, colorHex, dwell, hovered } = mesh.userData;
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
    ctx.font = 'bold 90px Arial';
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
    const diffName = DIFFICULTY_SETTINGS[currentDifficulty] ? DIFFICULTY_SETTINGS[currentDifficulty].name : '';
    const text = `難易度:${diffName}　問題 ${currentQuestionNumber}/${MAX_QUESTIONS}　スコア ${correctScore}　残り ${remainingTime}秒`;
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

function positionReticles() {
    if (!reticleLeftEl) return;
    reticleLeftEl.style.left = (window.innerWidth * 0.25) + 'px';
    reticleRightEl.style.left = (window.innerWidth * 0.75) + 'px';
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
    currentAlpha = event.alpha || 0;
    currentBeta = event.beta || 0;
    currentGamma = event.gamma || 0;
    orientationAvailable = true;
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

function updateGazeInteraction(deltaMs) {
    cameraRig.getWorldPosition(rayOrigin);
    rayDir.set(0, 0, -1).applyQuaternion(cameraRig.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(rayOrigin, rayDir);

    const targets = [btnYesMesh, btnNoMesh].filter(Boolean);
    const hits = gameActive && !answering ? raycaster.intersectObjects(targets) : [];
    const hitMesh = hits.length > 0 ? hits[0].object : null;

    setReticleHover(!!hitMesh);

    [btnYesMesh, btnNoMesh].forEach(mesh => {
        if (!mesh) return;
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
                triggerAnswer(mesh === btnYesMesh);
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

// 画面タップ／クリックでも即座に回答できるようにする（カードボードのタッチ穴経由の操作を想定）
function onScreenTap() {
    if (!gameActive || answering || !lastGazeHit) return;
    if (lastGazeHit === btnYesMesh) {
        triggerAnswer(true);
    } else if (lastGazeHit === btnNoMesh) {
        triggerAnswer(false);
    }
}

// =============================================================
// ゲームロジック（PC版 script.js と同等）
// =============================================================
async function startVrGame() {
    const selectedDifficulty = localStorage.getItem('selectedDifficulty') || 'beginner';
    currentDifficulty = selectedDifficulty;
    TIME_LIMIT = DIFFICULTY_SETTINGS[selectedDifficulty].timeLimit;

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
        platform: 'vr', // VR版であることを記録（PC版との比較用）
        trialLog: trialLog,
        signalDetection: sdt
    });
    localStorage.setItem('gaborGameHistory', JSON.stringify(history));

    submitScoreToGoogleForm({
        difficulty: currentDifficulty,
        platform: 'vr',
        score: correctScore,
        totalTime: totalClearTime,
        grade: grade,
        trialLog: trialLog
    });

    showResultOverlay(grade);
}

function showResultOverlay(grade) {
    const overlay = document.getElementById('start-overlay');
    const accuracy = (correctScore / MAX_QUESTIONS * 100).toFixed(0);
    overlay.innerHTML = `
        <h1>🏁 トレーニング終了！</h1>
        <p>スコア: ${correctScore} / ${MAX_QUESTIONS} (${accuracy}%)</p>
        <p>総クリアタイム: ${totalClearTime.toFixed(1)}秒 (平均 ${(totalClearTime / MAX_QUESTIONS).toFixed(1)}秒/問)</p>
        <p style="font-size:2em;font-weight:bold;">評価: ${grade}</p>
        <button id="retry-btn" class="start-button" style="background:#6f42c1;border:none;">🔁 もう一度挑戦</button>
        <a href="results.html" class="nav-button" style="margin-top:10px;">📊 履歴を見る</a>
        <a href="vr-index.html" class="nav-button">🏠 難易度選択に戻る</a>
    `;
    overlay.classList.remove('hidden');
    document.getElementById('retry-btn').addEventListener('click', () => {
        startVrGame();
    });
}

// =============================================================
// レンダリングループ
// =============================================================
function animate() {
    requestAnimationFrame(animate);
    const deltaMs = clock.getDelta() * 1000;

    updateCameraRigFromOrientation();
    lastGazeHit = updateGazeInteraction(deltaMs);

    renderer.setScissorTest(true);
    renderer.clear();

    const width = window.innerWidth, height = window.innerHeight;

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

    const selectedDifficulty = localStorage.getItem('selectedDifficulty') || 'beginner';
    const diffName = DIFFICULTY_SETTINGS[selectedDifficulty].name;
    const diffTime = DIFFICULTY_SETTINGS[selectedDifficulty].timeLimit;
    document.getElementById('difficulty-preview').textContent =
        `難易度: ${diffName}（制限時間 ${diffTime}秒）`;

    initThree();

    window.addEventListener('deviceorientation', onDeviceOrientation, true);
    document.addEventListener('click', onScreenTap);
    document.addEventListener('touchend', onScreenTap);

    document.getElementById('enter-vr-btn').addEventListener('click', async () => {
        // フルスクリーン化（対応ブラウザのみ）
        try {
            if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
        } catch (e) {
            console.warn('フルスクリーン化に失敗:', e);
        }
        // 横向き固定（対応ブラウザのみ。失敗しても続行）
        try {
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape');
            }
        } catch (e) {
            console.warn('画面の向き固定に失敗:', e);
        }

        onResize();
        // 少し待ってセンサー値を安定させてからキャリブレーション
        setTimeout(() => {
            recenterView();
            startVrGame();
        }, 300);
    });

    animate();
});
