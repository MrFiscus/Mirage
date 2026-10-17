import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["server/defense/__tests__/setup.ts"], include: ["server/**/*.test.ts"] },
});
