"""スライドエクスポート（PDF/PPTX生成）"""

import subprocess
import tempfile
from pathlib import Path

# テーマファイルのディレクトリ
THEMES_DIR = Path(__file__).parent.parent / "themes"


def _run_marp_cli(
    markdown: str, output_format: str, theme: str = "speee", editable: bool = False
) -> bytes:
    """Marp CLIを実行して出力ファイルの内容を返す（共通処理）

    Args:
        markdown: Marpマークダウン
        output_format: 出力形式（"pdf", "pptx"）
        theme: テーマ名
        editable: PPTXを編集可能形式で出力（LibreOffice必要）

    Returns:
        出力ファイルの内容（バイト列）
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        md_path = Path(tmpdir) / "slide.md"
        output_path = Path(tmpdir) / f"slide.{output_format}"

        md_path.write_text(markdown, encoding="utf-8")

        # Marp CLIコマンド構築
        cmd = [
            "marp",
            str(md_path),
            "-o",
            str(output_path),
        ]

        # 出力形式に応じたフラグ
        if output_format == "pdf":
            cmd.append("--pdf")
        elif output_format == "pptx":
            cmd.append("--pptx")
            if editable:
                cmd.append("--pptx-editable")

        # テーマ設定
        theme_path = THEMES_DIR / f"{theme}.css"
        if theme_path.exists():
            cmd.extend(["--theme", str(theme_path)])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            raise RuntimeError(f"Marp CLI error: {result.stderr}")

        return output_path.read_bytes()


def generate_pdf(markdown: str, theme: str = "speee") -> bytes:
    """Marp CLIでPDFを生成"""
    return _run_marp_cli(markdown, "pdf", theme)


def generate_pptx(markdown: str, theme: str = "speee") -> bytes:
    """Marp CLIでPPTXを生成"""
    return _run_marp_cli(markdown, "pptx", theme)


def generate_editable_pptx(markdown: str, theme: str = "speee") -> bytes:
    """Marp CLIで編集可能なPPTXを生成（実験的機能、LibreOffice必要）"""
    return _run_marp_cli(markdown, "pptx", theme, editable=True)
