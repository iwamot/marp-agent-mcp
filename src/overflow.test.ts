import { describe, expect, it } from "bun:test";

import {
  MAX_DISPLAY_WIDTH_PER_LINE,
  MAX_LINES_PER_SLIDE,
  MAX_TABLE_ROW_WIDTH,
} from "../constants.js";
import {
  checkSlideOverflow,
  checkTableWidth,
  countContentLines,
  estimateVisualLines,
  getDisplayWidth,
  parseSlides,
  stripMarkdownFormatting,
} from "./overflow.js";

describe("getDisplayWidth", () => {
  it("counts ASCII characters as width 1", () => {
    expect(getDisplayWidth("Hello")).toBe(5);
  });

  it("counts fullwidth characters as width 2", () => {
    expect(getDisplayWidth("こんにちは")).toBe(10);
  });

  it("handles mixed ASCII and fullwidth", () => {
    expect(getDisplayWidth("ABCあいう")).toBe(9);
  });

  it("returns 0 for empty string", () => {
    expect(getDisplayWidth("")).toBe(0);
  });
});

describe("stripMarkdownFormatting", () => {
  it("removes **bold** markers", () => {
    expect(stripMarkdownFormatting("**太字**テスト")).toBe("太字テスト");
  });

  it("removes __bold__ markers", () => {
    expect(stripMarkdownFormatting("__太字__テスト")).toBe("太字テスト");
  });

  it("removes *italic* markers", () => {
    expect(stripMarkdownFormatting("*斜体*テスト")).toBe("斜体テスト");
  });

  it("removes _italic_ markers", () => {
    expect(stripMarkdownFormatting("_斜体_テスト")).toBe("斜体テスト");
  });

  it("removes ~~strikethrough~~ markers", () => {
    expect(stripMarkdownFormatting("~~取消~~テスト")).toBe("取消テスト");
  });

  it("removes inline code backticks", () => {
    expect(stripMarkdownFormatting("`code`テスト")).toBe("codeテスト");
  });

  it("removes link URLs but keeps text", () => {
    expect(stripMarkdownFormatting("[テキスト](https://example.com)")).toBe(
      "テキスト",
    );
  });

  it("removes leading - bullet marker", () => {
    expect(stripMarkdownFormatting("- 箇条書き")).toBe("箇条書き");
  });

  it("removes leading * bullet marker", () => {
    expect(stripMarkdownFormatting("* 箇条書き")).toBe("箇条書き");
  });

  it("removes leading + bullet marker", () => {
    expect(stripMarkdownFormatting("+ 箇条書き")).toBe("箇条書き");
  });

  it("removes leading numbered list marker", () => {
    expect(stripMarkdownFormatting("1. 番号付き")).toBe("番号付き");
  });

  it("removes heading markers", () => {
    expect(stripMarkdownFormatting("## 見出し")).toBe("見出し");
  });

  it("removes deeply nested heading markers", () => {
    expect(stripMarkdownFormatting("###### 見出し6")).toBe("見出し6");
  });

  it("removes quote markers", () => {
    expect(stripMarkdownFormatting("> 引用テキスト")).toBe("引用テキスト");
  });

  it("handles combined formatting", () => {
    expect(stripMarkdownFormatting("- **2022年設立**、KDDIグループ")).toBe(
      "2022年設立、KDDIグループ",
    );
  });
});

describe("estimateVisualLines", () => {
  it("returns 1 for short lines", () => {
    expect(estimateVisualLines("- 短い項目")).toBe(1);
  });

  it("returns 2+ for long Japanese lines", () => {
    const longText =
      "- **2022年設立**、KDDIグループのDX推進専門会社（母体は2016年発足の社内組織）";
    expect(estimateVisualLines(longText)).toBeGreaterThanOrEqual(2);
  });

  it("always returns 1 for table rows (no wrap calculation)", () => {
    expect(
      estimateVisualLines(
        "| 長い長い長い長い長い長い長い長いテキスト | 長い長い長い長い長い長い長い長いテキスト |",
      ),
    ).toBe(1);
  });

  it("returns 1 for short headings", () => {
    expect(estimateVisualLines("## 短い見出し")).toBe(1);
  });

  it("computes ceil for line slightly over the limit", () => {
    // "a" repeated 49 times => width 49, max 48 => ceil(49/48) = 2
    const text = "a".repeat(MAX_DISPLAY_WIDTH_PER_LINE + 1);
    expect(estimateVisualLines(text)).toBe(2);
  });
});

