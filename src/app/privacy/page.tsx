import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy - FlowRecall",
  description: "How FlowRecall collects, uses, and protects your data.",
};

const LAST_UPDATED = "August 31, 2026";
const CONTACT_EMAIL = "founder@flowrecall.app";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        FlowRecall (&quot;we&quot;, &quot;us&quot;) turns your notes into AI-generated flashcards
        for active-recall study. This page explains what data we collect when you use the app,
        why we collect it, who we share it with, and how you can control it.
      </p>

      <Section title="Information we collect">
        <p>
          <strong className="text-foreground">Account information.</strong> If you sign in with
          Google, we receive your name, email address, and profile picture. If you register with
          email and password instead, we store your email and a bcrypt-hashed version of your
          password - we never store or have access to your actual password.
        </p>
        <p>
          <strong className="text-foreground">Usage and gamification data.</strong> We store your
          subscription plan, study streak, the dates you studied, and usage counters (like how
          many decks or AI definitions you&apos;ve generated this month) so features like
          streaks, quotas, and Pro entitlements work correctly.
        </p>
        <p>
          <strong className="text-foreground">Payment information.</strong> If you upgrade to Pro,
          your payment is handled entirely by Razorpay or Stripe. We never see or store your card
          or bank details - we only store a billing reference id and your subscription status so
          we know your plan is active.
        </p>
        <p>
          <strong className="text-foreground">Your notes and flashcards.</strong> When you paste
          notes or upload a PDF, that text is sent to an AI provider (see below) to generate
          flashcards or definitions, and is not permanently stored on our servers afterward. The
          decks and flashcards you actually study are saved in your browser&apos;s local storage,
          on your own device - not in our database.
        </p>
      </Section>

      <Section title="How we use your information">
        <p>
          We use this information to run the app: to sign you in, generate flashcards from your
          material, enforce Free/Pro usage limits, process payments, track your study streak, and
          respond if you contact us for support.
        </p>
        <p>We do not sell your data, and we do not use it for advertising.</p>
      </Section>

      <Section title="Who we share it with">
        <p>
          We rely on a small number of service providers to run FlowRecall, and each only receives
          what it needs to do its job:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong className="text-foreground">Google</strong> - for signing in with your Google
            account.
          </li>
          <li>
            <strong className="text-foreground">Groq, OpenAI, and Anthropic</strong> - process the
            text you submit to generate flashcards and definitions.
          </li>
          <li>
            <strong className="text-foreground">Razorpay and Stripe</strong> - process Pro plan
            payments.
          </li>
          <li>
            <strong className="text-foreground">Supabase</strong> - hosts our database, where
            your account and usage data above is stored.
          </li>
          <li>
            <strong className="text-foreground">Vercel</strong> - hosts the app itself and its
            server functions.
          </li>
        </ul>
        <p>
          As the developer of FlowRecall, we can access this data through Supabase&apos;s and
          Vercel&apos;s administrative dashboards, in the same way any app operator can access
          their own service&apos;s data. We only do so to operate, maintain, and troubleshoot the
          app.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use a single, essential session cookie to keep you signed in. We don&apos;t use
          advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Data retention and deletion">
        <p>
          We keep your account data for as long as your account is active. You can delete it
          yourself at any time, without asking us: open{" "}
          <Link href="/account" className="text-foreground underline underline-offset-2">
            Account
          </Link>{" "}
          and choose <strong className="font-semibold text-foreground">Delete Account</strong>
          {" "}under Danger Zone. You&apos;ll be asked to type your email address to confirm,
          because it cannot be undone.
        </p>
        <p className="mt-3">
          Deleting your account removes your profile, email address, streak history and usage
          counters from our database immediately, and cancels any active subscription with our
          payment provider first, so you are never charged for an account that no longer exists.
          It also erases everything the app has stored on the device you delete from: your saved
          decks and their progress, and any books, highlights and reading positions in the
          reader. That local data never reaches our servers in the first place, so deleting it is
          the only copy there is.
        </p>
        <p className="mt-3">
          If you would rather we did it for you, or you can no longer sign in, email us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline underline-offset-2">
            {CONTACT_EMAIL}
          </a>{" "}
          from the address on your account and we&apos;ll remove it.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use industry-standard practices to protect your data, including encrypted
          connections (HTTPS) for all traffic and bcrypt password hashing. No method of storage or
          transmission is 100% secure, but we work to protect your information appropriately.
        </p>
      </Section>

      <Section title="Children's privacy">
        <p>
          FlowRecall is not directed at children under 13, and we do not knowingly collect
          personal information from children under 13. If you believe a child has provided us
          personal information, contact us and we&apos;ll delete it.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we make material changes to this policy, we&apos;ll update the date at the top of
          this page. Continued use of FlowRecall after a change means you accept the updated
          policy.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about this policy or your data? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline underline-offset-2">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
