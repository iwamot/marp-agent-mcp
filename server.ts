/**
 * Marp Agent MCP Server
 *
 * An MCP server for generating Marp slides with interactive preview.
 *
 * Tools:
 * - preview_slide: Display slides in an interactive preview UI
 * - validate_slide: Check slides for overflow (line count, table width)
 * - export_pdf: Export slides to PDF format
 * - export_pptx: Export slides to PPTX format
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { debuglog, promisify } from "node:util";

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eastAsianWidth } from "get-east-asian-width";
import { z } from "zod";

import {
  DEFAULT_THEME,
  MARP_CLI_TIMEOUT_MS,
  MAX_DISPLAY_WIDTH_PER_LINE,
  MAX_LINES_PER_SLIDE,
  MAX_TABLE_ROW_WIDTH,
  THEMES,
  type ThemeId,
  VERSION,
} from "./constants.js";

const debug = debuglog("marp");

const execFileAsync = promisify(execFile);

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// Path to the skill zip file
export const SKILL_ZIP_PATH = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "skill.zip")
  : path.join(import.meta.dirname, "..", "skill.zip");

// Path to the theme files directory
const THEMES_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "themes")
  : path.join(import.meta.dirname, "..", "themes");

// Re-export validation constants for tests
export {
  MAX_DISPLAY_WIDTH_PER_LINE,
  MAX_LINES_PER_SLIDE,
  MAX_TABLE_ROW_WIDTH,
} from "./constants.js";

// Theme schema
const ThemeSchema = z.enum(THEMES);

// Resource URI for the MCP App UI
const resourceUri = "ui://marp-agent/preview.html";

interface LineOverflow {
  type: "line_overflow";
  slide_number: number;
  line_count: number;
  max_lines: number;
  excess: number;
}

interface TableOverflow {
  type: "table_overflow";
  slide_number: number;
  max_width: number;
  limit: number;
  excess: number;
}

type Violation = LineOverflow | TableOverflow;

export function getDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) {
      width += eastAsianWidth(codePoint, { ambiguousAsWide: true });
    }
  }
  return width;
}

export function stripMarkdownFormatting(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/__(.+?)__/g, "$1");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
  result = result.replace(/~~(.+?)~~/g, "$1");
  result = result.replace(/`(.+?)`/g, "$1");
  result = result.replace(/\[(.+?)\]\(.+?\)/g, "$1");
  result = result.replace(/^[-*+]\s+/, "");
  result = result.replace(/^\d+\.\s+/, "");
  result = result.replace(/^#{1,6}\s+/, "");
  result = result.replace(/^>\s*/, "");
  return result;
}

export function estimateVisualLines(text: string): number {
  const stripped = text.trim();
  if (stripped.startsWith("|") && stripped.endsWith("|")) {
    return 1;
  }
  const displayText = stripMarkdownFormatting(stripped);
  const width = getDisplayWidth(displayText);
  if (width <= MAX_DISPLAY_WIDTH_PER_LINE) {
    return 1;
  }
  return Math.ceil(width / MAX_DISPLAY_WIDTH_PER_LINE);
}

export function parseSlides(markdown: string): string[] {
  const content = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
  const slides = content.split(/\n---\s*\n/);
  return slides.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function countContentLines(slideContent: string): number {
  const lines = slideContent.split("\n");
  let count = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!stripped) continue;
    if (/^<!--.*-->$/.test(stripped)) continue;
    if (/^\|[\s\-:|]+\|$/.test(stripped)) continue;
    count += estimateVisualLines(stripped);
  }
  return count;
}

export function checkTableWidth(slideContent: string): number {
  let maxWidth = 0;
  for (const line of slideContent.split("\n")) {
    const stripped = line.trim();
    if (!(stripped.startsWith("|") && stripped.endsWith("|"))) continue;
    if (/^\|[\s\-:|]+\|$/.test(stripped)) continue;
    const width = getDisplayWidth(stripped);
    if (width > MAX_TABLE_ROW_WIDTH) {
      maxWidth = Math.max(maxWidth, width);
    }
  }
  return maxWidth;
}

