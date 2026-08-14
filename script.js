// --- 設定 ---
const TRAINING_QUESTIONS = 10; // 通常トレーニング1セットの問題数
const TEST_QUESTIONS = 30;     // 事前/事後テスト1セットの問題数（休憩なしの1ブロック）
let MAX_QUESTIONS = TRAINING_QUESTIONS; // フェーズに応じて動的に切り替える

const PATCH_COUNT = 9;   // 画面に表示するガボールパッチの総数 (3x3=9)

// 難易度は中級固定（参加者数が少なく難易度別の分析ができないため一本化した）
const DIFFICULTY_SETTINGS = {
    intermediate: { timeLimit: 5, name: '中級' }
};

const PHASE_SETTINGS = {
    training: { name: 'トレーニング', questions: TRAINING_QUESTIONS },
    pre_test: { name: '事前テスト', questions: TEST_QUESTIONS },
    post_test: { name: '事後テスト', questions: TEST_QUESTIONS }
};

let currentDifficulty = 'intermediate'; // 難易度は中級固定
let currentPhase = 'training'; // training / pre_test / post_test
let TIME_LIMIT = 5; // 動的に変更される制限時間

// --- DOM要素 ---
const gaborArea = document.getElementById('gabor-area');
const scoreDisplay = document.getElementById('current-score');
const maxQuestionsDisplay = document.getElementById('max-questions');
const questionCountDisplay = document.getElementById('question-count');
const feedbackElement = document.getElementById('feedback');
const timerDisplay = document.getElementById('time-remaining');
const targetImageElement = document.getElementById('target-gabor-image');
const btnYes = document.getElementById('btn-yes');
const btnNo = document.getElementById('btn-no');
const gameMainArea = document.getElementById('game-main-area');
const resultArea = document.getElementById('result-area');
const finalScoreDisplay = document.getElementById('final-score');
const finalTimeDisplay = document.getElementById('final-time');
const finalGradeDisplay = document.getElementById('final-grade');

// --- ゲーム状態変数 ---
let currentQuestionNumber = 0;
let correctScore = 0;
let questionStartTime = 0;
let totalClearTime = 0;
let timer;
let remainingTime = TIME_LIMIT;
let targetImage = null; // 現在の問題のターゲットcanvas
let targetConfig = null;
let hasTarget = false;
let gaborPatches = []; // 現在の問題の9枚（canvasオブジェクトの配列）
let patchCanvases = []; // 表示用に使い回す<canvas>要素（毎問題作り直さない）
let trialLog = []; // 問題単位のログ（信号検出理論のd′計算に使用）
let answering = false; // 二重回答防止（連打やタイムアウトとの同時押しでcheckAnswerが多重発火するのを防ぐ）

/**
 * ランダムな要素を配列から選択
 */
function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * 配列をシャッフル
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * ゲーム初期化
 */
async function startGame() {
    console.log('=== ゲーム初期化開始 ===');
    
    // DOM要素の確認
    console.log('DOM要素の確認:');
    console.log('- gaborArea:', gaborArea ? '✅' : '❌');
    console.log('- gameMainArea:', gameMainArea ? '✅' : '❌');
    console.log('- resultArea:', resultArea ? '✅' : '❌');
    console.log('- targetImageElement:', targetImageElement ? '✅' : '❌');
    console.log('- btnYes:', btnYes ? '✅' : '❌');
    console.log('- btnNo:', btnNo ? '✅' : '❌');
    
    // カウントダウン要素の確認
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    console.log('- countdownOverlay:', countdownOverlay ? '✅' : '❌');
    console.log('- countdownNumber:', countdownNumber ? '✅' : '❌');
    
    // 難易度は中級固定
    currentDifficulty = 'intermediate';
    TIME_LIMIT = DIFFICULTY_SETTINGS.intermediate.timeLimit;

    // フェーズ（training/pre_test/post_test）を読み込み、問題数を切り替える
    const selectedPhase = localStorage.getItem('testPhase') || 'training';
    currentPhase = PHASE_SETTINGS[selectedPhase] ? selectedPhase : 'training';
    MAX_QUESTIONS = PHASE_SETTINGS[currentPhase].questions;

    console.log('フェーズ:', currentPhase, '問題数:', MAX_QUESTIONS, '制限時間:', TIME_LIMIT);

    // モード情報を表示
    const difficultyInfo = document.getElementById('difficulty-info');
    if (difficultyInfo) {
        difficultyInfo.textContent = `${PHASE_SETTINGS[currentPhase].name}（中級・制限時間: ${TIME_LIMIT}秒・全${MAX_QUESTIONS}問）`;
    }
    if (maxQuestionsDisplay) {
        maxQuestionsDisplay.textContent = MAX_QUESTIONS;
    }

    // ゲーム状態をリセット
    currentQuestionNumber = 0;
    correctScore = 0;
    totalClearTime = 0;
    trialLog = [];
    answering = false;
    
    // UI要素を表示/非表示
    gameMainArea.classList.remove('hidden');
    resultArea.classList.add('hidden');
    
    console.log(`ゲーム開始 - フェーズ: ${PHASE_SETTINGS[currentPhase].name}`);
    
    // カウントダウンを表示してからゲーム開始
    showCountdown();
}

