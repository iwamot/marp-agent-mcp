import { describe, expect, it } from "bun:test";

import { injectTheme } from "./inject-theme.js";

describe("injectTheme", () => {
  it("adds a frontmatter block when none exists", () => {
    const out = injectTheme("# Title\n\nbody", "speee");
    expect(out).toBe("---\ntheme: speee\n---\n\n# Title\n\nbody");
  });

  it("replaces an existing theme line in the frontmatter", () => {
    const md = "---\nmarp: true\ntheme: border\n---\n\n# Title";
    const out = injectTheme(md, "gradient");
    expect(out).toBe("---\nmarp: true\ntheme: gradient\n---\n\n# Title");
  });

  it("appends theme line when frontmatter has no theme", () => {
    const md = "---\nmarp: true\n---\n\n# Title";
    const out = injectTheme(md, "speee");
    expect(out).toBe("---\nmarp: true\ntheme: speee\n---\n\n# Title");
  });

  it("normalizes legacy inline directives to _class: lead", () => {
    const md = [
      "---",
      "marp: true",
      "---",
      "",
      "<!-- _backgroundColor: #303030 --> <!-- _color: white -->",
      "# Section",
    ].join("\n");
    const out = injectTheme(md, "speee");
    expect(out).toContain("<!-- _class: lead -->");
    expect(out).not.toContain("_backgroundColor");
    expect(out).not.toContain("_color: white");
  });
});
