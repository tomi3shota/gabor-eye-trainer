# スコア分析スクリプト

Googleフォームに集まったプレイ結果を分析し、発表用のグラフと統計量を出力する。

- **B. 学習曲線**: プレイ回数を重ねるごとに正答率が上がっているか(参加者ごとの傾き・p値)
- **C. PC vs VR比較**: 同一参加者のPC/VRの正答率を対応のあるt検定・Wilcoxonの符号順位検定で比較
- **E. クラスタリング**: 「平均正答率」「伸び率」「PC-VR差」などを特徴量にk-meansで参加者をグループ化

## セットアップ

```bash
cd analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 実行方法

1. Googleフォームの回答が集まったスプレッドシートを開く
2. 「ファイル」→「ダウンロード」→「カンマ区切り値(.csv)」でエクスポート
3. スクリプトを実行

```bash
python3 analyze.py --input path/to/responses.csv --outdir output
```

`--input` を省略すると、動作確認用のダミーデータ(`generate_mock_data.py`)を自動生成して実行される。

## 出力

`output/` フォルダに以下が生成される。

- `learning_curve.png` / `learning_curve_slopes.csv`
- `platform_comparison.png` / `per_person_platform_accuracy.csv`
- `clusters.png` / `participant_features_clusters.csv`

## 注意

- 現状のGoogleフォームは1セット(10問)終了時の集計値のみを送信しているため、d′(信号検出理論)のような問題単位の分析はできない
- クラスタリングは参加者が少ない(6〜8人未満)と結果の解釈が不安定になりやすい
