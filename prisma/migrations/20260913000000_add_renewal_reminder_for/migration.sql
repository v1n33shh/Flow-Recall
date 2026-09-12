-- Idempotency key for the daily renewal-reminder cron.
-- Nullable with no default and no backfill: every existing row reads NULL, which the
-- cron treats as "never reminded", so the first run after deploy is the first reminder
-- rather than a silent skip. Adding a nullable column is not a rewrite in Postgres,
-- so this is safe to apply to a live table.
ALTER TABLE "User" ADD COLUMN "renewalReminderFor" TIMESTAMP(3);
