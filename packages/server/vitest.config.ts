import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@ab/metadata": resolve(__dirname, "../metadata/src/index.ts"),
      "@ab/engine": resolve(__dirname, "../engine/src/index.ts"),
      "@ab/ai": resolve(__dirname, "../ai/src/index.ts"),
    },
  },
  test: {
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/**/index.ts"],
    },
  },
});
