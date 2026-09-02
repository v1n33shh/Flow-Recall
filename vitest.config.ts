import { defineConfig } from "vitest/config";
import path from "path";

// Two projects, because the suite has two genuinely different needs and one
// `environment` cannot serve both.
//
// `node` is everything the engine is made of - pure functions over records, which
// is why they were written as pure functions in the first place. It also holds
// clozeGradeRateLimit.test.ts, which makes REAL round-trips to remote Postgres
// (deliberately - see that file), so it keeps the generous timeout and must never
// be moved into a browser-ish environment.
//
// `dom` renders components. Every UI defect this project has ever found came off
// the phone by hand, including a correct concept-map edge silently discarded and a
// `wrong` list congratulating a student on being wrong - both of them reachable
// from a render assertion in milliseconds. Split by extension rather than by
// directory so a component's test sits next to it like every other test here.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          // clozeGradeRateLimit.test.ts talks to remote Postgres; the default 5s
          // is too tight for that connection.
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
  },
});
