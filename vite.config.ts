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
      external: ["@marp-team/marp-core"],
      output: {
        paths: {
          "@marp-team/marp-core": "https://esm.sh/@marp-team/marp-core@4.3.0",
        },
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
