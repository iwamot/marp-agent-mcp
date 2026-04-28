import { describe, expect, it } from "bun:test";

import { formatViolation, formatViolationMessage } from "./format.js";
import type { Violation } from "./overflow.js";

const lineOverflow: Violation = {
  type: "line_overflow",
  slide_number: 3,
  line_count: 12,
  max_lines: 9,
  excess: 3,
};

const tableOverflow: Violation = {
  type: "table_overflow",
  slide_number: 5,
  max_width: 80,
  limit: 64,
  excess: 16,
};

describe("formatViolation", () => {
  it("formats line_overflow with slide number, count, max, and excess", () => {
    expect(formatViolation(lineOverflow)).toBe(
      "スライド3: 実質12行（上限9行、3行超過）",
    );
  });

  it("formats table_overflow with slide number, max width, and limit", () => {
    expect(formatViolation(tableOverflow)).toBe(
      "スライド5: 表の横幅超過（80文字、上限64文字）",
    );
  });
});

describe("formatViolationMessage", () => {
  it("prefixes a header and joins each violation on its own line", () => {
    const msg = formatViolationMessage([lineOverflow, tableOverflow]);
    expect(msg).toBe(
      [
        "オーバーフローを検出しました。修正してください。",
        "スライド3: 実質12行（上限9行、3行超過）",
        "スライド5: 表の横幅超過（80文字、上限64文字）",
      ].join("\n"),
    );
  });

  it("returns just the header when given an empty list", () => {
    expect(formatViolationMessage([])).toBe(
      "オーバーフローを検出しました。修正してください。\n",
    );
  });
});
