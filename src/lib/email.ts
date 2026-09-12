import { Resend } from "resend";

/** The one place this project sends email from.
 *
 * IT FAILS SOFT, EVERYWHERE, ON PURPOSE. Every function here returns a result rather
 * than throwing, and an unconfigured provider is a `skipped`, not an error. The only
 * caller today is the renewal-reminder cron, and the worst outcome for that job is not
 * "an email did not send" - it is "the cron threw on user #3 and the remaining 200
 * subscribers were never processed at all". A send that fails must cost exactly one
 * reminder.
 *
 * NO KEY IS A VALID STATE. Local development, CI, the Capacitor export and any fork
 * of this repo all run without RESEND_API_KEY, and none of them should crash or send
 * real mail to real people. `isEmailConfigured()` lets a caller branch, and `sendEmail`
 * degrades to a no-op rather than constructing a client with an empty key.
 *
 * THE CLIENT IS BUILT LAZILY. `new Resend(key)` at module scope would run during the
 * static export build (scripts/build-capacitor.mjs), where no key exists - the same
 * class of build-time failure the CSP and API-route handling in this repo already work
 * around. Built per call instead; these are low-volume jobs, not a hot path.
 */

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; reason: string };

/** The verified sender. Resend rejects anything on an unverified domain, so this is
 * a real configuration step and not a cosmetic default - hence no fallback value that
 * would fail at send time with a confusing provider error. */
function fromAddress(): string | null {
  return process.env.RESEND_FROM_EMAIL || null;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && fromAddress());
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = fromAddress();

  if (!apiKey || !from) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY or RESEND_FROM_EMAIL unset" };
  }

  try {
    const { data, error } = await new Resend(apiKey).emails.send({
      from,
      to: input.to,
      subject: input.subject,
      // Plain text only. A renewal notice is four lines and a link; an HTML template
      // would be a second thing to maintain, a deliverability variable, and a way to
      // land in Promotions. Plain text from a verified domain is the most likely of
      // any format to reach an inbox.
      text: input.text,
    });

    if (error) return { ok: false, skipped: false, reason: error.message ?? "send failed" };
    return { ok: true, id: data?.id ?? null };
  } catch (error) {
    return { ok: false, skipped: false, reason: error instanceof Error ? error.message : "send threw" };
  }
}
