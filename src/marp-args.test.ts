import { describe, expect, it } from "bun:test";

import { buildMarpArgs } from "./marp-args.js";

const baseInput = {
  mdPath: "/tmp/slide.md",
  outputPath: "/tmp/slide.out",
  themePath: null,
  editable: false,
} as const;

describe("buildMarpArgs", () => {
  it("includes the input path, output flag, and --pdf for pdf format", () => {
    const args = buildMarpArgs({ ...baseInput, format: "pdf" });
    expect(args).toEqual([
      "/tmp/slide.md",
      "--no-stdin",
      "--allow-local-files",
      "-o",
      "/tmp/slide.out",
      "--pdf",
    ]);
  });

  it("uses --pptx for pptx format and omits --pptx-editable when editable=false", () => {
    const args = buildMarpArgs({
      ...baseInput,
      format: "pptx",
      editable: false,
    });
    expect(args).toContain("--pptx");
    expect(args).not.toContain("--pptx-editable");
  });

  it("adds --pptx-editable when editable=true", () => {
    const args = buildMarpArgs({
      ...baseInput,
      format: "pptx",
      editable: true,
    });
    expect(args).toContain("--pptx");
    expect(args).toContain("--pptx-editable");
  });

  it("does not add --pptx-editable for pdf even when editable=true", () => {
    const args = buildMarpArgs({
      ...baseInput,
      format: "pdf",
      editable: true,
    });
    expect(args).not.toContain("--pptx-editable");
    expect(args).not.toContain("--pptx");
  });

  it("appends --theme with the path when themePath is provided", () => {
    const args = buildMarpArgs({
      ...baseInput,
      format: "pdf",
      themePath: "/themes/speee.css",
    });
    const themeIdx = args.indexOf("--theme");
    expect(themeIdx).toBeGreaterThan(-1);
    expect(args[themeIdx + 1]).toBe("/themes/speee.css");
  });

  it("omits --theme when themePath is null", () => {
    const args = buildMarpArgs({
      ...baseInput,
      format: "pdf",
      themePath: null,
    });
    expect(args).not.toContain("--theme");
  });
});
