-- The day a deck is examined, if the student set one. Feeds daysUntilExam in
-- desiredRetentionFor, which raises that deck's retention floor to 0.95 inside 21
-- days. NULL means no exam, which is not the same as an exam in the past.
--
-- Purely additive: one nullable column on an existing table, no default, no
-- backfill, no index. Every existing row reads as "no exam", which is what they are.
ALTER TABLE "Deck" ADD COLUMN "examDate" TIMESTAMP(3);
