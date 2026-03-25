"""スライドのオーバーフロー検証ツール"""

import math
import re
import unicodedata

MAX_LINES_PER_SLIDE = 9
# 1行あたりの最大表示幅（半角換算）
# Marp 16:9スライドでの実測値: 箇条書き行で半角約54文字分で折り返し発生
# 安全マージンとして全角3文字分（半角6）を引いた値
MAX_DISPLAY_WIDTH_PER_LINE = 48
# テーブル行の最大表示幅（半角換算）
# テーブルはテキスト折り返しされず横にはみ出すため、行全体の幅をチェック
# Marp 16:9での実測: 3列テーブルで全角10文字/セル程度が上限
MAX_TABLE_ROW_WIDTH = 64


def _get_display_width(text: str) -> int:
    """テキストの表示幅を半角換算で計算（全角=2, 半角=1）"""
    width = 0
    for char in text:
        eaw = unicodedata.east_asian_width(char)
        if eaw in ("F", "W", "A"):  # Fullwidth, Wide, Ambiguous（日本語環境では全角扱い）
            width += 2
        else:
            width += 1
    return width


def _strip_markdown_formatting(text: str) -> str:
    """マークダウンの装飾記法を除去して表示テキストを取得"""
    # 太字/斜体（** __ * _）
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)", r"\1", text)
    # 取り消し線
    text = re.sub(r"~~(.+?)~~", r"\1", text)
    # インラインコード
    text = re.sub(r"`(.+?)`", r"\1", text)
    # リンク [text](url) → text
    text = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", text)
    # 箇条書きマーカー
    text = re.sub(r"^[-*+]\s+", "", text)
    # 番号付きリスト
    text = re.sub(r"^\d+\.\s+", "", text)
    # 見出し
    text = re.sub(r"^#{1,6}\s+", "", text)
    # 引用
    text = re.sub(r"^>\s*", "", text)
    return text


def _estimate_visual_lines(text: str) -> int:
    """テキスト1行の表示幅から実質的な行数（折り返し考慮）を推定"""
    # テーブル行はセル幅の計算が複雑なため折り返し計算対象外
    stripped = text.strip()
    if stripped.startswith("|") and stripped.endswith("|"):
        return 1

    display_text = _strip_markdown_formatting(stripped)
    width = _get_display_width(display_text)
    if width <= MAX_DISPLAY_WIDTH_PER_LINE:
        return 1
    return math.ceil(width / MAX_DISPLAY_WIDTH_PER_LINE)


def _parse_slides(markdown: str) -> list[str]:
    """Marpマークダウンをスライドごとに分割（フロントマター除外）"""
    content = re.sub(r"^---\s*\n.*?\n---\s*\n", "", markdown, count=1, flags=re.DOTALL)
    slides = re.split(r"\n---\s*\n", content)
    return [s.strip() for s in slides if s.strip()]


def _count_content_lines(slide_content: str) -> int:
    """スライド内のコンテンツ行数をカウント（折り返し考慮）"""
    lines = slide_content.split("\n")
    count = 0
    in_code_block = False

    for line in lines:
        stripped = line.strip()

        # コードブロック開始/終了（マーカー自体はカウントしない）
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue

        if not stripped:
            continue  # 空行スキップ

        if re.match(r"^<!--.*-->$", stripped):
            continue  # HTMLコメントスキップ

        if re.match(r"^\|[\s\-:|]+\|$", stripped):
            continue  # 表セパレーター行スキップ

        # 折り返しを考慮した実質行数を加算
        count += _estimate_visual_lines(stripped)

    return count


def _check_table_width(slide_content: str) -> int:
    """テーブル行の横幅をチェックし、最大幅を返す（超過なしなら0）"""
    max_width = 0
    for line in slide_content.split("\n"):
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        # セパレーター行はスキップ
        if re.match(r"^\|[\s\-:|]+\|$", stripped):
            continue
        width = _get_display_width(stripped)
        if width > MAX_TABLE_ROW_WIDTH:
            max_width = max(max_width, width)
    return max_width


def check_slide_overflow(markdown: str) -> list[dict]:
    """各スライドの行数・テーブル横幅をチェックし、制限超過スライドの情報を返す"""
    slides = _parse_slides(markdown)
    violations = []

    for i, slide in enumerate(slides, start=1):
        # 特殊スライド（top, lead, end, tinytext）はスキップ
        if re.search(r"_class:\s*(top|lead|end|tinytext)", slide):
            continue

        # 行数チェック（縦方向）
        line_count = _count_content_lines(slide)
        if line_count > MAX_LINES_PER_SLIDE:
            violations.append(
                {
                    "slide_number": i,
                    "type": "line_overflow",
                    "line_count": line_count,
                    "max_lines": MAX_LINES_PER_SLIDE,
                    "excess": line_count - MAX_LINES_PER_SLIDE,
                }
            )

        # テーブル横幅チェック
        table_max_width = _check_table_width(slide)
        if table_max_width > 0:
            violations.append(
                {
                    "slide_number": i,
                    "type": "table_overflow",
                    "max_width": table_max_width,
                    "limit": MAX_TABLE_ROW_WIDTH,
                    "excess": table_max_width - MAX_TABLE_ROW_WIDTH,
                }
            )

    return violations
