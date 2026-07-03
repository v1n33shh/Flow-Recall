import { PrismaClient } from "@prisma/client";

// Next.js hot-reloads modules in dev, which would otherwise instantiate a
// fresh PrismaClient (and a fresh connection pool) on every edit - stash
// the instance on the global object so dev reloads reuse it.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
