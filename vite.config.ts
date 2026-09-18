import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [
      ["src/__tests__/loader.test.ts", "node"],
      ["src/__tests__/placementEngine.test.ts", "node"],
      ["src/__tests__/gameplay.test.tsx", "jsdom"],
    ],
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
