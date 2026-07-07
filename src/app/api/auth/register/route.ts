import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const BCRYPT_ROUNDS = 10;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Please enter a valid email and a password of at least 8 characters." },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  // Everything that touches the database goes inside try/catch. If Supabase is
  // unreachable / sleeping, or the schema was never pushed (`prisma db push`),
  // Prisma throws - without this, Next.js would return an HTML 500 page and the
  // client's `await res.json()` would blow up with "Unexpected end of JSON input".
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.user.create({ data: { email, password: hashedPassword } });

    return Response.json({ success: true });
  } catch (error) {
    // P2002 = unique constraint violation. The findUnique check above has a tiny
    // race window (two rapid submits of the same email); the DB's unique index on
    // `email` is the real guard, so translate that into the same friendly 409
    // rather than a scary 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }

    console.error("[auth/register] failed:", error);
    return Response.json({ error: "Database error. Please try again." }, { status: 500 });
  }
}
