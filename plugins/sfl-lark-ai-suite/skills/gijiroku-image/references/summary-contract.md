# 構造化要約の契約

逐字稿を分析した結果を、次のJSON構造で `summary.json` に保存する。存在しない事実は空配列または「未定」にし、推測で補完しない。

```json
{
  "title": "会議の正式タイトル",
  "meeting_date": "YYYY-MM-DD または記載なし",
  "participants": ["氏名"],
  "summary_depth": "short | standard | detailed",
  "overview": ["会議全体の要旨"],
  "key_points": [
    {"heading": "論点", "details": ["具体的な内容"]}
  ],
  "decisions": ["確定した事項"],
  "action_items": [
    {"task": "実施内容", "owner": "担当者または未定", "due": "期限または未定"}
  ],
  "open_questions": ["未解決事項"]
}
```

要約量の基準:

- `short`: `overview`、`decisions`、`action_items` を優先。原則1ページ。
- `standard`: 重要な `key_points` も含める。原則1〜2ページ。
- `detailed`: 背景、論点、判断理由、未解決事項を省略しすぎない。原則2〜4ページ。

逐字稿中の発言とLark側のsummary/todoが食い違う場合、逐字稿を優先し、断定できない事項は明記する。
