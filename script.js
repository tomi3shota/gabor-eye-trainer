// --- 設定 ---
const MAX_QUESTIONS = 10; // 1セットの問題数
const PATCH_COUNT = 9;   // 画面に表示するガボールパッチの総数 (3x3=9)

// 難易度設定
const DIFFICULTY_SETTINGS = {
    beginner: { timeLimit: 10, name: '初級' },
    intermediate: { timeLimit: 5, name: '中級' },
    advanced: { timeLimit: 3, name: '上級' }
};

let currentDifficulty = 'beginner'; // デフォルト難易度
let TIME_LIMIT = 10; // 動的に変更される制限時間

// --- DOM要素 ---
const gaborArea = document.getElementById('gabor-area');
const scoreDisplay = document.getElementById('current-score');
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
let targetImage = '';
let targetConfig = null;
let hasTarget = false;
let gaborPatches = [];
let trialLog = []; // 問題単位のログ（信号検出理論のd′計算に使用）

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
    
    // 難易度設定を読み込み
    const selectedDifficulty = localStorage.getItem('selectedDifficulty') || 'beginner';
    currentDifficulty = selectedDifficulty;
    TIME_LIMIT = DIFFICULTY_SETTINGS[selectedDifficulty].timeLimit;
    
    console.log('選択された難易度:', selectedDifficulty);
    console.log('制限時間:', TIME_LIMIT);
    
    // 難易度情報を表示
    const difficultyInfo = document.getElementById('difficulty-info');
    if (difficultyInfo) {
        difficultyInfo.textContent = `${DIFFICULTY_SETTINGS[selectedDifficulty].name} (制限時間: ${TIME_LIMIT}秒)`;
    }
    
    // ゲーム状態をリセット
    currentQuestionNumber = 0;
    correctScore = 0;
    totalClearTime = 0;
    trialLog = [];
    
    // UI要素を表示/非表示
    gameMainArea.classList.remove('hidden');
    resultArea.classList.add('hidden');
    
    console.log(`ゲーム開始 - 難易度: ${DIFFICULTY_SETTINGS[selectedDifficulty].name}`);
    
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
    // ターゲットのガボールパッチをその場でランダム生成（固定画像を使い回さないことで記憶による正答を防ぐ）
    targetConfig = randomGaborConfig();
    targetImage = renderGaborDataURL(targetConfig);

    // ターゲットが含まれるかどうかをランダムに決定
    hasTarget = Math.random() < 0.5;

    // 9個のガボールパッチを生成
    gaborPatches = [];

    if (hasTarget) {
        // ターゲットと同じ画像（同一パラメータ）を1枚含める
        gaborPatches.push(targetImage);
        for (let i = 0; i < PATCH_COUNT - 1; i++) {
            gaborPatches.push(renderGaborDataURL(randomDistractorConfig(targetConfig)));
        }
    } else {
        for (let i = 0; i < PATCH_COUNT; i++) {
            gaborPatches.push(renderGaborDataURL(randomDistractorConfig(targetConfig)));
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
 * 問題をUIに表示
 */
function displayQuestion() {
    // ターゲット画像を表示
    targetImageElement.src = targetImage;
    targetImageElement.alt = 'お題の画像';
    
    // 画像読み込みエラーハンドリング
    targetImageElement.onerror = function() {
        console.error('ターゲット画像の読み込みに失敗:', targetImage);
        this.style.backgroundColor = '#f0f0f0';
        this.style.border = '2px dashed #ccc';
        this.alt = '画像読み込みエラー';
    };
    
    // ガボールパッチエリアをクリア
    gaborArea.innerHTML = '';
    
    // 9個のガボールパッチを表示
    gaborPatches.forEach((imagePath, index) => {
        const img = document.createElement('img');
        img.src = imagePath;
        img.alt = `ガボールパッチ ${index + 1}`;
        
        // 画像読み込みエラーハンドリング
        img.onerror = function() {
            console.error('ガボールパッチ画像の読み込みに失敗:', imagePath);
            this.style.backgroundColor = '#f0f0f0';
            this.style.border = '1px dashed #ccc';
            this.style.width = '150px';
            this.style.height = '150px';
            this.alt = `画像エラー ${index + 1}`;
        };
        img.className = 'gabor-patch';
        gaborArea.appendChild(img);
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
        platform: 'pc', // PC版であることを記録（VR版との比較用）
        trialLog: trialLog,
        signalDetection: sdt
    };
    history.push(newEntry);
    localStorage.setItem('gaborGameHistory', JSON.stringify(history));

    submitScoreToGoogleForm({
        difficulty: currentDifficulty,
        platform: 'pc',
        score: correctScore,
        totalTime: totalClearTime,
        grade: grade,
        trialLog: trialLog
    });

    gameMainArea.classList.add('hidden');
    resultArea.classList.remove('hidden');
    
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