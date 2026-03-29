import Marp from "@marp-team/marp-core";
import { observe } from "@marp-team/marpit-svg-polyfill";
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./styles.css";

// テーマCSS（Viteの?rawでインポート）
import borderTheme from "./themes/border.css?raw";
import gradientTheme from "./themes/gradient.css?raw";
import speeeTheme from "./themes/speee.css?raw";

// テーマ定義
const THEMES = [
  { id: "speee", name: "Speee", css: speeeTheme },
  { id: "border", name: "Border", css: borderTheme },
  { id: "gradient", name: "Gradient", css: gradientTheme },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

// Marpインスタンス（テーマ登録済み）
const marp = new Marp();
for (const theme of THEMES) {
  marp.themeSet.add(theme.css);
}

// MCP App
const app = new App(
  { name: "Marp Preview", version: "1.0.0" },
  {},
  { autoResize: true },
);

// 状態
let currentMarkdown: string | null = null;
let currentTheme: ThemeId = "speee";
let currentPage = 0;
let totalPages = 1;
let slides: string[] = [];

// Host capabilities
let canCallServerTools = false;
let canDownloadFile = false;

// DOM要素
const themeSelect = document.getElementById("themeSelect") as HTMLSelectElement;
const firstBtn = document.getElementById("firstBtn") as HTMLButtonElement;
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
const lastBtn = document.getElementById("lastBtn") as HTMLButtonElement;
const downloadMd = document.getElementById("downloadMd") as HTMLButtonElement;
const downloadPdf = document.getElementById("downloadPdf") as HTMLButtonElement;
const downloadPptx = document.getElementById(
  "downloadPptx",
) as HTMLButtonElement;
const downloadPptxEditable = document.getElementById(
  "downloadPptxEditable",
) as HTMLButtonElement;
const previewContainer = document.getElementById(
  "previewContainer",
) as HTMLElement;
const slideStyle = document.getElementById("slideStyle") as HTMLStyleElement;
const slideContainer = document.querySelector(
  "#previewContainer .marpit",
) as HTMLElement;

// テーマオプションを設定
for (const theme of THEMES) {
  const option = document.createElement("option");
  option.value = theme.id;
  option.textContent = theme.name;
  themeSelect.appendChild(option);
}

// マークダウンにテーマを注入
function injectTheme(markdown: string, theme: ThemeId): string {
  // 旧スタイルのインラインディレクティブを統一
  const normalized = markdown.replace(
    /<!-- _backgroundColor: #303030 -->\s*<!-- _color: white -->/g,
    "<!-- _class: lead -->",
  );

  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);

  if (frontMatterMatch) {
    const frontMatter = frontMatterMatch[1];
    const hasTheme = /^theme:/m.test(frontMatter);

    if (hasTheme) {
      const newFrontMatter = frontMatter.replace(
        /^theme:.*$/m,
        `theme: ${theme}`,
      );
      return normalized.replace(
        frontMatterMatch[0],
        `---\n${newFrontMatter}\n---`,
      );
    } else {
      return normalized.replace(
        frontMatterMatch[0],
        `---\n${frontMatter}\ntheme: ${theme}\n---`,
      );
    }
  } else {
    return `---\ntheme: ${theme}\n---\n\n${normalized}`;
  }
}

function showToast(message: string) {
  // 既存のトーストがあれば削除
  const existingToast = document.querySelector(".toast");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // 3秒後にフェードアウトして削除
  setTimeout(() => {
    toast.classList.add("toast-hide");
    toast.addEventListener("animationend", () => {
      toast.remove();
    });
  }, 3000);
}

function showError(result: CallToolResult | undefined) {
  let errorMessage = "予期せぬエラーが発生しました";

  if (result) {
    const content = result.content;
    if (content && content.length > 0) {
      const textContent = content.find(
        (c: { type: string }) => c.type === "text",
      );
      if (textContent && textContent.type === "text") {
        errorMessage = textContent.text;
      }
    }
  }

  showToast(errorMessage);
}

function updatePageInfo() {
  const isFirst = currentPage === 0;
  const isLast = currentPage >= totalPages - 1;
  firstBtn.disabled = isFirst;
  prevBtn.disabled = isFirst;
  nextBtn.disabled = isLast;
  lastBtn.disabled = isLast;
}

function updateDownloadButtonsAvailability() {
  // MD: downloadFile のみ必要（クライアント側で完結）
  // PDF/PPTX: serverTools と downloadFile の両方が必要
  const canDownloadExport = canCallServerTools && canDownloadFile;
  const unavailableMessage = "この環境ではダウンロードできません";

  downloadMd.disabled = !canDownloadFile;
  downloadMd.title = canDownloadFile ? "" : unavailableMessage;
  downloadPdf.disabled = !canDownloadExport;
  downloadPdf.title = canDownloadExport ? "" : unavailableMessage;
  downloadPptx.disabled = !canDownloadExport;
  downloadPptx.title = canDownloadExport ? "" : unavailableMessage;
  downloadPptxEditable.disabled = !canDownloadExport;
  downloadPptxEditable.title = canDownloadExport ? "" : unavailableMessage;
}

function resetDownloadButtons() {
  downloadMd.textContent = "MD";
  downloadPdf.textContent = "PDF";
  downloadPptx.textContent = "PPTX";
  downloadPptxEditable.textContent = "Editable PPTX";
  updateDownloadButtonsAvailability();
}

// 現在のスライドを表示（1ページずつ）
function showCurrentSlide() {
  slideContainer.innerHTML = slides[currentPage];

  // リンクをホスト経由で開くように設定（iframeサンドボックス対応）
  for (const link of slideContainer.querySelectorAll("a[href]")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const url = link.getAttribute("href");
      if (url) {
        app.openLink({ url });
      }
    });
  }

  // Safari/iOS WebKit向けのpolyfillを適用
  observe(previewContainer);
}

