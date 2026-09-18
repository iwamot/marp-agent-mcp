import { createRequire } from "node:module";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const INPUT = process.env.INPUT;
if (!INPUT) {
  throw new Error("INPUT environment variable is not set");
}

// marp-core stays external and loads from a CDN, so this version is the
// engine that renders the preview. Read from the installed package to keep it
// in step with the marp-core that marp-cli exports with.
const { version: MARP_CORE_VERSION } = createRequire(import.meta.url)(
  "@marp-team/marp-core/package.json",
);

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,

    rollupOptions: {
      input: INPUT,
      external: ["@marp-team/marp-core"],
      output: {
        paths: {
          "@marp-team/marp-core": `https://esm.sh/@marp-team/marp-core@${MARP_CORE_VERSION}`,
        },
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
