import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A guard against selling something that does not exist.
 *
 * "Streak Freezes" was listed in PRO_FEATURES on the pricing page, upsold on the
 * completion slide and again in the streak modal, and rendered as a pill hardcoded to 0 -
 * with no database column, no route and no logic anywhere in the app. Someone paying
 * ₹299 a month for it received a counter that never moved. The code's own comment called
 * it "paywall bait".
 *
 * It was removed rather than built. This test exists so it cannot drift back in, and so
 * the next entitlement invented in marketing copy before it exists in code fails here
 * rather than in front of a paying student.
 *
 * ADDING A NAME BELOW is a commitment: only add one once the thing it names is actually
 * implemented, and delete its entry here at the same time.
 */
const UNIMPLEMENTED_ENTITLEMENTS = [
  // Matched as a PRODUCT NOUN, not as the English verb: "so you never freeze on an exam
  // again" in StudyFeed's upsell is fine and must stay, while "Streak Freezes" and the
  // bare capitalised "Freezes" from the old pill are not.
  { name: "Streak Freezes", pattern: /\bStreak Freeze|\bFreezes?\b/ },
];

const SRC = join(process.cwd(), "src");
const CODE = /\.(ts|tsx)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return CODE.test(entry) ? [full] : [];
  });
}

/** Strips comments, so a file may still EXPLAIN why a feature was removed - this very
 * test does - without tripping the check that its copy is gone. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no user-facing copy sells an unbuilt entitlement", () => {
  const files = walk(SRC).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { name, pattern } of UNIMPLEMENTED_ENTITLEMENTS) {
    it(`never sells "${name}" anywhere outside a comment`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        if (pattern.test(code(readFileSync(file, "utf8")))) {
          offenders.push(file.replace(SRC, "src"));
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
