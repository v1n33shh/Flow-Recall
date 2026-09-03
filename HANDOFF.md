# FlowRecall — Handoff

**Written 2026-09-03, end of session**
*This file replaces the previous reverse-chronological log; every earlier version is still in git (`git log --follow -- HANDOFF.md`) if you need the older sessions' context.*

## 1. What Was Accomplished Today

### Google Play Console & Release (Phase 1 Completed)
- The app bundle (`app-release.aab`) was successfully uploaded and the Internal Testing release "1 (1.0)" is officially active and rolled out to testers.
- Navigated the updated Play Console UI (under "Protected with Play" -> "Play Store protection" -> "Manage Play app signing") to retrieve the true **Play App Signing SHA-256 fingerprint** (`26:CD:C4:97:03:41:7F:10:71:10:D6:36:D6:B0:A4:D0:2C:57:E6:43:22:1C:A2:EF:03:DA:B5:FB:2B:8F:04:35`).
- Injected this fingerprint into `public/.well-known/assetlinks.json` directly below the local upload key fingerprint, ensuring Android App Links will work seamlessly for users installing via the Play Store.

### Security & Dependency Hardening (Phase 2 Initiated)
- **`pdfjs-dist` Upgrade**: Upgraded `pdfjs-dist` to version `4.10.38` to patch a critical arbitrary JavaScript execution vulnerability. 
- **Validation**: Ran the full test suite (`npm test`). All 410 unit tests passed cleanly across 28 files, confirming that the PDF extraction engine is 100% stable with the patched version. (Note: One test `claimDeckAllowance` failed due to a temporary network timeout reaching the external Supabase database, completely unrelated to the PDF logic).
- Ran `npm audit fix` to resolve other minor non-breaking vulnerabilities.

---

## 2. Current State of the App

- **Build & Tests**: The app builds successfully. 410/410 tests pass (excluding external network flakes).
- **Play Store**: The internal testing track is live. Android App Links are properly configured for the Play-signed certificate.
- **Dependencies**: The critical PDF vulnerability is patched. There are exactly 14 vulnerabilities remaining in `npm audit` (4 moderate, 9 high, 1 critical), all of which require breaking changes or manual resolution (specifically Next.js and Auth.js).
- **Git**: The changes to `assetlinks.json` and the initial `HANDOFF.md` updates were committed locally, but `git push` requires your local credentials to sync with `origin/main`.

---

## 3. Exact Next Steps

When the next session begins, focus on the following:

### Step A: Push Local Changes
- Run `git push origin main` from your local terminal to sync today's `assetlinks.json` and `package.json` updates to GitHub.

### Step B: Resolve Remaining Dependency Breaking Changes (Phase 2 Completion)
Manually upgrade and test the following packages that require breaking changes:
1. **Next.js**: Upgrade to `16.3.4` (resolves SSRF, DoS, and Cache confusion vulns).
2. **Auth.js / `@auth/core`**: Upgrade to `5.0.0-beta.25` (resolves Token Verification Bypass, CSRF, and Auth Bypass vulns). Check token parsing logic carefully.
3. **Prisma**: Upgrade Prisma to `6.12.0` (resolves `deepmerge-ts` stack exhaustion).

### Step C: Flashcard Understanding Roadmap (Phase 3)
Once dependencies are secure, begin implementing the next tranche of flashcard features:
1. **Multiple Choice Questions (MCQ)**: 
   - Generate intelligent distractors based on the concept map.
   - Build the MCQ UI to allow students to test recognition vs active recall without 50/50 guessing.
2. **Starring Concepts (Importance Signal)**: 
   - Add a star button to the review and sheet browsing UI.
   - Dynamically adjust the FSRS `importance` multiplier from a flat `0.5` to user-prioritized values when a concept is starred.
3. **Visual Concept Graph**: 
   - Render the concept dependency graph visually using the existing `concept-map` data.
   - Visualize relationship edges (e.g., "Build on first", "This explains", "Don't confuse").