/**
 * 次の問題を生成
 */
function nextQuestion() {
    if (currentQuestionNumber >= MAX_QUESTIONS) {
        endGame();
        return;
    }
    
    currentQuestionNumber++;
    remainingTime = TIME_LIMIT;
    answering = false;

    // UI更新
    updateDisplay();
    
    // 問題生成
    generateQuestion();
    
    // タイマー開始
    startTimer();
}

/**
 * 問題を生成
 */
function generateQuestion() {
    // ターゲットのガボールパッチをその場でランダム生成（固定画像を使い回さないことで記憶による正答を防ぐ）。
    // 生成したcanvasはそのまま描画に使い、<img>のbase64変換は挟まない
    // （30問休憩なしの事前/事後テストでtoDataURL()＋<img>デコードを大量に繰り返すと
    // ブラウザの画像キャッシュにメモリが積み上がり、終盤で固まる原因になっていたため）
    targetConfig = randomGaborConfig();
    targetImage = renderGaborCanvas(targetConfig);

    // ターゲットが含まれるかどうかをランダムに決定
    hasTarget = Math.random() < 0.5;

    // 9個のガボールパッチを生成
    gaborPatches = [];

    if (hasTarget) {
        // ターゲットと同じ画像（同一パラメータ）を1枚含める
        gaborPatches.push(targetImage);
        for (let i = 0; i < PATCH_COUNT - 1; i++) {
            gaborPatches.push(renderGaborCanvas(randomDistractorConfig(targetConfig)));
        }
    } else {
        for (let i = 0; i < PATCH_COUNT; i++) {
            gaborPatches.push(renderGaborCanvas(randomDistractorConfig(targetConfig)));
        }
    }

    // 配列をシャッフル
    gaborPatches = shuffleArray(gaborPatches);

    // 問題開始時刻を記録
    questionStartTime = Date.now();

    // UIに反映
    displayQuestion();

    console.log(`問題 ${currentQuestionNumber}: ターゲット ${hasTarget ? 'あり' : 'なし'}`);
}

/**
 * 表示用の永続canvasを初回だけ作成する（毎問題ごとに<img>を作り直さず使い回す）
 */
function ensureDisplayCanvases() {
    // canvasは属性未指定だとデフォルトでwidth=300,height=150になる。
    // widthだけを条件にすると偶然300のままheightだけ150で放置され続けてしまう
    // ため、正方形かどうかで判定する（=毎回同じ値を入れ直すのは無害なので簡略化）。
    if (targetImageElement.width !== 300 || targetImageElement.height !== 300) {
        targetImageElement.width = 300;
        targetImageElement.height = 300;
    }
    if (patchCanvases.length === PATCH_COUNT) return;
    gaborArea.innerHTML = '';
    patchCanvases = [];
    for (let i = 0; i < PATCH_COUNT; i++) {
        const canvas = document.createElement('canvas');
        canvas.className = 'gabor-patch';
        canvas.width = 200;
        canvas.height = 200;
        gaborArea.appendChild(canvas);
        patchCanvases.push(canvas);
    }
}

