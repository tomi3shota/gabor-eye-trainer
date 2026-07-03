// ガボールパッチをブラウザ上で毎回動的に生成する共通モジュール（PC版・VR版で共有）。
// generate_gabor.py と同じ数式（ガウス包絡 × 正弦波格子）をCanvas上でピクセル単位に再現している。
// 固定47枚の画像を使い回すと参加者が「画像そのもの」を覚えてしまう恐れがあるため、
// 毎試行ごとにランダムなパラメータで新しいパッチを描画し、記憶による正答を防ぐ。

function randomGaborConfig() {
    const width = 220 + Math.floor(Math.random() * 80); // 220-300px
    const height = Math.round(width * (0.92 + Math.random() * 0.16)); // 縦横比 0.92-1.08
    return {
        width,
        height,
        orientationDeg: Math.floor(Math.random() * 180), // 向き 0-179度（180度で対称なため）
        cycles: 1 + Math.random() * 4.5,                 // 空間周波数
        sigmaRatio: 0.15 + Math.random() * 0.15,          // 包絡（ぼかし範囲）の比率
        phase: Math.random() < 0.3 ? Math.random() * 0.4 : 0,
        contrast: 0.85 + Math.random() * 0.13
    };
}

// 向きの差を0-90度で返す（180度周期の対称性を考慮）
function gaborOrientationDiff(a, b) {
    const d = Math.abs(a - b) % 180;
    return Math.min(d, 180 - d);
}

// ターゲットと紛らわしくなりすぎないよう、向き・周波数を十分ずらしたダミーパッチを作る
function randomDistractorConfig(targetConfig) {
    let config;
    let attempts = 0;
    do {
        config = randomGaborConfig();
        attempts++;
    } while (
        attempts < 20 &&
        gaborOrientationDiff(config.orientationDeg, targetConfig.orientationDeg) < 20 &&
        Math.abs(config.cycles - targetConfig.cycles) < 0.8
    );
    return config;
}

function renderGaborCanvas(config) {
    const { width, height, orientationDeg, cycles, sigmaRatio, phase, contrast } = config;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const theta = orientationDeg * Math.PI / 180;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const sigma = sigmaRatio * Math.min(width, height);
    const twoSigma2 = 2 * sigma * sigma;

    for (let j = 0; j < height; j++) {
        const y = j - cy;
        for (let i = 0; i < width; i++) {
            const x = i - cx;
            const xp = x * cosT + y * sinT;
            const yp = -x * sinT + y * cosT;

            const envelope = Math.exp(-(xp * xp + yp * yp) / twoSigma2);
            const grating = Math.cos((2 * Math.PI * cycles * xp) / width + phase);
            const darkness = envelope * ((1 - grating) / 2) * contrast;
            let value = 1 - darkness;
            value = Math.max(0, Math.min(1, value));

            const gray = Math.round(value * 255);
            const idx = (j * width + i) * 4;
            data[idx] = gray;
            data[idx + 1] = gray;
            data[idx + 2] = gray;
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function renderGaborDataURL(config) {
    return renderGaborCanvas(config).toDataURL('image/png');
}
