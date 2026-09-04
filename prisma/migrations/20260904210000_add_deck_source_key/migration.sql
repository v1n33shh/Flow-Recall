-- Identity of the text a deck was generated from, so a second upload of the same
-- PDF continues that deck instead of adding another copy of it to the library.
--
-- Nullable with no default and no backfill, deliberately: the source text a deck
-- consumed is not kept anywhere, and `pendingChunks` is only the shrinking
-- remainder, so there is nothing to derive a key from for an existing row. A NULL
-- here never matches, which means an old deck behaves exactly as it does today.
ALTER TABLE "Deck" ADD COLUMN "sourceKey" TEXT;
