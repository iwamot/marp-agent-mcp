import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const INPUT = process.env.INPUT;
if (!INPUT) {
  throw new Error("INPUT environment variable is not set");
}

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,

    rollupOptions: {
      input: INPUT,
      external: ["@marp-team/marp-core", "@marp-team/marpit-svg-polyfill"],
      output: {
        paths: {
          "@marp-team/marp-core": "https://esm.sh/@marp-team/marp-core@4.3.0",
          "@marp-team/marpit-svg-polyfill":
            "https://esm.sh/@marp-team/marpit-svg-polyfill@2.1.0",
        },
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
