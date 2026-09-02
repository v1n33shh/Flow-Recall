-- The start of the local calendar month the shared AI-lookup counter
-- (definitionsUsed, spent by /api/define, /api/ask and /api/concept-map) is
-- currently counting in. NULL means "never rolled over", which is every row that
-- exists today; the first lookup after this ships stamps the current month.
--
-- Purely additive: one nullable column on an existing table, no default, no
-- backfill, no index. Nothing reads it until the application code that writes it
-- ships, so this is safe to apply ahead of the deploy.
ALTER TABLE "User" ADD COLUMN "lookupsResetAt" TIMESTAMP(3);
