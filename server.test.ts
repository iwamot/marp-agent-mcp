/**
 * Slide overflow validation tests.
 *
 * These tests verify that the validation logic in server.ts matches
 * the original implementation in minorun365/marp-agent:
 * https://github.com/minorun365/marp-agent/blob/main/amplify/agent/runtime/tools/output_slide.py
 */
import { describe, expect, it } from "bun:test";

// Import validation functions from server.ts
// We need to export them for testing
import {
  checkSlideOverflow,
  checkTableWidth,
  countContentLines,
  estimateVisualLines,
  getDisplayWidth,
  MAX_DISPLAY_WIDTH_PER_LINE,
  MAX_LINES_PER_SLIDE,
  MAX_TABLE_ROW_WIDTH,
  parseSlides,
  stripMarkdownFormatting,
} from "./server.js";

// --- Display width tests ---

describe("getDisplayWidth", () => {
  it("should count ASCII characters as width 1", () => {
    expect(getDisplayWidth("Hello")).toBe(5);
  });

  it("should count fullwidth characters as width 2", () => {
    expect(getDisplayWidth("こんにちは")).toBe(10);
  });

  it("should handle mixed ASCII and fullwidth", () => {
    // "ABC" = 3, "あいう" = 6 → total 9
    expect(getDisplayWidth("ABCあいう")).toBe(9);
  });

  it("should detect overflow in real KAG slide text", () => {
    const text =
      "2022年設立、KDDIグループのDX推進専門会社（母体は2016年発足の社内組織）";
    const width = getDisplayWidth(text);
    expect(width).toBeGreaterThan(MAX_DISPLAY_WIDTH_PER_LINE);
  });

  it("should not overflow for short bullet text", () => {
    const text = "短い項目";
    const width = getDisplayWidth(text);
    expect(width).toBeLessThanOrEqual(MAX_DISPLAY_WIDTH_PER_LINE);
  });
});

// --- Markdown stripping tests ---

describe("stripMarkdownFormatting", () => {
  it("should remove bold markers", () => {
    expect(stripMarkdownFormatting("**太字**テスト")).toBe("太字テスト");
  });

  it("should remove italic markers", () => {
    expect(stripMarkdownFormatting("*斜体*テスト")).toBe("斜体テスト");
  });

  it("should remove bullet markers", () => {
    expect(stripMarkdownFormatting("- 箇条書き")).toBe("箇条書き");
  });

  it("should remove heading markers", () => {
    expect(stripMarkdownFormatting("## 見出し")).toBe("見出し");
  });

  it("should remove link URLs but keep text", () => {
    expect(stripMarkdownFormatting("[テキスト](https://example.com)")).toBe(
      "テキスト",
    );
  });

  it("should remove inline code backticks", () => {
    expect(stripMarkdownFormatting("`code`テスト")).toBe("codeテスト");
  });

  it("should handle combined formatting", () => {
    const result = stripMarkdownFormatting("- **2022年設立**、KDDIグループ");
    expect(result).toBe("2022年設立、KDDIグループ");
  });

  it("should remove quote markers", () => {
    expect(stripMarkdownFormatting("> 引用テキスト")).toBe("引用テキスト");
  });
});

// --- Visual line estimation tests ---

describe("estimateVisualLines", () => {
  it("should return 1 for short lines", () => {
    expect(estimateVisualLines("- 短い項目")).toBe(1);
  });

  it("should return 2+ for long Japanese lines", () => {
    const longText =
      "- **2022年設立**、KDDIグループのDX推進専門会社（母体は2016年発足の社内組織）";
    expect(estimateVisualLines(longText)).toBeGreaterThanOrEqual(2);
  });

  it("should always return 1 for table rows (no wrap calculation)", () => {
    expect(
      estimateVisualLines(
        "| 長い長い長い長い長い長い長い長いテキスト | 長い長い長い長い長い長い長い長いテキスト |",
      ),
    ).toBe(1);
  });

  it("should return 1 for short headings", () => {
    expect(estimateVisualLines("## 短い見出し")).toBe(1);
  });
});

// --- Slide parsing tests ---

