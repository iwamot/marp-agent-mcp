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
import { promisify } from "node:util";

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  DEFAULT_THEME,
  MARP_CLI_TIMEOUT_MS,
  THEMES,
  type ThemeId,
  VERSION,
} from "./constants.js";
import { formatViolationMessage } from "./src/format.js";
import { buildMarpArgs, type MarpOutputFormat } from "./src/marp-args.js";
import { checkSlideOverflow } from "./src/overflow.js";

const execFileAsync = promisify(execFile);

// Works both from source (server.ts at project root) and compiled (dist/server.js)
const PROJECT_ROOT = import.meta.filename.endsWith(".ts")
  ? import.meta.dirname
  : path.join(import.meta.dirname, "..");

const DIST_DIR = path.join(PROJECT_ROOT, "dist");
export const SKILL_ZIP_PATH = path.join(PROJECT_ROOT, "skill.zip");
const THEMES_DIR = path.join(PROJECT_ROOT, "themes");

const ThemeSchema = z.enum(THEMES);

const NameSchema = z
  .string()
  .regex(
    /^[a-z0-9-]+$/,
    "Only lowercase letters, numbers, and hyphens are allowed",
  );

const resourceUri = "ui://marp-agent/preview.html";

async function resolveThemePath(theme: ThemeId): Promise<string | null> {
  const themePath = path.join(THEMES_DIR, `${theme}.css`);
  try {
    await fs.access(themePath);
    return themePath;
  } catch {
    return null;
  }
}

async function runMarpCli(
  markdown: string,
  format: MarpOutputFormat,
  theme: ThemeId,
  editable: boolean,
): Promise<Buffer> {
  const tmpDir = path.join(
    os.tmpdir(),
    `marp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const mdPath = path.join(tmpDir, "slide.md");
    const outputPath = path.join(tmpDir, `slide.${format}`);
    await fs.writeFile(mdPath, markdown, "utf-8");

    const args = buildMarpArgs({
      mdPath,
      outputPath,
      format,
      editable,
      themePath: await resolveThemePath(theme),
    });

    console.error(`[marp-agent-mcp] Running: marp ${args.join(" ")}`);
    const { stdout, stderr } = await execFileAsync("marp", args, {
      timeout: MARP_CLI_TIMEOUT_MS,
    });
    if (stdout) console.error("[marp-agent-mcp] stdout:", stdout);
    if (stderr) console.error("[marp-agent-mcp] stderr:", stderr);
    console.error("[marp-agent-mcp] Completed successfully");

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
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

  const csp = {
    resourceDomains: [
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
      "https://esm.sh",
      "https://cdn.jsdelivr.net",
    ],
    connectDomains: ["https://esm.sh"],
  };

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
        name: NameSchema.optional().describe(
          "Slide name for filename (a-z, 0-9, hyphens only). Defaults to slide",
        ),
      },
      outputSchema: z.object({
        markdown: z.string(),
        theme: z.string(),
        name: z.string(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async ({ markdown, theme, name }) => {
      const resolvedTheme = theme ?? DEFAULT_THEME;
      const resolvedName = name ?? "slide";
      return {
        structuredContent: {
          markdown,
          theme: resolvedTheme,
          name: resolvedName,
        },
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              markdown,
              theme: resolvedTheme,
              name: resolvedName,
            }),
          },
        ],
      };
    },
  );

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

      const result = {
        valid: false,
        errors: violations,
        message: formatViolationMessage(violations),
      };

      return {
        structuredContent: result,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    "export_pdf",
    {
      description: "Export slides to PDF format.",
      inputSchema: {
        markdown: z.string().describe("Full Marp markdown text"),
        theme: ThemeSchema.optional().describe(
          "Theme name (speee, border, gradient). Defaults to speee",
        ),
        name: NameSchema.optional().describe(
          "Slide name for filename (a-z, 0-9, hyphens only). Defaults to slide",
        ),
      },
      outputSchema: z.object({
        data_base64: z.string(),
        filename: z.string(),
        mime_type: z.string(),
      }),
    },
    async ({ markdown, theme, name }) => {
      const resolvedTheme = theme ?? DEFAULT_THEME;
      const resolvedName = name ?? "slide";
      try {
        const pdfBytes = await runMarpCli(
          markdown,
          "pdf",
          resolvedTheme,
          false,
        );
        const result = {
          data_base64: pdfBytes.toString("base64"),
          filename: `${resolvedName}.pdf`,
          mime_type: "application/pdf",
        };
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (e) {
        console.error("[marp-agent-mcp] PDF generation failed:", e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        throw new Error(`PDF生成に失敗しました: ${errorMessage}`);
      }
    },
  );

  server.registerTool(
    "export_pptx",
    {
      description: "Export slides to PPTX format.",
      inputSchema: {
        markdown: z.string().describe("Full Marp markdown text"),
        theme: ThemeSchema.optional().describe(
          "Theme name (speee, border, gradient). Defaults to speee",
        ),
        name: NameSchema.optional().describe(
          "Slide name for filename (a-z, 0-9, hyphens only). Defaults to slide",
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
    async ({ markdown, theme, name, editable }) => {
      const resolvedTheme = theme ?? DEFAULT_THEME;
      const resolvedName = name ?? "slide";
      try {
        const pptxBytes = await runMarpCli(
          markdown,
          "pptx",
          resolvedTheme,
          editable ?? false,
        );
        const result = {
          data_base64: pptxBytes.toString("base64"),
          filename: `${resolvedName}.pptx`,
          mime_type:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        };
        return {
          structuredContent: result,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (e) {
        console.error("[marp-agent-mcp] PPTX generation failed:", e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        throw new Error(`PPTX生成に失敗しました: ${errorMessage}`);
      }
    },
  );

  return server;
}