export function checkSlideOverflow(markdown: string): Violation[] {
  const slides = parseSlides(markdown);
  const violations: Violation[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideNumber = i + 1;

    if (/_class:\s*(top|lead|end|tinytext)/.test(slide)) continue;

    const lineCount = countContentLines(slide);
    if (lineCount > MAX_LINES_PER_SLIDE) {
      violations.push({
        type: "line_overflow",
        slide_number: slideNumber,
        line_count: lineCount,
        max_lines: MAX_LINES_PER_SLIDE,
        excess: lineCount - MAX_LINES_PER_SLIDE,
      });
    }

    const tableMaxWidth = checkTableWidth(slide);
    if (tableMaxWidth > 0) {
      violations.push({
        type: "table_overflow",
        slide_number: slideNumber,
        max_width: tableMaxWidth,
        limit: MAX_TABLE_ROW_WIDTH,
        excess: tableMaxWidth - MAX_TABLE_ROW_WIDTH,
      });
    }
  }
  return violations;
}

async function runMarpCli(
  markdown: string,
  outputFormat: "pdf" | "pptx",
  theme: ThemeId = DEFAULT_THEME,
  editable = false,
): Promise<Buffer> {
  const tmpDir = path.join(
    os.tmpdir(),
    `marp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const mdPath = path.join(tmpDir, "slide.md");
    const outputPath = path.join(tmpDir, `slide.${outputFormat}`);
    await fs.writeFile(mdPath, markdown, "utf-8");

    const args = [
      mdPath,
      "--no-stdin",
      "--allow-local-files",
      "-o",
      outputPath,
    ];
    if (outputFormat === "pdf") {
      args.push("--pdf");
    } else if (outputFormat === "pptx") {
      args.push("--pptx");
      if (editable) args.push("--pptx-editable");
    }

    const themePath = path.join(THEMES_DIR, `${theme}.css`);
    try {
      await fs.access(themePath);
      args.push("--theme", themePath);
    } catch {
      // Theme file doesn't exist, use default
    }

    debug("Running: marp %s", args.join(" "));
    const { stdout, stderr } = await execFileAsync("marp", args, {
      timeout: MARP_CLI_TIMEOUT_MS,
    });
    if (stdout) debug("stdout: %s", stdout);
    if (stderr) debug("stderr: %s", stderr);
    debug("Completed successfully");

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function generatePdf(
  markdown: string,
  theme: ThemeId = DEFAULT_THEME,
): Promise<Buffer> {
  return runMarpCli(markdown, "pdf", theme);
}

async function generatePptx(
  markdown: string,
  theme: ThemeId = DEFAULT_THEME,
): Promise<Buffer> {
  return runMarpCli(markdown, "pptx", theme);
}

async function generateEditablePptx(
  markdown: string,
  theme: ThemeId = DEFAULT_THEME,
): Promise<Buffer> {
  return runMarpCli(markdown, "pptx", theme, true);
}

async function loadUiHtml(): Promise<string> {
  try {
    return await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
  } catch {
    return `<!DOCTYPE html>
<html><body>
<h1>UI not built</h1>
<p>Run "pnpm run build" to build the UI.</p>
</body></html>`;
  }
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "marp_agent_mcp",
    version: VERSION,
  });

  // CSP configuration for the UI resource
  const csp = {
    resourceDomains: [
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
      "https://esm.sh",
    ],
    connectDomains: ["https://esm.sh"],
  };

  // Register the resource, which returns the bundled HTML/JavaScript for the UI.
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await loadUiHtml();
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: { ui: { csp } },
          },
        ],
      };
    },
  );

  // Register a tool with UI metadata. When the host calls this tool, it reads
  // `_meta.ui.resourceUri` to know which resource to fetch and render as an
  // interactive UI.
  registerAppTool(
    server,
    "preview_slide",
    {
      description: `Preview slides in the UI.

Parses Marp markdown and displays it in the preview UI.
Theme selection, page navigation, and download are available in the UI.
Theme changes are reflected immediately on the client side.`,
      inputSchema: {
        markdown: z
          .string()
          .describe("Full Marp markdown text (including frontmatter)"),
        theme: ThemeSchema.optional().describe(
          "Theme name (speee, border, gradient). Defaults to speee",
        ),
      },
      outputSchema: z.object({ markdown: z.string(), theme: z.string() }),
      _meta: { ui: { resourceUri } },
    },
    async ({ markdown, theme }) => {
      const resolvedTheme = theme ?? DEFAULT_THEME;
      return {
        structuredContent: { markdown, theme: resolvedTheme },
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ markdown, theme: resolvedTheme }),
          },
        ],
      };
    },
  );

  // Validation tool
  server.registerTool(
    "validate_slide",
    {
      description: `Check slides for overflow.

Parses Marp markdown and validates that each slide's line count and table width
are within limits. Always validate with this tool after creating or editing slides.`,
      inputSchema: {
        markdown: z
          .string()
          .describe("Full Marp markdown text (including frontmatter)"),
      },
      outputSchema: z.object({
        valid: z.boolean(),
        errors: z.array(
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("line_overflow"),
              slide_number: z.number(),
              line_count: z.number(),
              max_lines: z.number(),
              excess: z.number(),
            }),
            z.object({
              type: z.literal("table_overflow"),
              slide_number: z.number(),
              max_width: z.number(),
              limit: z.number(),
              excess: z.number(),
            }),
          ]),
        ),
        message: z.string().optional(),
      }),
    },
    async ({ markdown }) => {
      const violations = checkSlideOverflow(markdown);

      if (violations.length === 0) {
        return {
          structuredContent: { valid: true, errors: [] },
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ valid: true, errors: [] }),
            },
          ],
        };
      }

      const errorMessages = violations.map((v) =>
        v.type === "line_overflow"
          ? `スライド${v.slide_number}: 実質${v.line_count}行（上限${v.max_lines}行、${v.excess}行超過）`
          : `スライド${v.slide_number}: 表の横幅超過（${v.max_width}文字、上限${v.limit}文字）`,
      );

      const result = {
        valid: false,
        errors: violations,
        message: `オーバーフローを検出しました。修正してください。\n${errorMessages.join("\n")}`,
      };

      return {
        structuredContent: result,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // PDF export tool
  server.registerTool(
    "export_pdf",
    {
      description: "Export slides to PDF format.",
      inputSchema: {
        markdown: z.string().describe("Full Marp markdown text"),
        theme: ThemeSchema.optional().describe(
          "Theme name (speee, border, gradient). Defaults to speee",
        ),
      },
      outputSchema: z.object({
        data_base64: z.string(),
        filename: z.string(),
        mime_type: z.string(),
      }),
    },
    async ({ markdown, theme }) => {
      const resolvedTheme = theme ?? DEFAULT_THEME;
      try {
        const pdfBytes = await generatePdf(markdown, resolvedTheme);
        const result = {
          data_base64: pdfBytes.toString("base64"),
          filename: "slide.pdf",
          mime_type: "application/pdf",
        };
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        throw new Error(`PDF生成に失敗しました: ${errorMessage}`);
      }
    },
  );

  // PPTX export tool
  server.registerTool(
    "export_pptx",
    {
      description: "Export slides to PPTX format.",
      inputSchema: {
        markdown: z.string().describe("Full Marp markdown text"),
        theme: ThemeSchema.optional().describe(
          "Theme name (speee, border, gradient). Defaults to speee",
        ),
        editable: z
          .boolean()
          .optional()
          .describe(
            "Output in editable format (experimental, LibreOffice compatible)",
          ),
      },
      outputSchema: z.object({
        data_base64: z.string(),
        filename: z.string(),
        mime_type: z.string(),
      }),
    },
    async ({ markdown, theme, editable }) => {
      const resolvedTheme = theme ?? DEFAULT_THEME;
      try {
        const pptxBytes = editable
          ? await generateEditablePptx(markdown, resolvedTheme)
          : await generatePptx(markdown, resolvedTheme);
        const result = {
          data_base64: pptxBytes.toString("base64"),
          filename: "slide.pptx",
          mime_type:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        };
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        throw new Error(`PPTX生成に失敗しました: ${errorMessage}`);
      }
    },
  );

  return server;
}
