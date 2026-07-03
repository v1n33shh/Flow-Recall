import bcrypt from "bcryptjs";
import { z } from "zod";
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.user.create({ data: { email, password: hashedPassword } });

  return Response.json({ success: true });
}
