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
let slides: { index: number; html: string }[] = [];
let slidesCss = "";

// Host capabilities
let canCallServerTools = false;
let canDownloadFile = false;

// DOM要素
const appEl = document.getElementById("app") as HTMLElement;
if (!appEl) throw new Error("app element not found");

// UI初期化
function initUI() {
  appEl.innerHTML = `
    <div class="toolbar">
      <select id="themeSelect">
        ${THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}
      </select>
      <span class="separator">|</span>
      <button id="prevBtn" disabled>&lt;</button>
      <button id="nextBtn" disabled>&gt;</button>
      <div class="download-group">
        <button id="downloadMd" class="download-btn">MD</button>
        <button id="downloadPdf" class="download-btn">PDF</button>
        <button id="downloadPptx" class="download-btn">PPTX</button>
        <button id="downloadPptxEditable" class="download-btn">Editable PPTX</button>
      </div>
    </div>
    <div id="previewContainer"></div>
  `;

  // イベントリスナー
  const themeSelect = document.getElementById(
    "themeSelect",
  ) as HTMLSelectElement;
  const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
  const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
  const downloadMd = document.getElementById("downloadMd") as HTMLButtonElement;
  const downloadPdf = document.getElementById(
    "downloadPdf",
  ) as HTMLButtonElement;
  const downloadPptx = document.getElementById(
    "downloadPptx",
  ) as HTMLButtonElement;
  const downloadPptxEditable = document.getElementById(
    "downloadPptxEditable",
  ) as HTMLButtonElement;

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

  downloadPdf.addEventListener("click", async () => {
    if (!currentMarkdown) return;
    downloadPdf.disabled = true;
    downloadPdf.textContent = "wait...";
    try {
      const result = await app.callServerTool({
        name: "export_pdf",
        arguments: { markdown: currentMarkdown, theme: currentTheme },
      });
      if (result && !result.isError) {
        handleToolResult(result);
      } else {
        showError(result);
        resetDownloadButtons();
      }
    } catch (e) {
      console.error("export_pdf failed:", e);
      resetDownloadButtons();
    }
  });

  downloadPptx.addEventListener("click", async () => {
    if (!currentMarkdown) return;
    downloadPptx.disabled = true;
    downloadPptx.textContent = "wait...";
    try {
      const result = await app.callServerTool({
        name: "export_pptx",
        arguments: { markdown: currentMarkdown, theme: currentTheme },
      });
      if (result && !result.isError) {
        handleToolResult(result);
      } else {
        showError(result);
        resetDownloadButtons();
      }
    } catch (e) {
      console.error("export_pptx failed:", e);
      resetDownloadButtons();
    }
  });

  downloadPptxEditable.addEventListener("click", async () => {
    if (!currentMarkdown) return;
    downloadPptxEditable.disabled = true;
    downloadPptxEditable.textContent = "wait...";
    try {
      const result = await app.callServerTool({
        name: "export_pptx",
        arguments: {
          markdown: currentMarkdown,
          theme: currentTheme,
          editable: true,
        },
      });
      if (result && !result.isError) {
        handleToolResult(result);
      } else {
        showError(result);
        resetDownloadButtons();
      }
    } catch (e) {
      console.error("export_pptx (editable) failed:", e);
      resetDownloadButtons();
    }
  });
}

function updatePageInfo() {
  const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
  const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;

  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1;
}

// 現在のスライドを表示（1ページずつ）
function showCurrentSlide() {
  const previewContainer = document.getElementById("previewContainer");
  if (!previewContainer) return;

  const slide = slides[currentPage];
  previewContainer.innerHTML = `
    <style>${slidesCss}</style>
    <div class="marpit">${slide.html}</div>
  `;

  // リンクをホスト経由で開くように設定（iframeサンドボックス対応）
  const links = previewContainer.querySelectorAll("a[href]");
  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const url = link.getAttribute("href");
      if (url) {
        app.openLink({ url });
      }
    });
  });

  // Safari/iOS WebKit向けのpolyfillを適用
  observe(previewContainer);
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

