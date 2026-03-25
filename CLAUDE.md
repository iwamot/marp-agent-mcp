# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Marpを使ったスライド生成MCPサーバー。Claude Desktop App / Claude.ai からMCPツールとしてスライドのプレビュー・エクスポートができる。プロジェクトの背景は @README.md 、スライド生成のLLMガイダンスは @skills/marp-agent-mcp/SKILL.md を参照。

## 開発コマンド

```bash
# 開発環境（Docker）
docker compose up -d --build      # 起動（ビルド含む）
docker compose logs -f marp-agent # ログ確認
docker compose down               # 停止
```

- marp-agent: MCPサーバー (port 8000)
- inspector: MCP Inspector (http://127.0.0.1:6274) — ツールの動作確認・デバッグ用

```bash
# バリデーション（コミット前に必須）
./validate.sh
```

コードを変更したら、コミットやPR作成前に必ず `./validate.sh` を実行すること。サーバー（Ruff lint/format + ty型チェック）とクライアント（Biome lint/format + tsc型チェック）を一括実行する。

## アーキテクチャ

```
┌───────────────────┐   MCP (Streamable HTTP)   ┌──────────────────┐
│ Claude Desktop App │◄────────────────────────►│   server/main.py │
│ / Claude.ai        │                           │   (FastMCP)      │
└─────────┬─────────┘                           └────────┬─────────┘
         │                                                  │
         │  MCP App UI (iframe)                            │ subprocess
         ▼                                                  ▼
┌─────────────────┐                               ┌──────────────────┐
│  client/main.ts │                               │    Marp CLI      │
│  (marp-core で   │                               │  (PDF/PPTX生成)  │
│   レンダリング)   │                               └──────────────────┘
└─────────────────┘
```

- **server/**: Python MCPサーバー（FastMCP）。PDF/PPTX生成はMarp CLIをサブプロセスで実行
- **client/**: MCP App UI。marp-coreでブラウザ内レンダリング。Viteでシングルファイルにビルドし `server/ui/index.html` に出力。marp-core/marpit-svg-polyfillはesm.shからCDN読み込み（バンドルサイズ削減）
- **themes/**: スライドテーマCSS。サーバー側はファイル読み込みでMarp CLIに渡し、クライアント側はViteの `?raw` インポートで埋め込み
- **skills/**: LLM向けスライド生成ガイダンス（SKILL.md）

## 開発環境

ツールバージョンは `.mise.toml` で管理。`mise install` で一括セットアップ。

## 設計メモ

- `client/vite.config.ts` の `legacy.inconsistentCjsInterop: true` は、Vite 8 + marp-core の組み合わせで必要。marp-coreがCJS/ESM両対応になれば不要になる見込み（参考: https://github.com/marp-team/marp-core/pull/415）
- Dockerイメージには Chromium（PDF生成）、日本語フォント（fonts-noto-cjk）、LibreOffice Impress（編集可能PPTX）が含まれる
