-- Per-REQUEST generation allowance, spent by /api/ingest (every chunk) and
-- /api/decks/[id]/shuffle. Separate from decksGeneratedToday, which counts decks:
-- one deck is up to 20 requests, and continuation chunks were never counted at all.
--
-- Nullable reset marker, matching "lookupsResetAt": every existing row is mid-month
-- by definition, so a NULL means "never reset" and the first rollover happens at the
-- next month boundary rather than handing out a retroactive allowance.
ALTER TABLE "User" ADD COLUMN "generationRequestsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "generationResetAt" TIMESTAMP(3);
