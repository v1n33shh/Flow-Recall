import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // clozeGradeRateLimit.test.ts makes real round-trips to remote Postgres
    // (deliberately - see that file's comment on why it's an integration
    // test, not a mock) - the default 5s is too tight for that connection.
    testTimeout: 20_000,
  },
});
