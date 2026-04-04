# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Marpを使ったスライド生成MCPサーバー。Claude Desktop App / Claude.ai からMCPツールとしてスライドのプレビュー・エクスポートができる。プロジェクトの背景は @README.md 、スライド生成のLLMガイダンスは @skills/marp-agent-mcp/SKILL.md を参照。

## 開発コマンド

```bash
# MCPサーバー起動（Docker）
docker build -t marp-agent-mcp .
docker run -p 3001:3001 marp-agent-mcp
```

```bash
# バリデーション（コミット前に必須）
./validate.sh
```

コードを変更したら、コミットやPR作成前に必ず `./validate.sh` を実行すること。Biome lint/format + tsc 型チェックを一括実行する。

## アーキテクチャ

```
┌───────────────────┐   MCP (Streamable HTTP)   ┌──────────────────────┐
│ Claude Desktop App │◄────────────────────────►│     server.ts        │
│ / Claude.ai        │                           │     (MCP SDK)        │
└─────────┬─────────┘                           └──────────┬───────────┘
         │                                                  │
         │  MCP App UI (iframe)                            │ subprocess
         ▼                                                  ▼
┌─────────────────────┐                           ┌──────────────────┐
│   src/mcp-app.ts    │                           │    Marp CLI      │
│   (marp-core で      │                           │  (PDF/PPTX生成)  │
│    レンダリング)      │                           └──────────────────┘
└─────────────────────┘
```

- **server.ts**: TypeScript MCPサーバー（MCP SDK）。PDF/PPTX生成はMarp CLIをサブプロセスで実行
- **main.ts**: エントリーポイント。Streamable HTTP / stdio トランスポートの起動
- **src/mcp-app.ts**: MCP App UI。marp-coreでブラウザ内レンダリング。Viteでシングルファイルにビルドし `dist/mcp-app.html` に出力。marp-core/marpit-svg-polyfillはesm.shからCDN読み込み（バンドルサイズ削減）
- **themes/**: スライドテーマCSS。サーバー側はファイル読み込みでMarp CLIに渡し、クライアント側はViteの `?raw` インポートで埋め込み
- **skills/**: LLM向けスライド生成ガイダンス（SKILL.md）

## 開発環境

ツールバージョンは `.mise.toml` で管理。`mise install` で一括セットアップ。

## コミットルール

- コミットには必ず `-s` フラグを付けること（`git commit -s`）。DCO（Developer Certificate of Origin）が必須。

## 設計メモ

- Dockerイメージには Chromium（PDF生成）、日本語フォント（fonts-noto-cjk）、LibreOffice Impress（編集可能PPTX）が含まれる
- スライドのオーバーフロー検証ロジック（`server.ts` の `checkSlideOverflow` 関数）は、元アプリ [minorun365/marp-agent](https://github.com/minorun365/marp-agent) の `_check_slide_overflow` 関数（[amplify/agent/runtime/tools/output_slide.py](https://github.com/minorun365/marp-agent/blob/main/amplify/agent/runtime/tools/output_slide.py)）に準拠する。元アプリのロジックが変更された場合は追従すること
