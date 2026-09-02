import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** The learning record's durability, as one route.
 *
 * Push what this device has changed, pull what any other device changed, and let
 * the client recompute scheduler state from the merged review log. The merge rules
 * themselves are pure and live in src/lib/recallSync.ts (planSync); this file is
 * only the boundary: auth, validation, epoch-ms ⇄ DateTime, and batching.
 *
 * Every write is scoped to the session's own user id. Ids come from the device -
 * that is deliberate, since a deck exists on the phone before it exists here - but
 * the OWNER never does: rows are written with the session's user id, and the upsert
 * matches on (id, userId), so a payload naming a deck that belongs to someone else
 * fails loudly on the primary key rather than quietly overwriting their row.
 *
 * Idempotent by construction: the two append-only logs use createMany with
 * skipDuplicates, and decks and units upsert by primary key. Re-sending the same
 * push (a retry after a dropped connection, or the deliberate re-send window in
 * PUSH_SAFETY_MS) changes nothing. */

// One page of pulled rows. Sized well under Vercel's ~4.5 MB response ceiling
// with decks in mind: reviews are tiny, but a deck carries every concept's full
// explanation, so a few hundred of them is the realistic limit rather than a few
// thousand. The client loops while `more` is true, asking again from `nextSince`.
//
// Named per collection rather than derived inline at each findMany, because the
// truncation check below has to compare each page's length against the exact take
// that produced it. Reading `PAGE * 5` in one place and `PAGE * 25` in another is
// how `more` came to speak for decks alone.
const PAGE = 200;
const DECK_PAGE = PAGE;
const UNIT_PAGE = PAGE * 5;
const REVIEW_PAGE = PAGE * 25;
const ASK_PAGE = PAGE * 5;
const TEACH_BACK_PAGE = PAGE * 5;

const timestamp = z.number().int().nonnegative();

const deckSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(500),
  concepts: z.array(z.unknown()),
  pendingChunks: z.array(z.string()).optional(),
  model: z.string().max(100).optional(),
  createdAt: timestamp,
  updatedAt: timestamp.optional(),
  deletedAt: timestamp.optional(),
  // Shape-checked but not relation-checked: `validateEdges` on the client is what
  // decides an edge is real, and it needs the deck's own concepts to do it. The
  // server has no better view, so it stores what it is given rather than pretending
  // to arbitrate.
  conceptMap: z
    .array(z.object({ from: z.string().max(200), to: z.string().max(200), relation: z.string().max(40) }))
    .max(400)
    .optional(),
  /** Local midnight of the exam day. Optional, and absent means no exam - which
   * is not the same as an exam in the past, so it must stay distinguishable. */
  examDate: timestamp.optional(),
});

const unitSchema = z.object({
  id: z.string().min(1).max(400),
  sourceDeckId: z.string().min(1).max(200),
  label: z.string().max(500),
  importance: z.number().min(0).max(1),
  concept: z.unknown(),
  createdAt: timestamp,
  updatedAt: timestamp.optional(),
});

const reviewSchema = z.object({
  id: z.string().min(1).max(100),
  unitId: z.string().min(1).max(400),
  path: z.string().max(20),
  reviewedAt: timestamp,
  grade: z.number().int().min(1).max(4),
  correct: z.boolean(),
  latencyMs: z.number().int().min(0),
  credited: z.boolean(),
  elapsedDays: z.number().min(0),
  stabilityBefore: z.number().nullable().optional(),
  stabilityAfter: z.number(),
  confidence: z.string().max(20).optional(),
  couplingOnSuccess: z.number(),
  couplingOnLapse: z.number(),
});

const askSchema = z.object({
  id: z.string().min(1).max(100),
  unitId: z.string().min(1).max(400),
  question: z.string().max(2000),
  answer: z.string().max(8000),
  beyondMaterial: z.boolean(),
  askedAt: timestamp,
});

/** An attempt at explaining a concept, and the three lists that came back.
 *
 * `attempt` is capped at the same 1200 the route that produces it accepts, and each
 * list entry at the same 300 - a payload claiming more than the producing route can
 * emit did not come from it. */
const teachBackSchema = z.object({
  id: z.string().min(1).max(100),
  unitId: z.string().min(1).max(400),
  attempt: z.string().max(1200),
  correct: z.array(z.string().max(300)).max(6),
  missing: z.array(z.string().max(300)).max(6),
  wrong: z.array(z.string().max(300)).max(6),
  attemptedAt: timestamp,
});

