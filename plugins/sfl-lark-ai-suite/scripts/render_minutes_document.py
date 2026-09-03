#!/usr/bin/env python3
"""Render structured minutes JSON as deterministic Lark Docs XML."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape, quoteattr


def items(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def text(value: Any, fallback: str = "記載なし") -> str:
    normalized = " ".join(str(value or "").split())
    return normalized or fallback


def bullet_list(values: list[Any], empty: str = "記載なし") -> str:
    normalized = [text(value, "") for value in values]
    normalized = [value for value in normalized if value]
    if not normalized:
        return f"<p>{escape(empty)}</p>"
    return "<ul>" + "".join(f"<li>{escape(value)}</li>" for value in normalized) + "</ul>"


def render(data: dict[str, Any]) -> str:
    title = text(data.get("title"), "議事録")
    date = text(data.get("meeting_date"))
    participants = "、".join(text(value, "") for value in items(data.get("participants"))) or "記載なし"
    output = [
        f"<title>{escape(title)}｜議事録</title>",
        '<callout emoji="📝" background-color="light-blue" border-color="blue">',
        f"<p><b>開催日</b>　{escape(date)}</p>",
        f"<p><b>参加者</b>　{escape(participants)}</p>",
        "</callout>",
    ]

    source_url = text(data.get("source_url"), "")
    if source_url.startswith(("https://", "http://")):
        output.append(f'<p><a type="url-preview" href={quoteattr(source_url)}>元のMinutesを開く</a></p>')

    output.extend(["<h1>会議の要旨</h1>", bullet_list(items(data.get("overview")))])

    output.append("<h1>重要論点</h1>")
    key_points = items(data.get("key_points"))
    if key_points:
        for point in key_points:
            if isinstance(point, dict):
                output.append(f"<h2>{escape(text(point.get('heading'), '重要論点'))}</h2>")
                output.append(bullet_list(items(point.get("details"))))
            else:
                output.append(f"<p>{escape(text(point))}</p>")
    else:
        output.append("<p>記載なし</p>")

    output.extend(["<h1>決定事項</h1>", bullet_list(items(data.get("decisions")))])

    output.append("<h1>アクション</h1>")
    actions = items(data.get("action_items"))
    if actions:
        output.append(
            '<table><colgroup><col width="420"/><col width="180"/><col width="180"/></colgroup>'
            '<thead><tr><th background-color="light-gray"><p>実施内容</p></th>'
            '<th background-color="light-gray"><p>担当</p></th>'
            '<th background-color="light-gray"><p>期限</p></th></tr></thead><tbody>'
        )
        for action in actions:
            if isinstance(action, dict):
                task = text(action.get("task"))
                owner = text(action.get("owner"), "未定")
                due = text(action.get("due"), "未定")
            else:
                task, owner, due = text(action), "未定", "未定"
            output.append(
                f"<tr><td><p>{escape(task)}</p></td><td><p>{escape(owner)}</p></td>"
                f"<td><p>{escape(due)}</p></td></tr>"
            )
        output.append("</tbody></table>")
    else:
        output.append("<p>記載なし</p>")

    output.extend(["<h1>未解決・確認事項</h1>", bullet_list(items(data.get("open_questions")))])
    return "\n".join(output) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    data = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("入力JSONはオブジェクトである必要があります")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render(data), encoding="utf-8")
    print(json.dumps({"ok": True, "file": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
