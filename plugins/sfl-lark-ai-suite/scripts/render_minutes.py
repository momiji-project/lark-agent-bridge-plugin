#!/usr/bin/env python3
"""Render verified Japanese minutes text over an AI-generated background."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

WIDTH = 1536
HEIGHT = 2048
MARGIN = 108
CONTENT_TOP = 330
CONTENT_BOTTOM = 1900
CARD_GAP = 28
TEXT_COLOR = (246, 248, 252, 255)
MUTED_COLOR = (205, 214, 230, 255)
ACCENT = (111, 196, 255, 255)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path(
            "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
            if bold
            else "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
        ),
        (
            Path.home() / "Library/Fonts/NotoSansJP-Bold.ttf"
            if bold
            else Path.home() / "Library/Fonts/NotoSansJP-Regular.ttf"
        ),
        Path.home() / "Library/Fonts/NotoSerifJP-Regular.ttf",
        Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def text_width(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont
) -> float:
    box = draw.textbbox((0, 0), text, font=font)
    return float(box[2] - box[0])


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    normalized = " ".join(str(text).replace("\n", " ").split())
    if not normalized:
        return []
    lines: list[str] = []
    current = ""
    for char in normalized:
        candidate = current + char
        if current and text_width(draw, candidate, font) > max_width:
            lines.append(current.rstrip())
            current = char.lstrip()
        else:
            current = candidate
    if current:
        lines.append(current.rstrip())
    return lines


def safe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def section_rows(data: dict[str, Any]) -> list[tuple[str, list[str]]]:
    sections: list[tuple[str, list[str]]] = []
    overview = [
        str(item) for item in safe_list(data.get("overview")) if str(item).strip()
    ]
    if overview:
        sections.append(("会議の要旨", overview))

    points: list[str] = []
    for item in safe_list(data.get("key_points")):
        if isinstance(item, dict):
            heading = str(item.get("heading") or "重要論点")
            details = " / ".join(
                str(detail)
                for detail in safe_list(item.get("details"))
                if str(detail).strip()
            )
            points.append(f"{heading}: {details}" if details else heading)
        elif str(item).strip():
            points.append(str(item))
    if points:
        sections.append(("重要論点", points))

    decisions = [
        str(item) for item in safe_list(data.get("decisions")) if str(item).strip()
    ]
    if decisions:
        sections.append(("決定事項", decisions))

    actions: list[str] = []
    for item in safe_list(data.get("action_items")):
        if isinstance(item, dict):
            task = str(item.get("task") or "記載なし")
            owner = str(item.get("owner") or "未定")
            due = str(item.get("due") or "未定")
            actions.append(f"{task}｜担当: {owner}｜期限: {due}")
        elif str(item).strip():
            actions.append(str(item))
    if actions:
        sections.append(("アクション", actions))

    questions = [
        str(item)
        for item in safe_list(data.get("open_questions"))
        if str(item).strip()
    ]
    if questions:
        sections.append(("未解決・確認事項", questions))
    return sections


def split_sections(data: dict[str, Any]) -> list[list[tuple[str, list[str]]]]:
    probe = Image.new("RGBA", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(probe)
    body_font = load_font(34)
    max_width = WIDTH - (MARGIN * 2) - 96
    cards: list[tuple[str, list[str], int]] = []
    for title, items in section_rows(data):
        wrapped: list[str] = []
        for item in items:
            wrapped.extend(wrap_text(draw, f"• {item}", body_font, max_width) or ["•"])
        for start in range(0, len(wrapped), 15):
            chunk = wrapped[start : start + 15]
            label = title if start == 0 else f"{title}（続き）"
            height = 52 + len(chunk) * 53 + 58
            cards.append((label, chunk, height))

    pages: list[list[tuple[str, list[str]]]] = []
    current: list[tuple[str, list[str]]] = []
    used = 0
    available = CONTENT_BOTTOM - CONTENT_TOP
    for title, lines, height in cards:
        needed = height + (CARD_GAP if current else 0)
        if current and used + needed > available:
            pages.append(current)
            current = []
            used = 0
            needed = height
        current.append((title, lines))
        used += needed
    if current or not pages:
        pages.append(current)
    return pages


def background_image(path: Path | None) -> Image.Image:
    if path and path.exists():
        source = Image.open(path).convert("RGB")
        canvas = ImageOps.fit(
            source, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS
        ).convert("RGBA")
        canvas = (
            ImageEnhance.Contrast(canvas)
            .enhance(0.86)
            .filter(ImageFilter.GaussianBlur(0.6))
        )
    else:
        canvas = Image.new("RGBA", (WIDTH, HEIGHT), (19, 31, 52, 255))
    veil = Image.new("RGBA", (WIDTH, HEIGHT), (7, 14, 27, 118))
    return Image.alpha_composite(canvas, veil)


def draw_logo(canvas: Image.Image, logo_path: Path | None) -> None:
    if not logo_path or not logo_path.exists():
        return
    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((260, 110), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (WIDTH - MARGIN - logo.width, 82))


def draw_page(
    base: Image.Image,
    data: dict[str, Any],
    cards: list[tuple[str, list[str]]],
    page: int,
    total: int,
    logo: Path | None,
) -> Image.Image:
    canvas = base.copy()
    draw_logo(canvas, logo)
    draw = ImageDraw.Draw(canvas, "RGBA")
    title_font = load_font(62, bold=True)
    meta_font = load_font(28)
    section_font = load_font(40, bold=True)
    body_font = load_font(34)
    footer_font = load_font(25)

    title_lines = wrap_text(
        draw,
        str(data.get("title") or "議事録"),
        title_font,
        WIDTH - MARGIN * 2 - 300,
    )
    title = title_lines[0] if title_lines else "議事録"
    if len(title_lines) > 1:
        title = f"{title[:22]}…"
    draw.text((MARGIN, 76), title, font=title_font, fill=TEXT_COLOR)
    date = str(data.get("meeting_date") or "記載なし")
    participants = "、".join(
        str(item) for item in safe_list(data.get("participants"))
    ) or "記載なし"
    meta = f"{date}  ｜  参加者: {participants}"
    for index, line in enumerate(
        wrap_text(draw, meta, meta_font, WIDTH - MARGIN * 2)
    ):
        draw.text(
            (MARGIN, 178 + index * 40), line, font=meta_font, fill=MUTED_COLOR
        )

    y = CONTENT_TOP
    for section_title, lines in cards:
        card_height = 52 + len(lines) * 53 + 58
        draw.rounded_rectangle(
            (MARGIN, y, WIDTH - MARGIN, y + card_height),
            radius=28,
            fill=(9, 20, 38, 198),
            outline=(180, 221, 255, 78),
            width=2,
        )
        draw.text(
            (MARGIN + 48, y + 30), section_title, font=section_font, fill=ACCENT
        )
        line_y = y + 94
        for line in lines:
            draw.text(
                (MARGIN + 48, line_y), line, font=body_font, fill=TEXT_COLOR
            )
            line_y += 53
        y += card_height + CARD_GAP

    draw.text(
        (MARGIN, 1960),
        f"MEETING MINUTES  •  {page}/{total}",
        font=footer_font,
        fill=(190, 204, 225, 210),
    )
    return canvas.convert("RGB")


def load_logo(config_path: Path | None) -> Path | None:
    if not config_path or not config_path.exists():
        return None
    config = json.loads(config_path.read_text(encoding="utf-8"))
    logo = config.get("logo") or {}
    if logo.get("mode") != "always" or not logo.get("path"):
        return None
    return Path(str(logo["path"])).expanduser()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--background")
    parser.add_argument("--config")
    parser.add_argument("--logo")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    background_path = (
        Path(args.background).expanduser().resolve() if args.background else None
    )
    config_path = Path(args.config).expanduser().resolve() if args.config else None
    explicit_logo = Path(args.logo).expanduser().resolve() if args.logo else None
    data = json.loads(input_path.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)

    pages = split_sections(data)
    base = background_image(background_path)
    logo = explicit_logo or load_logo(config_path)
    files: list[str] = []
    for index, cards in enumerate(pages, start=1):
        output = output_dir / f"page-{index:02d}.png"
        draw_page(base, data, cards, index, len(pages), logo).save(
            output, "PNG", optimize=True
        )
        files.append(str(output))
    print(
        json.dumps(
            {"ok": True, "pages": len(files), "files": files},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
