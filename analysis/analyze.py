"""
ガボールパッチ・アイ・トレーナーのGoogleフォーム回答(CSVエクスポート)を分析する。

- B: 学習曲線分析(プレイ回数 × スコアの推移)
- C: PC vs VR の統計的比較(対応のあるt検定 / Wilcoxonの符号順位検定)
- E: 参加者ごとの特徴量によるクラスタリング(k-means)

使い方:
    python3 analyze.py --input responses.csv --outdir output
    (--input を省略すると、動作確認用にダミーデータを自動生成して使う)
"""
import argparse
import os

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

MAX_QUESTIONS = 10  # script.js / vr-script.js の MAX_QUESTIONS と合わせる

sns.set_theme(style="whitegrid", font="Hiragino Sans")


def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    colmap = {}
    for col in df.columns:
        if "タイムスタンプ" in col:
            colmap[col] = "timestamp"
        elif "お名前" in col:
            colmap[col] = "name"
        elif "難易度" in col:
            colmap[col] = "difficulty"
        elif "プラットフォーム" in col:
            colmap[col] = "platform"
        elif "スコア" in col:
            colmap[col] = "score"
        elif "クリアタイム" in col:
            colmap[col] = "total_time"
        elif "評価" in col:
            colmap[col] = "grade"
        elif "ヒット" in col:
            colmap[col] = "hits"
        elif "見逃し" in col:
            colmap[col] = "misses"
        elif "フォルスアラーム" in col:
            colmap[col] = "false_alarms"
        elif "正棄却" in col:
            colmap[col] = "correct_rejections"
    df = df.rename(columns=colmap)

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["score"] = pd.to_numeric(df["score"], errors="coerce")
    df["total_time"] = pd.to_numeric(df["total_time"], errors="coerce")
    df = df.dropna(subset=["timestamp", "name", "score", "total_time"]).copy()

    df["accuracy"] = df["score"] / MAX_QUESTIONS * 100
    df["avg_time_per_q"] = df["total_time"] / MAX_QUESTIONS

    sdt_cols = ["hits", "misses", "false_alarms", "correct_rejections"]
    if all(c in df.columns for c in sdt_cols):
        for c in sdt_cols:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        df["d_prime"] = compute_d_prime(df["hits"], df["misses"], df["false_alarms"], df["correct_rejections"])
    else:
        print("注意: ヒット数/見逃し数/フォルスアラーム数/正棄却数の列が見つからないため、d′は計算しません"
              "(Googleフォームにこれらの質問を追加し、スプレッドシートを再エクスポートしてください)。")

    df = df.sort_values(["name", "timestamp"])
    df["play_no"] = df.groupby("name").cumcount() + 1
    return df


def compute_d_prime(hits, misses, false_alarms, correct_rejections):
    """信号検出理論の感度指標 d′ = Z(ヒット率) - Z(フォルスアラーム率)。
    0%/100%になるとZ変換できないため、loglinear補正(0.5を加える)を使う。"""
    n_target_present = hits + misses
    n_target_absent = false_alarms + correct_rejections
    hit_rate = (hits + 0.5) / (n_target_present + 1)
    fa_rate = (false_alarms + 0.5) / (n_target_absent + 1)
    return stats.norm.ppf(hit_rate) - stats.norm.ppf(fa_rate)


