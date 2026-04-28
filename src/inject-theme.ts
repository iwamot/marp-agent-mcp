import type { ThemeId } from "../constants.js";

export function injectTheme(markdown: string, theme: ThemeId): string {
  // Normalize legacy inline directives
  const normalized = markdown.replace(
    /<!-- _backgroundColor: #303030 -->\s*<!-- _color: white -->/g,
    "<!-- _class: lead -->",
  );

  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontMatterMatch) {
    return `---\ntheme: ${theme}\n---\n\n${normalized}`;
  }

  const frontMatter = frontMatterMatch[1];
  const hasTheme = /^theme:/m.test(frontMatter);
  const newFrontMatter = hasTheme
    ? frontMatter.replace(/^theme:.*$/m, `theme: ${theme}`)
    : `${frontMatter}\ntheme: ${theme}`;
  return normalized.replace(frontMatterMatch[0], `---\n${newFrontMatter}\n---`);
}