// 生成したガボールパッチ(srcCanvas)を表示用canvasへ、CSSのobject-fit:coverと
// 同じ見た目になるよう中央をクロップして描画する（canvasはobject-fitが効かないため）
function drawGaborCover(destCanvas, srcCanvas) {
    const destW = destCanvas.width, destH = destCanvas.height;
    const srcW = srcCanvas.width, srcH = srcCanvas.height;
    const destAspect = destW / destH;
    const srcAspect = srcW / srcH;

    let sx, sy, sw, sh;
    if (srcAspect > destAspect) {
        sh = srcH;
        sw = srcH * destAspect;
        sy = 0;
        sx = (srcW - sw) / 2;
    } else {
        sw = srcW;
        sh = srcW / destAspect;
        sx = 0;
        sy = (srcH - sh) / 2;
    }

    const ctx = destCanvas.getContext('2d');
    ctx.clearRect(0, 0, destW, destH);
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, destW, destH);
}

/**
 * 問題をUIに表示
 */
function displayQuestion() {
    ensureDisplayCanvases();

    // ターゲット画像を表示
    drawGaborCover(targetImageElement, targetImage);

    // 9個のガボールパッチを表示
    gaborPatches.forEach((srcCanvas, index) => {
        drawGaborCover(patchCanvases[index], srcCanvas);
    });

    // フィードバックをクリア
    feedbackElement.textContent = '';
    feedbackElement.className = 'feedback';
}

/**
 * 表示を更新
 */
function updateDisplay() {
    scoreDisplay.textContent = correctScore;
    questionCountDisplay.textContent = `${currentQuestionNumber} / ${MAX_QUESTIONS}`;
    timerDisplay.textContent = remainingTime;
}

/**
 * タイマー開始
 */
function startTimer() {
    timer = setInterval(() => {
        remainingTime--;
        timerDisplay.textContent = remainingTime;
        
        if (remainingTime <= 0) {
            // 時間切れ
            checkAnswer(false, true); // timeoutフラグをtrue
        }
    }, 1000);
}

/**
 * タイマー停止
 */
function stopTimer() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

/**
 * 回答をチェック
 */
function checkAnswer(userAnswer, isTimeout = false) {
    if (answering) return; // 連打・タイムアウトとの同時押しによる多重発火を防止
    answering = true;
    stopTimer();

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
        feedbackElement.textContent = `正解！ (${responseTime.toFixed(1)}秒)`;
        feedbackElement.className = 'feedback correct';
    } else if (isTimeout) {
        feedbackElement.textContent = '時間切れ！';
        feedbackElement.className = 'feedback incorrect';
    } else {
        feedbackElement.textContent = `不正解 (正解: ${hasTarget ? 'ある' : 'ない'})`;
        feedbackElement.className = 'feedback incorrect';
    }
    
    // 表示を更新
    updateDisplay();
    
    // 少し待ってから次の問題へ
    setTimeout(() => {
        nextQuestion();
    }, 1500);
}

/**
 * 評価を計算
 */
function calculateGrade(score, averageTime) {
    const accuracy = (score / MAX_QUESTIONS) * 100;
    const avgTime = averageTime / MAX_QUESTIONS;
    
    if (accuracy === 100 && avgTime <= 5) return 'S';
    if (accuracy >= 80 && avgTime <= 7) return 'A';
    if (accuracy >= 60 && avgTime <= 8) return 'B';
    if (accuracy >= 40) return 'C';
    return 'D';
}

/**
 * ゲーム終了時の処理
 */
