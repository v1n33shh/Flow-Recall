-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "concepts" JSONB NOT NULL,
    "pendingChunks" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "conceptMap" JSONB,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeUnit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceDeckId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL,
    "concept" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "grade" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "credited" BOOLEAN NOT NULL,
    "elapsedDays" DOUBLE PRECISION NOT NULL,
    "stabilityBefore" DOUBLE PRECISION,
    "stabilityAfter" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT,
    "couplingOnSuccess" DOUBLE PRECISION NOT NULL,
    "couplingOnLapse" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "beyondMaterial" BOOLEAN NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deck_userId_updatedAt_idx" ON "Deck"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deck_id_userId_key" ON "Deck"("id", "userId");

-- CreateIndex
CREATE INDEX "KnowledgeUnit_userId_updatedAt_idx" ON "KnowledgeUnit"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeUnit_id_userId_key" ON "KnowledgeUnit"("id", "userId");

-- CreateIndex
CREATE INDEX "ReviewRecord_userId_reviewedAt_idx" ON "ReviewRecord"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "AskRecord_userId_askedAt_idx" ON "AskRecord"("userId", "askedAt");

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeUnit" ADD CONSTRAINT "KnowledgeUnit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskRecord" ADD CONSTRAINT "AskRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

