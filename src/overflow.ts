import { eastAsianWidth } from "get-east-asian-width";

import {
  MAX_DISPLAY_WIDTH_PER_LINE,
  MAX_LINES_PER_SLIDE,
  MAX_TABLE_ROW_WIDTH,
} from "../constants.js";

export interface LineOverflow {
  type: "line_overflow";
  slide_number: number;
  line_count: number;
  max_lines: number;
  excess: number;
}

export interface TableOverflow {
  type: "table_overflow";
  slide_number: number;
  max_width: number;
  limit: number;
  excess: number;
}

export type Violation = LineOverflow | TableOverflow;

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

// Strip a leading YAML frontmatter block (--- ... ---) without using a regex,
// to avoid ReDoS on pathological inputs.
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) {
    return markdown;
  }
  const firstNewline = markdown.indexOf("\n");
  if (firstNewline === -1) {
    return markdown;
  }
  const closingIndex = markdown.indexOf("\n---", firstNewline);
  if (closingIndex === -1) {
    return markdown;
  }
  let endIndex = closingIndex + 4; // length of "\n---"
  while (endIndex < markdown.length && markdown[endIndex] !== "\n") {
    if (markdown[endIndex] !== " " && markdown[endIndex] !== "\t") {
      break;
    }
    endIndex++;
  }
  if (
    endIndex === markdown.length ||
    markdown[endIndex] === "\n" ||
    markdown[endIndex] === " " ||
    markdown[endIndex] === "\t"
  ) {
    return markdown.slice(endIndex + 1);
  }
  return markdown;
}

export function parseSlides(markdown: string): string[] {
  const content = stripFrontmatter(markdown);
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
    if (
      stripped.startsWith("<!--") &&
      stripped.endsWith("-->") &&
      !stripped.slice(4, -3).includes("-->")
    )
      continue;
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
