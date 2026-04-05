/**
 * @file MCP App for Marp slide preview with theme switching and export functionality.
 */
import Marp from "@marp-team/marp-core";
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_THEME,
  SERVER_TOOL_TIMEOUT_MS,
  type ThemeId,
  VERSION,
} from "../constants.js";
import "./global.css";
import "./mcp-app.css";

// Theme CSS (imported as raw strings via Vite)
import borderTheme from "../themes/border.css?raw";
import gradientTheme from "../themes/gradient.css?raw";
import speeeTheme from "../themes/speee.css?raw";

// Structured content from preview_slide tool
interface PreviewResultData {
  markdown: string;
  theme: ThemeId;
  name: string;
}

// Structured content from export_pdf / export_pptx tools
interface ExportResultData {
  data_base64: string;
  filename: string;
  mime_type: string;
}

// Theme definitions
const THEMES = [
  { id: "speee", name: "Speee", css: speeeTheme },
  { id: "border", name: "Border", css: borderTheme },
  { id: "gradient", name: "Gradient", css: gradientTheme },
] as const;

// Marp instance with registered themes
const marp = new Marp();
for (const theme of THEMES) {
  marp.themeSet.add(theme.css);
}

// MCP App instance
const app = new App({ name: "Marp Preview", version: VERSION });

// App state
let currentMarkdown: string | null = null;
let currentTheme: ThemeId = DEFAULT_THEME;
let currentName = "slide";
let currentPage = 0;
let totalPages = 1;
let slides: string[] = [];

// Host capabilities
let canCallServerTools = false;
let canDownloadFile = false;

// Main element for safe area insets
const mainEl = document.querySelector(".main") as HTMLElement;

// Handle host context changes (theme, styles, safe area)
function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

// DOM elements
const themeSelect = document.getElementById("themeSelect") as HTMLSelectElement;
const firstBtn = document.getElementById("firstBtn") as HTMLButtonElement;
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
const lastBtn = document.getElementById("lastBtn") as HTMLButtonElement;
const downloadFormat = document.getElementById(
  "downloadFormat",
) as HTMLSelectElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const slideStyle = document.getElementById("slideStyle") as HTMLStyleElement;
const slideContainer = document.querySelector(
  "#previewContainer .marpit",
) as HTMLElement;

// Populate theme options
for (const theme of THEMES) {
  const option = document.createElement("option");
  option.value = theme.id;
  option.textContent = theme.name;
  themeSelect.appendChild(option);
}

// Inject theme into markdown frontmatter
function injectTheme(markdown: string, theme: ThemeId): string {
  // Normalize legacy inline directives
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
  // Remove existing toast if present
  const existingToast = document.querySelector(".toast");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Fade out and remove after 3 seconds
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

function updateDownloadAvailability() {
  const unavailableMessage = "この環境ではダウンロードできません";

  // Enable select and button if downloadFile is available
  downloadFormat.disabled = !canDownloadFile;
  downloadBtn.disabled = !canDownloadFile;
  downloadBtn.title = canDownloadFile ? "" : unavailableMessage;

  // Disable PDF/PPTX options if serverTools is unavailable
  for (const option of downloadFormat.options) {
    if (option.value !== "md") {
      option.disabled = !canCallServerTools;
    }
  }

  // Fall back to Markdown if current selection becomes unavailable
  if (!canCallServerTools && downloadFormat.value !== "md") {
    downloadFormat.value = "md";
  }
}

function resetDownloadButton() {
  downloadBtn.textContent = "Download";
  downloadBtn.disabled = !canDownloadFile;
}

// Display current slide (one page at a time)
function showCurrentSlide() {
  slideContainer.innerHTML = slides[currentPage];

  // Configure links to open via host (for iframe sandbox compatibility)
  for (const link of slideContainer.querySelectorAll("a[href]")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const url = link.getAttribute("href");
      if (url) {
        app.openLink({ url });
      }
    });
  }
}