describe("parseSlides", () => {
  it("should split slides with frontmatter", () => {
    const md =
      "---\nmarp: true\ntheme: border\n---\n\n## Slide 1\n\n- Item 1\n\n---\n\n## Slide 2\n\n- Item 2";
    const slides = parseSlides(md);
    expect(slides.length).toBe(2);
    expect(slides[0]).toContain("Slide 1");
    expect(slides[1]).toContain("Slide 2");
  });

  it("should handle markdown without frontmatter", () => {
    const md = "## Slide 1\n\n- Item 1\n\n---\n\n## Slide 2";
    const slides = parseSlides(md);
    expect(slides.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty array for empty markdown", () => {
    const slides = parseSlides("");
    expect(slides).toEqual([]);
  });
});

// --- Content line counting tests ---

describe("countContentLines", () => {
  it("should count heading and bullets", () => {
    const content = "## タイトル\n\n- 項目1\n- 項目2\n- 項目3";
    expect(countContentLines(content)).toBe(4);
  });

  it("should skip empty lines", () => {
    const content = "## タイトル\n\n\n\n- 項目1";
    expect(countContentLines(content)).toBe(2);
  });

  it("should skip HTML comments", () => {
    const content = "<!-- _class: lead -->\n## タイトル\n- 項目1";
    expect(countContentLines(content)).toBe(2);
  });

  it("should skip table separator rows", () => {
    const content = "## 比較表\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    // heading(1) + header(1) + data rows(2) = 4 (separator skipped)
    expect(countContentLines(content)).toBe(4);
  });

  it("should count code block content but skip markers", () => {
    const content =
      "## コード例\n\n```python\nprint('hello')\nprint('world')\n```";
    // heading(1) + code lines(2) = 3 (``` markers skipped)
    expect(countContentLines(content)).toBe(3);
  });

  it("should only count code block content, not markers", () => {
    const content = "```\nline1\n```";
    expect(countContentLines(content)).toBe(1);
  });

  it("should count exactly 9 lines for 9-line slide", () => {
    const lines = [
      "## 見出し",
      ...Array.from({ length: 8 }, (_, i) => `- 項目${i + 1}`),
    ];
    const content = lines.join("\n");
    expect(countContentLines(content)).toBe(9);
  });

  it("should count quote block lines", () => {
    const content = "## 引用\n\n> 引用文1\n> 引用文2";
    expect(countContentLines(content)).toBe(3);
  });

  it("should skip table separators with alignment", () => {
    const content =
      "| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |";
    // header(1) + data row(1) = 2 (separator skipped)
    expect(countContentLines(content)).toBe(2);
  });

  it("should count long lines as multiple visual lines", () => {
    const longBullet =
      "- **2022年設立**、KDDIグループのDX推進専門会社（母体は2016年発足の社内組織）";
    const content = `## KAGとは\n\n${longBullet}\n- 短い項目\n- 短い項目2`;
    const lineCount = countContentLines(content);
    // Should be more than 4 due to line wrapping
    expect(lineCount).toBeGreaterThan(4);
  });
});

// --- Table width check tests ---

describe("checkTableWidth", () => {
  it("should return 0 when no table overflow", () => {
    const content = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(checkTableWidth(content)).toBe(0);
  });

  it("should detect table width overflow", () => {
    const wideRow = `| ${"あ".repeat(20)} | ${"い".repeat(20)} |`;
    const content = `| A | B |\n|---|---|\n${wideRow}`;
    expect(checkTableWidth(content)).toBeGreaterThan(MAX_TABLE_ROW_WIDTH);
  });

  it("should skip separator rows", () => {
    const content = "|:-----|:------:|------:|";
    expect(checkTableWidth(content)).toBe(0);
  });
});

// --- Slide overflow check tests ---

describe("checkSlideOverflow", () => {
  it("should return empty array when all slides are within limits", () => {
    const md =
      "---\nmarp: true\n---\n\n## Slide 1\n\n- Item 1\n- Item 2\n\n---\n\n## Slide 2\n\n- Item 1";
    const violations = checkSlideOverflow(md);
    expect(violations).toEqual([]);
  });

  it("should detect line overflow", () => {
    const lines = [
      "## 見出し",
      ...Array.from({ length: 9 }, (_, i) => `- 項目${i + 1}`),
    ]; // 10 lines
    const slideContent = lines.join("\n");
    const md = `---\nmarp: true\n---\n\n${slideContent}`;
    const violations = checkSlideOverflow(md);
    expect(violations.length).toBe(1);
    expect(violations[0].type).toBe("line_overflow");
    expect(violations[0].line_count).toBe(10);
    expect(violations[0].excess).toBe(1);
  });

  it("should detect overflow from long line wrapping (KAG slide reproduction)", () => {
    const content = [
      "## KAGとは？",
      "",
      "> re-INNOVATE YOUR BUSINESS",
      "",
      "- **2022年設立**、KDDIグループのDX推進専門会社（母体は2016年発足の社内組織）",
      "- 全社員がScrum Inc. Japan認定資格を保有、経営層を含む全員がスクラムの実践者",
      "- 「サービスデザイン」「アジャイル開発」「クラウドネイティブ」の3本柱でDXを一貫支援",
      "- 開発期間1/2・コスト1/3を実現した実績（auでんきアプリ開発事例）",
      "- 高輪ゲートウェイシティ都市OS開発など、社会インフラ規模のプロジェクトも担う",
    ].join("\n");
    const md = `---\nmarp: true\n---\n\n${content}`;
    const violations = checkSlideOverflow(md);
    expect(violations.length).toBe(1);
    expect(violations[0].line_count).toBeGreaterThan(MAX_LINES_PER_SLIDE);
  });

  it("should skip title slide (_class: top)", () => {
    const lines = [
      "<!-- _class: top -->",
      "## タイトル",
      ...Array.from({ length: 14 }, (_, i) => `- 項目${i + 1}`),
    ];
    const slideContent = lines.join("\n");
    const md = `---\nmarp: true\n---\n\n${slideContent}`;
    const violations = checkSlideOverflow(md);
    expect(violations).toEqual([]);
  });

  it("should skip section divider (_class: lead)", () => {
    const lines = [
      "<!-- _class: lead -->",
      "## セクション",
      ...Array.from({ length: 14 }, (_, i) => `- 項目${i + 1}`),
    ];
    const slideContent = lines.join("\n");
    const md = `---\nmarp: true\n---\n\n${slideContent}`;
    const violations = checkSlideOverflow(md);
    expect(violations).toEqual([]);
  });

  it("should skip end slide (_class: end)", () => {
    const slideContent = `<!-- _class: end -->\n## Thank you!\n${Array.from({ length: 15 }, (_, i) => `- ${i}`).join("\n")}`;
    const md = `---\nmarp: true\n---\n\n${slideContent}`;
    const violations = checkSlideOverflow(md);
    expect(violations).toEqual([]);
  });

  it("should skip bibliography slide (_class: tinytext)", () => {
    const lines = [
      "<!-- _class: tinytext -->",
      "## 参考文献",
      ...Array.from({ length: 15 }, (_, i) => `- https://example.com/${i}`),
    ];
    const slideContent = lines.join("\n");
    const md = `---\nmarp: true\n---\n\n${slideContent}`;
    const violations = checkSlideOverflow(md);
    expect(violations).toEqual([]);
  });

  it("should detect multiple violations across slides", () => {
    const slide1 = [
      "## S1",
      ...Array.from({ length: 10 }, (_, i) => `- 項目${i + 1}`),
    ].join("\n"); // 11 lines
    const slide2 = [
      "## S2",
      ...Array.from({ length: 11 }, (_, i) => `- 項目${i + 1}`),
    ].join("\n"); // 12 lines
    const md = `---\nmarp: true\n---\n\n${slide1}\n\n---\n\n${slide2}`;
    const violations = checkSlideOverflow(md);
    expect(violations.length).toBe(2);
  });

  it("should detect table overflow", () => {
    const wideRow = `| ${"あ".repeat(20)} | ${"い".repeat(20)} |`;
    const content = `## テーブル\n\n| A | B |\n|---|---|\n${wideRow}`;
    const md = `---\nmarp: true\n---\n\n${content}`;
    const violations = checkSlideOverflow(md);
    expect(violations.length).toBe(1);
    expect(violations[0].type).toBe("table_overflow");
    expect(violations[0].max_width).toBeGreaterThan(MAX_TABLE_ROW_WIDTH);
  });
});

// --- Constants verification ---

describe("constants", () => {
  it("should match original Python implementation constants", () => {
    // These must match minorun365/marp-agent output_slide.py
    expect(MAX_LINES_PER_SLIDE).toBe(9);
    expect(MAX_DISPLAY_WIDTH_PER_LINE).toBe(48);
    expect(MAX_TABLE_ROW_WIDTH).toBe(64);
  });
});
