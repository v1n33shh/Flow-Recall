-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clozeGradesToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastClozeGradeDate" TIMESTAMP(3);