const requestSchema = z.object({
  since: timestamp.nullable().default(null),
  /** False for the push-only requests a chunked first sync sends. Running the four
   * pull queries on every chunk would cost an index scan each to return rows the
   * client discards - only the last request's page is kept. Defaults true so an
   * older client that does not send it behaves exactly as before. */
  pull: z.boolean().default(true),
  decks: z.array(deckSchema).max(500).default([]),
  units: z.array(unitSchema).max(5000).default([]),
  reviews: z.array(reviewSchema).max(5000).default([]),
  asks: z.array(askSchema).max(1000).default([]),
  /** Defaults to empty, so a client built before teach-backs existed keeps syncing
   * exactly as it did. */
  teachBacks: z.array(teachBackSchema).max(500).default([]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to sync." }, { status: 401 });
  }
  const userId = session.user.id;

  // A JWT outlives the row it names (src/auth.ts keeps a token valid when the
  // lookup finds nothing), so a token held across account deletion would
  // otherwise write rows for a user that no longer exists - and every one of
  // those writes would fail on the foreign key anyway. Same guard /api/ingest
  // and /api/study/track already apply.
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) {
    return Response.json({ error: "You must be signed in to sync." }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid sync payload." },
      { status: 400 },
    );
  }
  const { since, pull, decks, units, reviews, asks, teachBacks } = parsed.data;

  // Taken before the writes, and returned as the client's next cursor. Taking it
  // after would open a window in which another device's push is timestamped
  // before the cursor and never pulled.
  const now = Date.now();

  try {
    await prisma.$transaction([
      ...decks.map((deck) =>
        prisma.deck.upsert({
          where: { id_userId: { id: deck.id, userId } },
          create: {
            id: deck.id,
            userId,
            title: deck.title,
            concepts: deck.concepts as object[],
            pendingChunks: deck.pendingChunks ?? Prisma.DbNull,
            model: deck.model ?? null,
            createdAt: new Date(deck.createdAt),
            updatedAt: new Date(deck.updatedAt ?? deck.createdAt),
            deletedAt: deck.deletedAt === undefined ? null : new Date(deck.deletedAt),
            conceptMap: deck.conceptMap ?? Prisma.DbNull,
            examDate: deck.examDate === undefined ? null : new Date(deck.examDate),
          },
          update: {
            title: deck.title,
            concepts: deck.concepts as object[],
            // Prisma reads `undefined` as "leave this column alone", so `?? undefined`
            // made a cleared field unclearable: once a deck's pendingChunks were
            // consumed locally the server kept the stale array forever, and the next
            // device to pull that deck was re-offered "Generate Next Section" for text
            // it had already generated. `DbNull` writes the SQL NULL the row means.
            pendingChunks: deck.pendingChunks ?? Prisma.DbNull,
            model: deck.model ?? null,
            updatedAt: new Date(deck.updatedAt ?? deck.createdAt),
            deletedAt: deck.deletedAt === undefined ? null : new Date(deck.deletedAt),
            // Same DbNull reasoning as pendingChunks above: a deck whose map was
            // cleared - by a delete's tombstone - has to be able to clear it here.
            conceptMap: deck.conceptMap ?? Prisma.DbNull,
            // Explicit null rather than `?? undefined` for the same reason: clearing
            // an exam date has to reach the server, or the paper stays on the
            // calendar forever on every other device.
            examDate: deck.examDate === undefined ? null : new Date(deck.examDate),
          },
        }),
      ),
      ...units.map((unit) =>
        prisma.knowledgeUnit.upsert({
          where: { id_userId: { id: unit.id, userId } },
          create: {
            id: unit.id,
            userId,
            sourceDeckId: unit.sourceDeckId,
            label: unit.label,
            importance: unit.importance,
            concept: unit.concept as object,
            createdAt: new Date(unit.createdAt),
            updatedAt: new Date(unit.updatedAt ?? unit.createdAt),
          },
          update: {
            label: unit.label,
            importance: unit.importance,
            concept: unit.concept as object,
            updatedAt: new Date(unit.updatedAt ?? unit.createdAt),
          },
        }),
      ),
      // Append-only, so a duplicate is not a conflict to resolve - it is the same
      // row arriving twice, and skipping it is the whole answer.
      prisma.reviewRecord.createMany({
        skipDuplicates: true,
        data: reviews.map((review) => ({
          ...review,
          userId,
          reviewedAt: new Date(review.reviewedAt),
          stabilityBefore: review.stabilityBefore ?? null,
        })),
      }),
      prisma.askRecord.createMany({
        skipDuplicates: true,
        data: asks.map((ask) => ({ ...ask, userId, askedAt: new Date(ask.askedAt) })),
      }),
      // Immutable like a review: a second attempt at the same concept is a new row,
      // so an id arriving twice is the same row twice and skipping it is the answer.
      prisma.teachBackRecord.createMany({
        skipDuplicates: true,
        data: teachBacks.map((row) => ({
          ...row,
          userId,
          attemptedAt: new Date(row.attemptedAt),
        })),
      }),
    ]);
  } catch (error) {
    console.error("sync push failed", error);
    return Response.json({ error: "Could not save your progress. It will retry." }, { status: 500 });
  }

  const page = pull ? await pullPage(userId, since === null ? new Date(0) : new Date(since)) : null;
  const remoteDecks = page?.decks ?? [];
  const remoteUnits = page?.units ?? [];
  const remoteReviews = page?.reviews ?? [];
  const remoteAsks = page?.asks ?? [];
  const remoteTeachBacks = page?.teachBacks ?? [];

  // A collection whose page came back exactly as long as its own take has rows
  // after it that this response does not carry. `more` used to be
  // `remoteDecks.length === PAGE` alone, so a truncated units, reviews or asks
  // page was invisible - and since the client advanced its cursor past it
  // regardless, invisible meant gone: every later pull filters on
  // `updatedAt > cursor`, so those rows could never be asked for again.
  const boundaries: number[] = [];
  if (remoteDecks.length === DECK_PAGE) {
    boundaries.push(remoteDecks[remoteDecks.length - 1].updatedAt.getTime());
  }
  if (remoteUnits.length === UNIT_PAGE) {
    boundaries.push(remoteUnits[remoteUnits.length - 1].updatedAt.getTime());
  }
  if (remoteReviews.length === REVIEW_PAGE) {
    boundaries.push(remoteReviews[remoteReviews.length - 1].reviewedAt.getTime());
  }
  if (remoteAsks.length === ASK_PAGE) {
    boundaries.push(remoteAsks[remoteAsks.length - 1].askedAt.getTime());
  }
  if (remoteTeachBacks.length === TEACH_BACK_PAGE) {
    boundaries.push(remoteTeachBacks[remoteTeachBacks.length - 1].attemptedAt.getTime());
  }
  const more = boundaries.length > 0;

  // What the client asks with next, decided here rather than there because only
  // this side knows which collections were cut off. A complete pull hands back
  // `now`, which is the cursor the client stores. A truncated one hands back the
  // EARLIEST boundary among the collections that were cut, so the next page starts
  // before anything this one missed - re-sending rows the client already holds,
  // which its own merge discards, rather than skipping rows it does not.
  //
  // A push-only request hands the cursor straight back unchanged. It pulled
  // nothing, so it is not evidence of being up to date, and a client that stored
  // this value anyway would still lose no rows.
  const nextSince = !pull ? (since ?? 0) : more ? Math.min(...boundaries) : now;

  return Response.json({
    now,
    decks: remoteDecks.map((deck) => ({
      id: deck.id,
      title: deck.title,
      concepts: deck.concepts,
      pendingChunks: deck.pendingChunks ?? undefined,
      conceptMap: deck.conceptMap ?? undefined,
      examDate: deck.examDate ? deck.examDate.getTime() : undefined,
      model: deck.model ?? undefined,
      createdAt: deck.createdAt.getTime(),
      updatedAt: deck.updatedAt.getTime(),
      deletedAt: deck.deletedAt ? deck.deletedAt.getTime() : undefined,
    })),
    units: remoteUnits.map((unit) => ({
      id: unit.id,
      userId,
      sourceDeckId: unit.sourceDeckId,
      label: unit.label,
      importance: unit.importance,
      concept: unit.concept,
      createdAt: unit.createdAt.getTime(),
      updatedAt: unit.updatedAt.getTime(),
    })),
    reviews: remoteReviews.map((review) => ({
      ...review,
      reviewedAt: review.reviewedAt.getTime(),
      confidence: review.confidence ?? undefined,
    })),
    asks: remoteAsks.map((ask) => ({ ...ask, askedAt: ask.askedAt.getTime() })),
    teachBacks: remoteTeachBacks.map((row) => ({
      ...row,
      attemptedAt: row.attemptedAt.getTime(),
    })),
    // The client loops until this is false, asking again from `nextSince`.
    more,
    nextSince,
  });
}

