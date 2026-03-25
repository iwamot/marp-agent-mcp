import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      external: ["@marp-team/marp-core", "@marp-team/marpit-svg-polyfill"],
      output: {
        paths: {
          "@marp-team/marp-core": "https://esm.sh/@marp-team/marp-core@4.3.0",
          "@marp-team/marpit-svg-polyfill":
            "https://esm.sh/@marp-team/marpit-svg-polyfill@2.1.0",
        },
      },
    },
  },
});
