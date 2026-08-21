-- CreateTable
CREATE TABLE "UsedMobileBridgeToken" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsedMobileBridgeToken_pkey" PRIMARY KEY ("jti")
);
