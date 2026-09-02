-- One attempt at explaining a concept in the student's own words, plus the three
-- lists the model returned. Append-only, so nothing here is ever updated.
--
-- Purely additive: one CREATE TABLE, one index and one foreign key, all on a table
-- that does not exist yet. No statement touches an existing table or row.
CREATE TABLE "TeachBackRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "attempt" TEXT NOT NULL,
    "correct" TEXT[],
    "missing" TEXT[],
    "wrong" TEXT[],
    "attemptedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachBackRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeachBackRecord_userId_attemptedAt_idx" ON "TeachBackRecord"("userId", "attemptedAt");

ALTER TABLE "TeachBackRecord" ADD CONSTRAINT "TeachBackRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