function endGame() {
    stopTimer();

    const grade = calculateGrade(correctScore, totalClearTime);
    const sdt = computeSignalDetectionCounts(trialLog);

    // スコアを履歴に保存
    const history = JSON.parse(localStorage.getItem('gaborGameHistory') || '[]');
    const newEntry = {
        date: new Date().toISOString(),
        score: correctScore,
        totalTime: totalClearTime,
        grade: grade,
        accuracy: (correctScore / MAX_QUESTIONS) * 100,
        difficulty: currentDifficulty,
        totalQuestions: MAX_QUESTIONS,
        phase: currentPhase, // training / pre_test / post_test
        platform: 'pc', // PC版であることを記録（VR版との比較用）
        trialLog: trialLog,
        signalDetection: sdt
    };
    history.push(newEntry);
    localStorage.setItem('gaborGameHistory', JSON.stringify(history));

    submitScoreToGoogleForm({
        difficulty: currentDifficulty,
        phase: currentPhase,
        platform: 'pc',
        score: correctScore,
        totalTime: totalClearTime,
        grade: grade,
        trialLog: trialLog
    });

    gameMainArea.classList.add('hidden');
    resultArea.classList.remove('hidden');

    const resultHeading = document.getElementById('result-heading');
    if (resultHeading) {
        resultHeading.textContent = `${PHASE_SETTINGS[currentPhase].name}終了！`;
    }
    finalScoreDisplay.textContent = `あなたのスコア: ${correctScore} / ${MAX_QUESTIONS} (${(correctScore / MAX_QUESTIONS * 100).toFixed(0)}%)`;
    finalTimeDisplay.textContent = `総クリアタイム: ${totalClearTime.toFixed(1)}秒 (平均: ${(totalClearTime / MAX_QUESTIONS).toFixed(1)}秒/問)`;
    finalGradeDisplay.textContent = `評価: ${grade}`;
    
    // 評価に応じてクラスを設定
    finalGradeDisplay.className = `grade grade-${grade}`;
}

/**
 * カウントダウン表示
 */
function showCountdown() {
    console.log('=== カウントダウン開始 ===');
    
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    
    console.log('カウントダウン要素取得結果:');
    console.log('- countdownOverlay:', countdownOverlay);
    console.log('- countdownNumber:', countdownNumber);
    
    if (!countdownOverlay || !countdownNumber) {
        console.warn('❌ カウントダウン要素が見つかりません');
        console.log('利用可能な要素ID一覧:');
        const allElements = document.querySelectorAll('[id]');
        allElements.forEach(el => console.log(`- ${el.id}`));
        nextQuestion(); // カウントダウンなしでゲーム開始
        return;
    }
    
    console.log('✅ カウントダウン要素が正常に取得されました');
    countdownOverlay.classList.remove('hidden');
    let count = 3;
    
    countdownNumber.textContent = count;
    console.log(`カウントダウン開始: ${count}`);
    
    const countdownInterval = setInterval(() => {
        count--;
        console.log(`カウントダウン: ${count}`);
        
        if (count > 0) {
            countdownNumber.textContent = count;
        } else {
            countdownNumber.textContent = 'START!';
            countdownNumber.style.color = '#28a745';
            console.log('🚀 ゲーム開始！');
            
            setTimeout(() => {
                countdownOverlay.classList.add('hidden');
                countdownNumber.style.color = '#007bff'; // 色をリセット
                nextQuestion(); // ゲーム開始
            }, 500);
            
            clearInterval(countdownInterval);
        }
    }, 1000);
}

// --- イベントリスナー ---
btnYes.addEventListener('click', () => checkAnswer(true));
btnNo.addEventListener('click', () => checkAnswer(false));

// --- 再開用の関数 ---
async function restartGame() {
    console.log('ゲームを再開します...');
    try {
        await startGame();
    } catch (error) {
        console.error('ゲーム再開エラー:', error);
        alert('ゲームの再開に失敗しました。ページを再読み込みしてください。');
    }
}

// --- 起動 ---
// ページ読み込み完了後にゲームを開始
window.addEventListener('DOMContentLoaded', async () => {
    console.log('ページ読み込み完了、ゲームを開始します...');
    try {
        await startGame();
    } catch (error) {
        console.error('ゲーム開始エラー:', error);
        alert('ゲームの開始に失敗しました。ページを再読み込みしてください。');
    }
});