describe("parseSlides", () => {
  it("splits slides with frontmatter", () => {
    const md =
      "---\nmarp: true\ntheme: border\n---\n\n## Slide 1\n\n- Item 1\n\n---\n\n## Slide 2\n\n- Item 2";
    const slides = parseSlides(md);
    expect(slides.length).toBe(2);
    expect(slides[0]).toContain("Slide 1");
    expect(slides[1]).toContain("Slide 2");
  });

  it("handles markdown without frontmatter", () => {
    const md = "## Slide 1\n\n- Item 1\n\n---\n\n## Slide 2";
    const slides = parseSlides(md);
    expect(slides.length).toBe(2);
  });

  it("returns empty array for empty markdown", () => {
    expect(parseSlides("")).toEqual([]);
  });

  it("preserves slide content when frontmatter has trailing whitespace after closing ---", () => {
    const md = "---\ntheme: x\n--- \t\n\n## Body";
    const slides = parseSlides(md);
    expect(slides.length).toBe(1);
    expect(slides[0]).toContain("Body");
  });

  it("treats input as content when frontmatter lacks newline", () => {
    // "---" with no newline at all → not a frontmatter block, returned as-is
    const slides = parseSlides("---");
    expect(slides).toEqual(["---"]);
  });

  it("treats input as content when frontmatter is unclosed", () => {
    const md = "---\ntheme: x\n## body without close";
    const slides = parseSlides(md);
    // Frontmatter never closes, so the whole text is preserved
    expect(slides[0]).toContain("## body");
  });

  it("treats input as content when text after closing --- is malformed", () => {
    // After "\n---" there's a non-whitespace char that's not a newline
    const md = "---\ntheme: x\n---abc\n## body";
    const slides = parseSlides(md);
    expect(slides[0]).toContain("---abc");
  });

  it("strips frontmatter that ends exactly at EOF", () => {
    const md = "---\ntheme: x\n---";
    expect(parseSlides(md)).toEqual([]);
  });
});

describe("countContentLines", () => {
  it("counts heading and bullets", () => {
    const content = "## タイトル\n\n- 項目1\n- 項目2\n- 項目3";
    expect(countContentLines(content)).toBe(4);
  });

  it("skips empty lines", () => {
    const content = "## タイトル\n\n\n\n- 項目1";
    expect(countContentLines(content)).toBe(2);
  });

  it("skips single-line HTML comments", () => {
    const content = "<!-- _class: lead -->\n## タイトル\n- 項目1";
    expect(countContentLines(content)).toBe(2);
  });

  it("counts a non-comment line that contains '-->' inside", () => {
    // Starts with <!-- and ends with --> but has another --> inside → not skipped
    const content = "<!-- a --> b -->";
    expect(countContentLines(content)).toBe(1);
  });

  it("skips table separator rows", () => {
    const content = "## 比較表\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    expect(countContentLines(content)).toBe(4);
  });

  it("counts code block content but skips markers", () => {
    const content =
      "## コード例\n\n```python\nprint('hello')\nprint('world')\n```";
    expect(countContentLines(content)).toBe(3);
  });

  it("counts only code block content, not markers", () => {
    const content = "```\nline1\n```";
    expect(countContentLines(content)).toBe(1);
  });

  it("counts exactly 9 lines for 9-line slide", () => {
    const lines = [
      "## 見出し",
      ...Array.from({ length: 8 }, (_, i) => `- 項目${i + 1}`),
    ];
    expect(countContentLines(lines.join("\n"))).toBe(9);
  });

  it("counts quote block lines", () => {
    expect(countContentLines("## 引用\n\n> 引用文1\n> 引用文2")).toBe(3);
  });

  it("skips table separators with alignment", () => {
    const content =
      "| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |";
    expect(countContentLines(content)).toBe(2);
  });

  it("counts long lines as multiple visual lines", () => {
    const longBullet =
      "- **2022年設立**、KDDIグループのDX推進専門会社（母体は2016年発足の社内組織）";
    const content = `## KAGとは\n\n${longBullet}\n- 短い項目\n- 短い項目2`;
    expect(countContentLines(content)).toBeGreaterThan(4);
  });
});