def analyze_learning_curve(df: pd.DataFrame, outdir: str) -> pd.DataFrame:
    """B: プレイ回数を重ねるほどスコアが上がっているか(慣れ/学習効果)を可視化・定量化する"""
    fig, ax = plt.subplots(figsize=(8, 5))
    for name, g in df.groupby("name"):
        ax.plot(g["play_no"], g["accuracy"], marker="o", alpha=0.4, label=name)

    # play_noごとの平均正答率(参加者間で揃えた学習曲線)
    mean_curve = df.groupby("play_no")["accuracy"].mean()
    ax.plot(mean_curve.index, mean_curve.values, color="black", linewidth=3, marker="o", label="全体平均")

    ax.set_xlabel("プレイ回数(その人にとって何回目か)")
    ax.set_ylabel("正答率 (%)")
    ax.set_title("学習曲線: プレイ回数とスコアの推移")
    ax.legend(fontsize=7, ncol=2, loc="lower right")
    fig.tight_layout()
    fig.savefig(os.path.join(outdir, "learning_curve.png"), dpi=150)
    plt.close(fig)

    # 参加者ごとに「回数を重ねるほど伸びているか」を線形回帰の傾きで定量化
    rows = []
    for name, g in df.groupby("name"):
        if len(g) >= 3:
            slope, intercept, r, p, se = stats.linregress(g["play_no"], g["accuracy"])
        else:
            slope, r, p = np.nan, np.nan, np.nan
        rows.append({"name": name, "n_plays": len(g), "slope_per_play": slope, "r": r, "p_value": p})
    slopes = pd.DataFrame(rows)
    slopes.to_csv(os.path.join(outdir, "learning_curve_slopes.csv"), index=False)

    print("\n=== B: 学習曲線(参加者ごとの傾き) ===")
    print(slopes.to_string(index=False))
    sig = slopes.dropna(subset=["p_value"])
    n_sig_positive = ((sig["slope_per_play"] > 0) & (sig["p_value"] < 0.05)).sum()
    print(f"→ 有意に正の学習傾向(p<0.05)を示した参加者: {n_sig_positive} / {len(sig)} 人")

    if "d_prime" in df.columns:
        # 正答率だけでなくd′(応答バイアスを除いた純粋な知覚感度)でも学習曲線を見る
        fig2, ax2 = plt.subplots(figsize=(8, 5))
        for name, g in df.groupby("name"):
            ax2.plot(g["play_no"], g["d_prime"], marker="o", alpha=0.4, label=name)
        mean_d_curve = df.groupby("play_no")["d_prime"].mean()
        ax2.plot(mean_d_curve.index, mean_d_curve.values, color="black", linewidth=3, marker="o", label="全体平均")
        ax2.set_xlabel("プレイ回数(その人にとって何回目か)")
        ax2.set_ylabel("d′ (感度)")
        ax2.set_title("学習曲線: プレイ回数とd′の推移")
        ax2.legend(fontsize=7, ncol=2, loc="lower right")
        fig2.tight_layout()
        fig2.savefig(os.path.join(outdir, "learning_curve_dprime.png"), dpi=150)
        plt.close(fig2)
        print("→ d′ベースの学習曲線を learning_curve_dprime.png に保存しました。")

    return slopes


def analyze_platform_comparison(df: pd.DataFrame, outdir: str) -> pd.DataFrame:
    """C: PC版とVR版で成績に有意差があるかを検証する(参加者内対応あり比較)"""
    per_person_platform = df.groupby(["name", "platform"])["accuracy"].mean().unstack()

    fig, axes = plt.subplots(1, 2, figsize=(11, 5))
    sns.boxplot(data=df, x="platform", y="accuracy", ax=axes[0])
    sns.stripplot(data=df, x="platform", y="accuracy", color="black", alpha=0.4, ax=axes[0])
    axes[0].set_title("プラットフォーム別 正答率")
    axes[0].set_xlabel("")
    axes[0].set_ylabel("正答率 (%)")

    sns.boxplot(data=df, x="difficulty", y="accuracy", hue="platform",
                order=["初心者", "中級者", "上級者"], ax=axes[1])
    axes[1].set_title("難易度 × プラットフォーム")
    axes[1].set_xlabel("難易度")
    axes[1].set_ylabel("正答率 (%)")
    fig.tight_layout()
    fig.savefig(os.path.join(outdir, "platform_comparison.png"), dpi=150)
    plt.close(fig)

    paired = per_person_platform.dropna(subset=["PC", "VR"]) if {"PC", "VR"}.issubset(per_person_platform.columns) else pd.DataFrame()
    per_person_platform.to_csv(os.path.join(outdir, "per_person_platform_accuracy.csv"))

    print("\n=== C: PC vs VR ===")
    print(per_person_platform.to_string())
    if len(paired) >= 2:
        t_stat, t_p = stats.ttest_rel(paired["PC"], paired["VR"])
        w_stat, w_p = stats.wilcoxon(paired["PC"], paired["VR"])
        print(f"対応のあるt検定: t={t_stat:.3f}, p={t_p:.4f} (n={len(paired)}人)")
        print(f"Wilcoxonの符号順位検定: W={w_stat:.3f}, p={w_p:.4f}")
        print("→ p<0.05ならPCとVRで正答率に統計的に有意な差があると言える")
    else:
        print("PC・VR両方をプレイした参加者が2人未満のため、対応のある検定はスキップしました。")

    if "d_prime" in df.columns:
        per_person_platform_d = df.groupby(["name", "platform"])["d_prime"].mean().unstack()
        paired_d = per_person_platform_d.dropna(subset=["PC", "VR"]) if {"PC", "VR"}.issubset(per_person_platform_d.columns) else pd.DataFrame()
        print("\n=== C': PC vs VR (d′ベース、応答バイアスを除いた感度の比較) ===")
        print(per_person_platform_d.to_string())
        if len(paired_d) >= 2:
            t_stat, t_p = stats.ttest_rel(paired_d["PC"], paired_d["VR"])
            w_stat, w_p = stats.wilcoxon(paired_d["PC"], paired_d["VR"])
            print(f"対応のあるt検定(d′): t={t_stat:.3f}, p={t_p:.4f} (n={len(paired_d)}人)")
            print(f"Wilcoxonの符号順位検定(d′): W={w_stat:.3f}, p={w_p:.4f}")
        else:
            print("PC・VR両方をプレイした参加者が2人未満のため、d′の対応のある検定はスキップしました。")
        per_person_platform_d.to_csv(os.path.join(outdir, "per_person_platform_dprime.csv"))

    return per_person_platform


