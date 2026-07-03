"""
実データが集まる前にanalyze.pyの動作確認をするための、
Googleフォームのスプレッドシート出力を模したダミーCSVを生成するスクリプト。
"""
import csv
import random
from datetime import datetime, timedelta

random.seed(0)

PARTICIPANTS = ["たなか", "さとう", "すずき", "やまだ", "いとう", "わたなべ", "こばやし", "かとう"]
DIFFICULTIES = ["初心者", "中級者", "上級者"]

OUT_PATH = "mock_form_responses.csv"

rows = []
start = datetime(2026, 7, 1, 10, 0, 0)

for name in PARTICIPANTS:
    # 参加者ごとに、PC/VRそれぞれ何回プレイしたかをランダムに決める
    n_pc = random.randint(3, 8)
    n_vr = random.randint(0, 6)  # 一部の人はVRを試さない想定
    base_skill = random.uniform(40, 60)  # 初期の正答率(%)の個人差
    learning_rate = random.uniform(2, 6)  # 慣れによる伸び幅(play_noごとの改善分、逓減)
    vr_penalty = random.uniform(0, 12)  # VRの方が難しく感じる度合いの個人差

    t = start + timedelta(minutes=random.randint(0, 600))
    plays = [("PC", i) for i in range(1, n_pc + 1)] + [("VR", i) for i in range(1, n_vr + 1)]
    random.shuffle(plays)  # PC/VRを行き来する参加者もいる想定

    for play_no, (platform, _) in enumerate(plays, start=1):
        # 学習曲線: 対数的に頭打ちになるように
        accuracy = base_skill + learning_rate * (play_no ** 0.5) + random.gauss(0, 8)
        if platform == "VR":
            accuracy -= vr_penalty
        accuracy = max(0, min(100, accuracy))
        score = round(accuracy / 10)  # MAX_QUESTIONS=10 換算
        score = max(0, min(10, score))

        avg_time_per_q = random.uniform(3, 9) - (play_no * 0.05)
        avg_time_per_q = max(1.5, avg_time_per_q)
        total_time = round(avg_time_per_q * 10, 1)

        if score == 10 and avg_time_per_q <= 5:
            grade = "S"
        elif score >= 8 and avg_time_per_q <= 7:
            grade = "A"
        elif score >= 6 and avg_time_per_q <= 8:
            grade = "B"
        elif score >= 4:
            grade = "C"
        else:
            grade = "D"

        t += timedelta(minutes=random.randint(5, 240))
        rows.append([
            t.strftime("%Y/%m/%d %H:%M:%S"),
            name,
            random.choice(DIFFICULTIES),
            platform,
            score,
            total_time,
            grade,
        ])

rows.sort(key=lambda r: r[0])

with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow([
        "タイムスタンプ",
        "お名前・ニックネーム　（2回目以降ずっとその名前でお願いします）",
        "難易度",
        "プラットフォーム",
        "スコア",
        "総クリアタイム",
        "評価",
    ])
    writer.writerows(rows)

print(f"{len(rows)}件のダミーデータを {OUT_PATH} に出力しました。")
