import { describe, expect, it } from "vitest";
import {
  LAUNCH_OFFER_ENDS,
  LAUNCH_OFFER_WAS,
  launchOfferActive,
  launchOfferEndLabel,
} from "@/lib/launchOffer";

/** The whole point of this module is that the discount expires on its own. The pricing
 * page showed a struck-through "was" price permanently, with no end date and nothing
 * saying what the offer was - which is a decoration pretending to be a discount, and the
 * pattern India's 2023 CCPA dark-pattern guidance names directly. These tests assert the
 * property that keeps it honest rather than the copy. */

const DAY = 86_400_000;

describe("launchOfferActive", () => {
  it("holds before the end date", () => {
    expect(launchOfferActive(LAUNCH_OFFER_ENDS - DAY)).toBe(true);
  });

  it("stops on its own, with nobody having to remember", () => {
    expect(launchOfferActive(LAUNCH_OFFER_ENDS + 1)).toBe(false);
    expect(launchOfferActive(LAUNCH_OFFER_ENDS + DAY * 365)).toBe(false);
  });

  it("includes the final instant rather than ending a day early", () => {
    expect(launchOfferActive(LAUNCH_OFFER_ENDS)).toBe(true);
  });

  it("has an end date that is a real, future-dated instant", () => {
    // A NaN or epoch-zero constant would silently disable the offer forever, which is
    // the safe direction but not the intended one - worth knowing if it happens.
    expect(Number.isFinite(LAUNCH_OFFER_ENDS)).toBe(true);
    expect(LAUNCH_OFFER_ENDS).toBeGreaterThan(new Date(2026, 0, 1).getTime());
  });
});

describe("launchOfferEndLabel", () => {
  it("names a day and a month, and no year", () => {
    // A year on a deadline weeks away reads as a legal notice rather than urgency.
    const label = launchOfferEndLabel("en-GB");
    expect(label).toMatch(/\d/);
    expect(label).not.toMatch(/\d{4}/);
  });
});

describe("LAUNCH_OFFER_WAS", () => {
  it("carries both billing periods, so neither can render undefined", () => {
    expect(LAUNCH_OFFER_WAS.monthly).toBeTruthy();
    expect(LAUNCH_OFFER_WAS.yearly).toBeTruthy();
  });
});
