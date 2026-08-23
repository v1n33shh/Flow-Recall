-- Reconciliation migration. NOT executed against production (marked applied
-- via `prisma migrate resolve --applied` instead) - the live database
-- already has every column/table below, added at some point via
-- `prisma db push` without ever generating a migration file for it. This
-- exists purely so the migration history matches reality retroactively:
-- `prisma migrate dev`/`deploy` stop reporting drift, and a genuinely fresh
-- database provisioned from this history alone ends up with the correct
-- schema instead of stopping at the tiny original init skeleton.
--
-- Hand-written rather than tool-generated: `prisma migrate diff` renders
-- this gap as a full DROP+CREATE of every affected table (an artifact of
-- the `plan` enum-to-text type change below), which is fine as a
-- description of the live database in isolation but is NOT safe to replay
-- in sequence after the init migration - "User" etc. already exist by this
-- point, so DROP+CREATE would destroy real rows on an actual fresh replay,
-- and even for empty tables it's needlessly destructive-shaped. Additive
-- ALTER/CREATE only, matching what a fresh sequential migrate deploy needs.

-- AlterTable: `plan` moves from the init migration's Plan enum to a plain
-- TEXT column (see schema.prisma's comment on why) - existing 'FREE'/'PRO'
-- values cast losslessly since the enum's labels are the same strings.
ALTER TABLE "User" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "plan" TYPE TEXT USING "plan"::TEXT;
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE';
DROP TYPE "Plan";

-- AlterTable: billing, gamification, and usage-limit fields added since init.
ALTER TABLE "User"
  ADD COLUMN "password" TEXT,
  ADD COLUMN "planStatus" TEXT,
  ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "razorpayCustomerId" TEXT,
  ADD COLUMN "razorpaySubscriptionId" TEXT,
  ADD COLUMN "currentStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastStudyDate" TIMESTAMP(3),
  ADD COLUMN "decksGeneratedToday" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeckGeneratedDate" TIMESTAMP(3),
  ADD COLUMN "definitionsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");
CREATE UNIQUE INDEX "User_razorpayCustomerId_key" ON "User"("razorpayCustomerId");
CREATE UNIQUE INDEX "User_razorpaySubscriptionId_key" ON "User"("razorpaySubscriptionId");

-- CreateTable
CREATE TABLE "StudyDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyDay_userId_day_idx" ON "StudyDay"("userId", "day");
CREATE UNIQUE INDEX "StudyDay_userId_day_key" ON "StudyDay"("userId", "day");

-- AddForeignKey
ALTER TABLE "StudyDay" ADD CONSTRAINT "StudyDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