// スライドレンダリング
function renderSlides() {
  if (!currentMarkdown) return;

  const previewContainer = document.getElementById("previewContainer");
  if (!previewContainer) return;

  try {
    const markdownWithTheme = injectTheme(currentMarkdown, currentTheme);
    const marp = new Marp();
    // 全カスタムテーマを登録
    THEMES.forEach((theme) => {
      if (theme.css) {
        marp.themeSet.add(theme.css);
      }
    });

    const { html, css } = marp.render(markdownWithTheme);
    slidesCss = css;

    // SVG要素を抽出
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const svgs = doc.querySelectorAll("svg[data-marpit-svg]");

    slides = Array.from(svgs).map((svg, index) => {
      // viewBoxからwidth/heightを設定（autoResizeの計測に固有サイズが必要）
      const vb = svg.getAttribute("viewBox")?.split(/\s+/);
      if (vb && vb.length === 4) {
        svg.setAttribute("width", vb[2]);
        svg.setAttribute("height", vb[3]);
      }
      return { index, html: svg.outerHTML };
    });

    totalPages = slides.length;
    updatePageInfo();
    showCurrentSlide();
  } catch (error) {
    console.error("Render failed:", error);
    showToast("レンダリングに失敗しました");
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

function resetDownloadButtons() {
  const downloadMd = document.getElementById("downloadMd") as HTMLButtonElement;
  const downloadPdf = document.getElementById(
    "downloadPdf",
  ) as HTMLButtonElement;
  const downloadPptx = document.getElementById(
    "downloadPptx",
  ) as HTMLButtonElement;
  const downloadPptxEditable = document.getElementById(
    "downloadPptxEditable",
  ) as HTMLButtonElement;
  if (downloadMd) {
    downloadMd.textContent = "MD";
  }
  if (downloadPdf) {
    downloadPdf.textContent = "PDF";
  }
  if (downloadPptx) {
    downloadPptx.textContent = "PPTX";
  }
  if (downloadPptxEditable) {
    downloadPptxEditable.textContent = "Editable PPTX";
  }
  updateDownloadButtonsAvailability();
}

function updateDownloadButtonsAvailability() {
  const downloadMd = document.getElementById("downloadMd") as HTMLButtonElement;
  const downloadPdf = document.getElementById(
    "downloadPdf",
  ) as HTMLButtonElement;
  const downloadPptx = document.getElementById(
    "downloadPptx",
  ) as HTMLButtonElement;
  const downloadPptxEditable = document.getElementById(
    "downloadPptxEditable",
  ) as HTMLButtonElement;

  // MD: downloadFile のみ必要（クライアント側で完結）
  // PDF/PPTX: serverTools と downloadFile の両方が必要
  const canDownloadExport = canCallServerTools && canDownloadFile;
  const unavailableMessage = "この環境ではダウンロードできません";

  if (downloadMd) {
    downloadMd.disabled = !canDownloadFile;
    downloadMd.title = canDownloadFile ? "" : unavailableMessage;
  }
  if (downloadPdf) {
    downloadPdf.disabled = !canDownloadExport;
    downloadPdf.title = canDownloadExport ? "" : unavailableMessage;
  }
  if (downloadPptx) {
    downloadPptx.disabled = !canDownloadExport;
    downloadPptx.title = canDownloadExport ? "" : unavailableMessage;
  }
  if (downloadPptxEditable) {
    downloadPptxEditable.disabled = !canDownloadExport;
    downloadPptxEditable.title = canDownloadExport ? "" : unavailableMessage;
  }
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
          const themeSelect = document.getElementById(
            "themeSelect",
          ) as HTMLSelectElement;
          if (themeSelect) themeSelect.value = currentTheme;
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
  initUI();
  await app.connect();

  // Host capabilities をチェック
  const caps = app.getHostCapabilities();
  canCallServerTools = !!caps?.serverTools;
  canDownloadFile = !!caps?.downloadFile;

  // ダウンロードボタンの有効/無効を設定
  updateDownloadButtonsAvailability();
}

main();
