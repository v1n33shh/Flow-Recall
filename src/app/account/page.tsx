import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/components/SignOutButton";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, image: true, plan: true },
  });

  if (!user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      <div className="mt-6 flex items-center gap-4 rounded-2xl border-2 border-white/10 bg-white/5 p-5">
        {user.image ? (
          <Image src={user.image} alt="" width={56} height={56} className="rounded-full" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xl font-bold text-white">
            {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">{user.name ?? "Student"}</p>
          <p className="truncate text-sm text-zinc-400">{user.email}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border-2 border-white/10 bg-white/5 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Plan</p>
        <p className="mt-1 text-lg font-semibold text-white">
          {user.plan === "PRO" ? "Pro" : "Free"}
        </p>
      </div>

      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}
