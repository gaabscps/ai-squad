import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node", // backend continua em node...
    environmentMatchGlobs: [["web/**", "jsdom"]], // ...e o front roda em jsdom
    setupFiles: ["./vitest.setup.ts"],
  },
});