/** One page of everything another device may have changed since `after`.
 *
 * Extracted from POST so the push-only path can skip it by not calling it, rather
 * than by passing a take of zero or discarding the result - four index scans per
 * chunk of a chunked first push is a real cost on a route that already writes up
 * to several thousand rows. */
async function pullPage(userId: string, after: Date) {
  const [decks, units, reviews, asks, teachBacks] = await Promise.all([
    prisma.deck.findMany({
      where: { userId, updatedAt: { gt: after } },
      orderBy: { updatedAt: "asc" },
      take: DECK_PAGE,
    }),
    prisma.knowledgeUnit.findMany({
      where: { userId, updatedAt: { gt: after } },
      orderBy: { updatedAt: "asc" },
      take: UNIT_PAGE,
    }),
    prisma.reviewRecord.findMany({
      where: { userId, reviewedAt: { gt: after } },
      orderBy: { reviewedAt: "asc" },
      take: REVIEW_PAGE,
    }),
    prisma.askRecord.findMany({
      where: { userId, askedAt: { gt: after } },
      orderBy: { askedAt: "asc" },
      take: ASK_PAGE,
    }),
    prisma.teachBackRecord.findMany({
      where: { userId, attemptedAt: { gt: after } },
      orderBy: { attemptedAt: "asc" },
      take: TEACH_BACK_PAGE,
    }),
  ]);
  return { decks, units, reviews, asks, teachBacks };
}