// Render slides from markdown
function renderSlides() {
  if (!currentMarkdown) return;

  try {
    const markdownWithTheme = injectTheme(currentMarkdown, currentTheme);
    const { html, css } = marp.render(markdownWithTheme);

    // Extract SVG elements
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const svgs = doc.querySelectorAll("svg[data-marpit-svg]");

    slides = Array.from(svgs).map((svg) => svg.outerHTML);

    // Update CSS
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

  resetDownloadButton();
}

async function handleToolResult(result: CallToolResult) {
  const data = result.structuredContent as ExportResultData | undefined;
  if (data?.data_base64) {
    await triggerDownload(data.data_base64, data.filename, data.mime_type);
  } else {
    resetDownloadButton();
  }
}

// Download as Markdown
async function handleMarkdownDownload() {
  if (!currentMarkdown) return;
  downloadBtn.disabled = true;
  downloadBtn.textContent = "wait...";
  try {
    const markdownWithTheme = injectTheme(currentMarkdown, currentTheme);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(markdownWithTheme);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    const base64Data = btoa(binary);
    await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: `file:///${currentName}.md`,
            mimeType: "text/markdown",
            blob: base64Data,
          },
        },
      ],
    });
  } catch (e) {
    console.error("Markdown download failed:", e);
    showToast("ダウンロードに失敗しました");
  }
  resetDownloadButton();
}

// Common handler for server-side export
async function handleServerExport(
  toolName: string,
  args: Record<string, unknown>,
) {
  if (!currentMarkdown) return;
  downloadBtn.disabled = true;
  downloadBtn.textContent = "wait...";
  try {
    console.info(`Calling ${toolName} tool...`);
    const result = await app.callServerTool(
      {
        name: toolName,
        arguments: {
          markdown: currentMarkdown,
          theme: currentTheme,
          name: currentName,
          ...args,
        },
      },
      { timeout: SERVER_TOOL_TIMEOUT_MS },
    );
    console.info(`${toolName} result:`, result);
    if (result && !result.isError) {
      handleToolResult(result);
    } else {
      showError(result);
      resetDownloadButton();
    }
  } catch (e) {
    console.error(`${toolName} failed:`, e);
    const errorMessage =
      e instanceof Error ? e.message : "エクスポートに失敗しました";
    showToast(errorMessage);
    resetDownloadButton();
  }
}

// Event listeners
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

downloadBtn.addEventListener("click", async () => {
  const format = downloadFormat.value;
  if (format === "pdf") {
    handleServerExport("export_pdf", {});
  } else if (format === "pptx") {
    handleServerExport("export_pptx", {});
  } else if (format === "pptx-editable") {
    handleServerExport("export_pptx", { editable: true });
  } else if (format === "md") {
    await handleMarkdownDownload();
  }
});

// MCP App handlers
app.ontoolresult = (result) => {
  console.info("Received tool call result:", result);
  const data = result.structuredContent as PreviewResultData | undefined;
  if (data?.markdown) {
    currentMarkdown = data.markdown;
    if (data.theme) {
      currentTheme = data.theme as ThemeId;
      themeSelect.value = currentTheme;
    }
    if (data.name) {
      currentName = data.name;
    }
    renderSlides();

    // Enable controls
    themeSelect.disabled = false;
    updateDownloadAvailability();
  }
};

app.ontoolcancelled = (params) => {
  console.info("Tool call cancelled:", params.reason);
  resetDownloadButton();
};

app.onerror = console.error;

app.onhostcontextchanged = handleHostContextChanged;

// Initialization
async function main() {
  await app.connect();

  // Apply initial styles
  const hostContext = app.getHostContext();
  if (hostContext) {
    handleHostContextChanged(hostContext);
  }

  // Check host capabilities
  const caps = app.getHostCapabilities();
  canCallServerTools = !!caps?.serverTools;
  canDownloadFile = !!caps?.downloadFile;
}

main();