describe("checkTableWidth", () => {
  it("returns 0 when no table overflow", () => {
    const content = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(checkTableWidth(content)).toBe(0);
  });

  it("ignores non-table lines", () => {
    expect(checkTableWidth("## heading\n- item")).toBe(0);
  });

  it("detects table width overflow", () => {
    const wideRow = `| ${"あ".repeat(20)} | ${"い".repeat(20)} |`;
    const content = `| A | B |\n|---|---|\n${wideRow}`;
    expect(checkTableWidth(content)).toBeGreaterThan(MAX_TABLE_ROW_WIDTH);
  });

  it("skips separator rows", () => {
    expect(checkTableWidth("|:-----|:------:|------:|")).toBe(0);
  });

  it("returns the largest overflowing row when multiple rows overflow", () => {
    const wideRow1 = `| ${"あ".repeat(20)} |`; // narrower
    const wideRow2 = `| ${"あ".repeat(40)} |`; // wider
    const content = `${wideRow1}\n${wideRow2}`;
    const w1 = `| ${"あ".repeat(20)} |`.length; // not used directly
    expect(checkTableWidth(content)).toBeGreaterThan(w1);
  });
});

describe("checkSlideOverflow", () => {
  it("returns empty array when all slides are within limits", () => {
    const md =
      "---\nmarp: true\n---\n\n## Slide 1\n\n- Item 1\n- Item 2\n\n---\n\n## Slide 2\n\n- Item 1";
    expect(checkSlideOverflow(md)).toEqual([]);
  });

  it("detects line overflow", () => {
    const lines = [
      "## 見出し",
      ...Array.from({ length: 9 }, (_, i) => `- 項目${i + 1}`),
    ];
    const md = `---\nmarp: true\n---\n\n${lines.join("\n")}`;
    const violations = checkSlideOverflow(md);
    expect(violations.length).toBe(1);
    const v = violations[0];
    expect(v.type).toBe("line_overflow");
    if (v.type === "line_overflow") {
      expect(v.line_count).toBe(10);
      expect(v.excess).toBe(1);
      expect(v.max_lines).toBe(MAX_LINES_PER_SLIDE);
    }
  });

  it("detects overflow from long line wrapping (KAG slide reproduction)", () => {
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
    expect(violations[0].type).toBe("line_overflow");
  });

  it("skips title slide (_class: top)", () => {
    const lines = [
      "<!-- _class: top -->",
      "## タイトル",
      ...Array.from({ length: 14 }, (_, i) => `- 項目${i + 1}`),
    ];
    const md = `---\nmarp: true\n---\n\n${lines.join("\n")}`;
    expect(checkSlideOverflow(md)).toEqual([]);
  });

  it("skips section divider (_class: lead)", () => {
    const lines = [
      "<!-- _class: lead -->",
      "## セクション",
      ...Array.from({ length: 14 }, (_, i) => `- 項目${i + 1}`),
    ];
    const md = `---\nmarp: true\n---\n\n${lines.join("\n")}`;
    expect(checkSlideOverflow(md)).toEqual([]);
  });

  it("skips end slide (_class: end)", () => {
    const slideContent = `<!-- _class: end -->\n## Thank you!\n${Array.from({ length: 15 }, (_, i) => `- ${i}`).join("\n")}`;
    const md = `---\nmarp: true\n---\n\n${slideContent}`;
    expect(checkSlideOverflow(md)).toEqual([]);
  });

  it("skips bibliography slide (_class: tinytext)", () => {
    const lines = [
      "<!-- _class: tinytext -->",
      "## 参考文献",
      ...Array.from({ length: 15 }, (_, i) => `- https://example.com/${i}`),
    ];
    const md = `---\nmarp: true\n---\n\n${lines.join("\n")}`;
    expect(checkSlideOverflow(md)).toEqual([]);
  });

  it("detects multiple violations across slides", () => {
    const slide1 = [
      "## S1",
      ...Array.from({ length: 10 }, (_, i) => `- 項目${i + 1}`),
    ].join("\n");
    const slide2 = [
      "## S2",
      ...Array.from({ length: 11 }, (_, i) => `- 項目${i + 1}`),
    ].join("\n");
    const md = `---\nmarp: true\n---\n\n${slide1}\n\n---\n\n${slide2}`;
    expect(checkSlideOverflow(md).length).toBe(2);
  });

  it("detects table overflow", () => {
    const wideRow = `| ${"あ".repeat(20)} | ${"い".repeat(20)} |`;
    const content = `## テーブル\n\n| A | B |\n|---|---|\n${wideRow}`;
    const md = `---\nmarp: true\n---\n\n${content}`;
    const violations = checkSlideOverflow(md);
    expect(violations.length).toBe(1);
    const v = violations[0];
    expect(v.type).toBe("table_overflow");
    if (v.type === "table_overflow") {
      expect(v.max_width).toBeGreaterThan(MAX_TABLE_ROW_WIDTH);
      expect(v.limit).toBe(MAX_TABLE_ROW_WIDTH);
    }
  });
});