def analyze_clusters(df: pd.DataFrame, learning_slopes: pd.DataFrame,
                      platform_table: pd.DataFrame, outdir: str, k: int = 3) -> pd.DataFrame:
    """E: 参加者を「初期スコア」「伸び率」「PC-VR差」などの特徴量でクラスタリングする"""
    features = df.groupby("name").agg(
        avg_accuracy=("accuracy", "mean"),
        first_accuracy=("accuracy", "first"),
        avg_time_per_q=("avg_time_per_q", "mean"),
        n_plays=("accuracy", "count"),
    ).reset_index()

    features = features.merge(learning_slopes[["name", "slope_per_play"]], on="name", how="left")

    if {"PC", "VR"}.issubset(platform_table.columns):
        pc_vr_diff = (platform_table["VR"] - platform_table["PC"]).rename("pc_vr_diff").reset_index()
        features = features.merge(pc_vr_diff, on="name", how="left")
    else:
        features["pc_vr_diff"] = np.nan

    # 回帰が引けない/VR未プレイなどでNaNになった特徴量は中央値で補完
    feature_cols = ["avg_accuracy", "first_accuracy", "avg_time_per_q", "slope_per_play", "pc_vr_diff"]
    for col in feature_cols:
        features[col] = features[col].fillna(features[col].median())

    n_samples = len(features)
    k_eff = max(1, min(k, n_samples))
    if n_samples < 4:
        print(f"\n=== E: クラスタリング ===\n参加者が{n_samples}人しかいないため、クラスタリング結果はあくまで参考程度です。"
              "本番の発表では最低6〜8人以上のデータを推奨します。")

    X = StandardScaler().fit_transform(features[feature_cols])
    kmeans = KMeans(n_clusters=k_eff, n_init=10, random_state=0).fit(X)
    features["cluster"] = kmeans.labels_

    pca = PCA(n_components=2, random_state=0)
    coords = pca.fit_transform(X)

    fig, ax = plt.subplots(figsize=(7, 6))
    scatter = ax.scatter(coords[:, 0], coords[:, 1], c=features["cluster"], cmap="tab10", s=100)
    for i, name in enumerate(features["name"]):
        ax.annotate(name, (coords[i, 0], coords[i, 1]), fontsize=8, xytext=(4, 4), textcoords="offset points")
    ax.set_xlabel("PC1")
    ax.set_ylabel("PC2")
    ax.set_title(f"参加者クラスタリング (k={k_eff}, 特徴量をPCAで2次元に圧縮)")
    fig.tight_layout()
    fig.savefig(os.path.join(outdir, "clusters.png"), dpi=150)
    plt.close(fig)

    features.to_csv(os.path.join(outdir, "participant_features_clusters.csv"), index=False)

    print("\n=== E: クラスタリング結果 ===")
    print(features[["name", "avg_accuracy", "slope_per_play", "pc_vr_diff", "cluster"]].to_string(index=False))
    print("→ クラスタごとの特徴(例: 伸び率が高い人、VRが苦手な人など)を participant_features_clusters.csv から解釈して発表資料に使ってください。")

    return features


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=None, help="Googleスプレッドシートからエクスポートしたresponses.csvのパス")
    parser.add_argument("--outdir", default="output")
    parser.add_argument("--k", type=int, default=3, help="クラスタリングのクラスタ数")
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)

    input_path = args.input
    if input_path is None:
        print("--input が指定されていないため、動作確認用のダミーデータを生成して使用します。")
        import generate_mock_data  # noqa: F401 (実行するとmock_form_responses.csvが作られる)
        input_path = "mock_form_responses.csv"

    df = load_data(input_path)
    print(f"読み込み件数: {len(df)}件 / 参加者数: {df['name'].nunique()}人")

    slopes = analyze_learning_curve(df, args.outdir)
    platform_table = analyze_platform_comparison(df, args.outdir)
    analyze_clusters(df, slopes, platform_table, args.outdir, k=args.k)

    print(f"\n画像・CSVは {args.outdir}/ に保存しました。")


if __name__ == "__main__":
    main()
