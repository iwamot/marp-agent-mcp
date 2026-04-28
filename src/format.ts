import type { Violation } from "./overflow.js";

export function formatViolation(v: Violation): string {
  if (v.type === "line_overflow") {
    return `スライド${v.slide_number}: 実質${v.line_count}行（上限${v.max_lines}行、${v.excess}行超過）`;
  }
  return `スライド${v.slide_number}: 表の横幅超過（${v.max_width}文字、上限${v.limit}文字）`;
}

export function formatViolationMessage(
  violations: readonly Violation[],
): string {
  const lines = violations.map(formatViolation);
  return `オーバーフローを検出しました。修正してください。\n${lines.join("\n")}`;
}
