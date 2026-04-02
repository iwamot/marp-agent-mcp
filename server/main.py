"""Marp Agent MCP Server"""

import base64
import logging
from enum import StrEnum
from pathlib import Path

import uvicorn
from anyio import to_thread
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.routing import Route

from tools.export import generate_editable_pptx, generate_pdf, generate_pptx
from tools.validate_slide import check_slide_overflow

# ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class Theme(StrEnum):
    """テーマ"""

    speee = "speee"
    border = "border"
    gradient = "gradient"


# ツールの戻り値モデル
class PreviewResult(BaseModel):
    """プレビューツールの戻り値"""

    markdown: str
    theme: str


class ValidationError(BaseModel):
    """バリデーションエラーの詳細"""

    type: str
    slide_number: int
    line_count: int | None = None
    max_lines: int | None = None
    excess: int | None = None
    max_width: int | None = None
    limit: int | None = None


class ValidationResult(BaseModel):
    """バリデーションツールの戻り値"""

    valid: bool
    errors: list[ValidationError]
    message: str | None = None


class ExportResult(BaseModel):
    """エクスポートツールの戻り値"""

    data_base64: str
    filename: str
    mime_type: str


# MCPサーバーの作成
# host="0.0.0.0" でコンテナ外からアクセス可能に
mcp = FastMCP("marp_agent_mcp", host="0.0.0.0", stateless_http=True)

# MCP App UIのリソースURI
VIEW_URI = "ui://marp-agent/preview.html"

# ビルド済みUI HTMLのパス
UI_HTML_PATH = Path(__file__).parent / "ui" / "index.html"


def _load_ui_html() -> str:
    """ビルド済みUI HTMLを読み込む"""
    if UI_HTML_PATH.exists():
        return UI_HTML_PATH.read_text(encoding="utf-8")
    else:
        # フォールバック: ビルドされていない場合のエラーメッセージ
        return """<!DOCTYPE html>
<html><body>
<h1>UI not built</h1>
<p>Run `npm run build` in client/ directory.</p>
</body></html>"""


# MCP App リソース（プレビューUI）
@mcp.resource(
    VIEW_URI,
    mime_type="text/html;profile=mcp-app",
    meta={
        "ui": {
            "csp": {
                "resourceDomains": [
                    "https://fonts.googleapis.com",
                    "https://fonts.gstatic.com",
                    "https://esm.sh",
                ],
                "connectDomains": [
                    "https://esm.sh",
                ],
            }
        }
    },
)
def preview_resource() -> str:
    """プレビューUI HTMLリソース"""
    return _load_ui_html()


