# FlowRecall — Handoff

**Written 2026-09-03, second session of the day.**
*Supersedes the version written earlier today, which listed next steps that were already done — see §3. Earlier versions: `git log --follow -- HANDOFF.md`.*

## 1. State right now

- **Tests**: 410 passed / 410 across 28 files, `npm test` exit 0 — verified twice this session, before and after the change in §2. This includes the `claimDeckAllowance` suite the earlier handoff reported as failing.
- **Build**: `npm run build` succeeds.
- **Git**: clean tree, `main` == `origin/main`. Nothing to push.
- **Play Store**: internal testing release "1 (1.0)" is live. `public/.well-known/assetlinks.json` carries both fingerprints — the upload key (`E1:F4:35:2F…BC:09`) and Play App Signing (`26:CD:C4:97…04:35`) — so App Links work for Play installs and sideloads alike.
- **Dependencies**: `npm audit` reports **5 vulnerabilities (4 high, 1 moderate, no critical)**, down from 12 at the start of this session.

A caveat on "410/410": `src/lib/freeQuotaDb.test.ts` and `src/lib/clozeGradeRateLimit.test.ts` are *deliberate* integration tests against the real Supabase Postgres — the rationale is in the comment at the top of the former, and it is a good one (the guarantee under test lives in Postgres's row locking, not in this repo). Between them they are ~130s of the ~94s parallel run, and they fail whenever the pooler is unreachable. So the green suite means "410/410 with a live database", and a red run should be checked for connectivity before being read as a regression. That is what happened in the earlier handoff.

## 2. What changed this session

**Removed the `@capacitor/assets` devDependency.** It was declared in `package.json` and invoked by nothing — no npm script, no workflow, no code. It bundled its own ancient `@capacitor/cli@5.7.8`, and through that subtree it carried the only **critical** in the tree (`tar@6.2.1` — arbitrary file create/overwrite via hardlink path traversal), plus `sharp@0.32.6`, `@trapezedev/project` → `@xmldom/xmldom`, and `xcode` → `uuid`. Every one of those chains was reachable *only* through it, so removal cleared them all at once: 12 vulnerabilities (1 critical / 7 high / 4 moderate) → 5 (0 critical / 4 high / 1 moderate). Tests and build were re-run green afterwards. The diff is `package.json` plus 1747 deleted lock lines.

There was no upgrade path — `3.0.5` is the latest published `@capacitor/assets`, which is why `npm audit` reported `fixAvailable: false` for the `sharp` node.

Nothing was lost by removing it. Its outputs, the 56 icon and splash PNGs under `android/app/src/main/res/`, are committed, and its input `assets/icon.png` is still in the repo. If the icons ever need regenerating, run it one-off rather than re-adding the dependency:

```bash
npx @capacitor/assets generate --android
```

## 3. Corrections to the earlier handoff

Its "Exact Next Steps" had transcribed `npm audit`'s `fixAvailable` field without checking those versions against what was installed. For two packages that field pointed at versions *older* than the installed ones, so following the steps literally would have been a downgrade.

| Earlier claim | Reality |
|---|---|
| "Upgrade Next.js to `16.3.4`" | Already `16.3.4` — done in `111eaee`, up from `16.2.10`. |
| "Upgrade Auth.js / `@auth/core` to `5.0.0-beta.25`" | `next-auth` is `^5.0.0-beta.31`, resolving to beta.32; `@auth/core` is 0.41.3. beta.25 is **older**. Nothing to do. |
| "Upgrade Prisma to `6.12.0` (resolves `deepmerge-ts`)" | Already `6.19.3`, so `6.12.0` is a **downgrade** — and it does not resolve `deepmerge-ts`, which is still present at 6.19.3 (§4b). |
| "`pdfjs-dist` upgraded to `4.10.38`" | It went `6.1.200` → **`6.3.289`**, also in `111eaee`. |
| "`git push` requires your local credentials" | Everything was already pushed; tree clean, `main` == `origin/main`. |
| "14 vulnerabilities (4 moderate, 9 high, 1 critical)" | It was 12 (4 / 7 / 1). Now 5. |
| "One test failed due to a temporary network timeout … unrelated to the PDF logic" | True as far as it goes, but that test is an intentional live-Postgres integration test, not a flake to wave past. See the caveat in §1. |

## 4. The 5 remaining vulnerabilities, and why each is still here

Neither remaining chain has a clean fix; both are waiting on someone upstream.

**a) `epubjs@0.3.93` → `@xmldom/xmldom@0.7.13` — 1 high + 1 moderate. This is the one on the production path.**

XML injection via unsafe CDATA serialization, plus uncontrolled recursion in serialization leading to DoS. The advisory range is `<=0.8.14`; the hoisted top-level copy is 0.7.13 and it comes from `epubjs`, the EPUB reader the app ships. (The other copy in the tree, `0.9.12` under `@capacitor/cli` → `plist`, is outside the range and fine.)

npm offers `epubjs@0.4.2`, but this needs a decision rather than a command:

- 0.4.2 is a **semver-major**, and epubjs's `latest` dist-tag is still **0.3.93** — the maintainer published 0.4.x and never promoted it. The library is effectively unmaintained.
- The reader is finished work; the standing rule is to call its extraction library, not edit it. A major bump to its rendering engine is exactly the kind of change that rule exists to prevent.
- Verifying it would mean the real EPUB in the library (the Carnegie book) on-device, not a synthetic file.

**b) `prisma@6.19.3` → `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5` — 3 highs, all one chain.**

Stack exhaustion when merging recursive object graphs; advisory range `<8.0.0`. The only fix npm offers is `prisma@6.12.0`, a downgrade to before `@prisma/config` existed — not a real option. This code path is build- and CLI-time config merging, not the request path. It waits on Prisma bumping `deepmerge-ts` to ≥8.

## 5. Do this next

*Decision Made:* We are **leaving `epubjs` at `0.3.93`** for now. The exposure risk (XML injection inside a student-selected EPUB) is minimal, and a major version bump on a finished, unmaintained reader poses a much larger regression risk. We will revisit if `0.4.x` is ever promoted to latest.

**Immediate Task: Phase 3 — flashcard understanding.** Unchanged from the earlier handoff:

1. **Multiple Choice Questions** — generate distractors from the concept map; build the MCQ UI so recognition can be tested without handing the student a 50/50 guess.
2. **Starring concepts** — a star button in the review and sheet-browsing UI, driving the FSRS `importance` multiplier off the flat `0.5` and onto the student's own priorities.
3. **Visual concept graph** — render the existing `concept-map` data, including its edge kinds ("Build on first", "This explains", "Don't confuse").
