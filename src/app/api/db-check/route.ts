import { prisma } from "@/lib/prisma";

// Temporary diagnostic route - delete after debugging the Google OAuth "Configuration" error.
// Checks which tables exist in the production DB.
export async function GET() {
  try {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    // Also check if Account table has any rows (to confirm it was migrated)
    let accountCount = null;
    try {
      accountCount = await prisma.account.count();
    } catch (e) {
      accountCount = `ERROR: ${String(e)}`;
    }

    return Response.json({ tables, accountCount });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