# MCP App ツール（プレビュー生成）
@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
    meta={
        "ui": {"resourceUri": VIEW_URI},
    },
    structured_output=True,
)
def preview_slide(markdown: str, theme: Theme | None = None) -> PreviewResult:
    """スライドをプレビュー表示します。

    Marpマークダウンを解析し、プレビューUIに表示します。
    UIでテーマ選択、ページナビゲーション、ダウンロードが可能です。
    テーマ変更はクライアント側で即座に反映されます。

    Args:
        markdown: Marp形式のマークダウン全文（フロントマターを含む）
        theme: テーマ名（speee, border, gradient）。省略時はspeee

    Returns:
        マークダウンとテーマ情報（クライアント側でレンダリング）
    """
    if theme is None:
        theme = Theme.speee
    # クライアント側でmarp-coreを使ってレンダリングするため、
    # サーバーはマークダウンのみを返す
    return PreviewResult(
        markdown=markdown,
        theme=theme.value,
    )


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
    structured_output=True,
)
def validate_slide(markdown: str) -> ValidationResult:
    """スライドのオーバーフローをチェックします。

    Marpマークダウンを解析し、各スライドの行数・テーブル幅が制限内かを検証します。
    スライドを作成・編集したら、必ずこのツールで検証してください。

    Args:
        markdown: Marp形式のマークダウン全文（フロントマターを含む）

    Returns:
        検証結果。valid=Trueならオーバーフローなし。
        errorsには問題のあるスライドの詳細が含まれます。
    """
    violations = check_slide_overflow(markdown)

    if not violations:
        return ValidationResult(valid=True, errors=[])

    # エラーメッセージを構築
    error_messages = []
    errors = []
    for v in violations:
        slide_num = v["slide_number"]
        if v["type"] == "line_overflow":
            line_count = v["line_count"]
            max_lines = v["max_lines"]
            excess = v["excess"]
            error_messages.append(
                f"スライド{slide_num}: 実質{line_count}行（上限{max_lines}行、{excess}行超過）"
            )
            errors.append(
                ValidationError(
                    type="line_overflow",
                    slide_number=slide_num,
                    line_count=line_count,
                    max_lines=max_lines,
                    excess=excess,
                )
            )
        elif v["type"] == "table_overflow":
            max_width = v["max_width"]
            limit = v["limit"]
            error_messages.append(
                f"スライド{slide_num}: 表の横幅超過（{max_width}文字、上限{limit}文字）"
            )
            errors.append(
                ValidationError(
                    type="table_overflow",
                    slide_number=slide_num,
                    max_width=max_width,
                    limit=limit,
                )
            )

    return ValidationResult(
        valid=False,
        errors=errors,
        message="オーバーフローを検出しました。修正してください。\n" + "\n".join(error_messages),
    )


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
    structured_output=True,
)
async def export_pdf(markdown: str, theme: Theme | None = None) -> ExportResult:
    """スライドをPDF形式でエクスポートします。

    Args:
        markdown: Marp形式のマークダウン全文
        theme: テーマ名（speee, border, gradient）。省略時はspeee

    Returns:
        Base64エンコードされたPDFデータと推奨ファイル名
    """
    if theme is None:
        theme = Theme.speee
    try:
        pdf_bytes = await to_thread.run_sync(generate_pdf, markdown, theme.value)
    except Exception as e:
        logger.exception("PDF generation failed")
        raise ToolError(f"PDF生成に失敗しました: {e}") from e
    return ExportResult(
        data_base64=base64.b64encode(pdf_bytes).decode("utf-8"),
        filename="slide.pdf",
        mime_type="application/pdf",
    )


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    ),
    structured_output=True,
)
async def export_pptx(
    markdown: str, theme: Theme | None = None, editable: bool = False
) -> ExportResult:
    """スライドをPPTX形式でエクスポートします。

    Args:
        markdown: Marp形式のマークダウン全文
        theme: テーマ名（speee, border, gradient）。省略時はspeee
        editable: 編集可能形式で出力（実験的、LibreOffice互換）

    Returns:
        Base64エンコードされたPPTXデータと推奨ファイル名
    """
    if theme is None:
        theme = Theme.speee
    try:
        if editable:
            pptx_bytes = await to_thread.run_sync(generate_editable_pptx, markdown, theme.value)
        else:
            pptx_bytes = await to_thread.run_sync(generate_pptx, markdown, theme.value)
    except Exception as e:
        logger.exception("PPTX generation failed")
        raise ToolError(f"PPTX生成に失敗しました: {e}") from e
    return ExportResult(
        data_base64=base64.b64encode(pptx_bytes).decode("utf-8"),
        filename="slide.pptx",
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )


SKILL_ZIP_PATH = Path(__file__).parent / "skill.zip"


def _serve_skill_zip(request):
    """スキルzipを返す"""
    if SKILL_ZIP_PATH.exists():
        content = SKILL_ZIP_PATH.read_bytes()
        return Response(
            content,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=skill.zip"},
        )
    return PlainTextResponse("skill.zip not found", status_code=404)


if __name__ == "__main__":
    # Starletteアプリを取得
    starlette_app = mcp.streamable_http_app()

    # ヘルスチェック
    starlette_app.routes.insert(0, Route("/health", lambda r: PlainTextResponse("ok")))

    # スキルzipダウンロード
    starlette_app.routes.insert(0, Route("/skill.zip", _serve_skill_zip))

    # CORSミドルウェアでラップ
    app = CORSMiddleware(
        starlette_app,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["mcp-session-id"],
    )

    uvicorn.run(app, host="0.0.0.0", port=8000)