// スライドレンダリング
function renderSlides() {
  if (!currentMarkdown) return;

  try {
    const markdownWithTheme = injectTheme(currentMarkdown, currentTheme);
    const { html, css } = marp.render(markdownWithTheme);

    // SVG要素を抽出
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const svgs = doc.querySelectorAll("svg[data-marpit-svg]");

    slides = Array.from(svgs).map((svg) => svg.outerHTML);

    // CSSを更新
    slideStyle.textContent = css;

    totalPages = slides.length;
    updatePageInfo();
    showCurrentSlide();
  } catch (error) {
    console.error("Render failed:", error);
    showToast("レンダリングに失敗しました");
  }
}

async function triggerDownload(
  base64Data: string,
  filename: string,
  mimeType: string,
) {
  try {
    await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: `file:///${filename}`,
            mimeType: mimeType,
            blob: base64Data,
          },
        },
      ],
    });
  } catch (e) {
    console.error("downloadFile failed:", e);
    showToast("ダウンロードに失敗しました");
  }

  resetDownloadButtons();
}

async function handleToolResult(result: CallToolResult) {
  const content = result.content;
  if (!content || content.length === 0) {
    resetDownloadButtons();
    return;
  }

  const textContent = content.find((c: { type: string }) => c.type === "text");
  if (textContent && textContent.type === "text") {
    try {
      const data = JSON.parse(textContent.text);
      if (data.pdf_base64) {
        await triggerDownload(data.pdf_base64, data.filename, data.mime_type);
      } else if (data.pptx_base64) {
        await triggerDownload(data.pptx_base64, data.filename, data.mime_type);
      } else {
        resetDownloadButtons();
      }
    } catch (e) {
      console.error("handleToolResult failed:", e);
      showToast("ダウンロードに失敗しました");
      resetDownloadButtons();
    }
  } else {
    resetDownloadButtons();
  }
}

// エクスポートボタンの共通ハンドラ
async function handleExport(
  btn: HTMLButtonElement,
  toolName: string,
  args: Record<string, unknown>,
) {
  if (!currentMarkdown) return;
  btn.disabled = true;
  btn.textContent = "wait...";
  try {
    const result = await app.callServerTool({
      name: toolName,
      arguments: { markdown: currentMarkdown, theme: currentTheme, ...args },
    });
    if (result && !result.isError) {
      handleToolResult(result);
    } else {
      showError(result);
      resetDownloadButtons();
    }
  } catch (e) {
    console.error(`${toolName} failed:`, e);
    resetDownloadButtons();
  }
}

// イベントリスナー
downloadMd.addEventListener("click", async () => {
  if (!currentMarkdown) return;
  downloadMd.disabled = true;
  downloadMd.textContent = "wait...";
  try {
    // 選択中のテーマを反映したマークダウン
    const markdownWithTheme = injectTheme(currentMarkdown, currentTheme);
    // UTF-8対応のBase64エンコード
    const bytes = new TextEncoder().encode(markdownWithTheme);
    const base64 = btoa(String.fromCharCode(...bytes));
    await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: "file:///slide.md",
            mimeType: "text/markdown",
            blob: base64,
          },
        },
      ],
    });
  } catch (e) {
    console.error("MD download failed:", e);
    showToast("ダウンロードに失敗しました");
  }
  resetDownloadButtons();
});

themeSelect.addEventListener("change", () => {
  currentTheme = themeSelect.value as ThemeId;
  if (currentMarkdown) {
    renderSlides();
  }
});

firstBtn.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage = 0;
    updatePageInfo();
    showCurrentSlide();
  }
});

prevBtn.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage--;
    updatePageInfo();
    showCurrentSlide();
  }
});

nextBtn.addEventListener("click", () => {
  if (currentPage < totalPages - 1) {
    currentPage++;
    updatePageInfo();
    showCurrentSlide();
  }
});

lastBtn.addEventListener("click", () => {
  if (currentPage < totalPages - 1) {
    currentPage = totalPages - 1;
    updatePageInfo();
    showCurrentSlide();
  }
});

downloadPdf.addEventListener("click", () =>
  handleExport(downloadPdf, "export_pdf", {}),
);
downloadPptx.addEventListener("click", () =>
  handleExport(downloadPptx, "export_pptx", {}),
);
downloadPptxEditable.addEventListener("click", () =>
  handleExport(downloadPptxEditable, "export_pptx", { editable: true }),
);

// MCP Appハンドラ
app.ontoolresult = (result) => {
  const content = result.content;
  if (!content || content.length === 0) return;

  const textContent = content.find((c) => c.type === "text");
  if (textContent && textContent.type === "text") {
    try {
      const data = JSON.parse(textContent.text);
      if (data.markdown) {
        currentMarkdown = data.markdown;
        if (data.theme) {
          currentTheme = data.theme;
          themeSelect.value = currentTheme;
        }
        renderSlides();
      }
    } catch {
      // パースエラーは無視
    }
  }
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.safeAreaInsets) {
    document.body.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    document.body.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    document.body.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    document.body.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
};

app.ontoolcancelled = () => {
  resetDownloadButtons();
};

// 初期化
async function main() {
  await app.connect();

  // Host capabilities をチェック
  const caps = app.getHostCapabilities();
  canCallServerTools = !!caps?.serverTools;
  canDownloadFile = !!caps?.downloadFile;

  // ダウンロードボタンの有効/無効を設定
  updateDownloadButtonsAvailability();
}

main();
