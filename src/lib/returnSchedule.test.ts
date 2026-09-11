import { describe, expect, it } from "vitest";
import { formatInterval, returnSchedule } from "@/lib/returnSchedule";

// A fixed local afternoon, so "tomorrow" is unambiguous and the tests do not shift
// meaning depending on the hour they run at.
const NOW = new Date(2026, 2, 10, 14, 30).getTime();
const at = (dayOffset: number, hour = 12) =>
  new Date(2026, 2, 10 + dayOffset, hour).getTime();

describe("returnSchedule", () => {
  it("reports nothing for an empty set rather than zeroes that look like a schedule", () => {
    const s = returnSchedule([], NOW);
    expect(s.total).toBe(0);
    expect(s.furthestDays).toBeNull();
  });

  it("buckets by calendar day, not by elapsed hours", () => {
    const s = returnSchedule(
      [
        at(0, 23), // later tonight
        at(1, 1), // 1am tomorrow - only ~10 hours away, but it is tomorrow
        at(1, 20),
        at(3),
        at(30),
      ],
      NOW,
    );
    expect(s.today).toBe(1);
    expect(s.tomorrow).toBe(2);
    expect(s.thisWeek).toBe(1);
    expect(s.later).toBe(1);
    expect(s.total).toBe(5);
  });

  it("counts an overdue card as due today, not as a negative", () => {
    const s = returnSchedule([at(-5), at(-1)], NOW);
    expect(s.today).toBe(2);
    expect(s.furthestDays).toBe(0);
  });

  it("puts the week boundary at seven days past tomorrow", () => {
    // Day 7 is still "this week"; day 8 has moved on.
    expect(returnSchedule([at(7)], NOW).thisWeek).toBe(1);
    expect(returnSchedule([at(8)], NOW).later).toBe(1);
  });

  it("reports the furthest gap in whole calendar days", () => {
    expect(returnSchedule([at(2), at(9)], NOW).furthestDays).toBe(9);
  });

  it("ignores a due date that is not a number rather than poisoning the totals", () => {
    // dueAt is arithmetic over stability, and a NaN stability upstream would otherwise
    // make every count NaN and render "NaN concepts come back tomorrow".
    const s = returnSchedule([at(1), Number.NaN, Infinity], NOW);
    expect(s.total).toBe(1);
    expect(s.tomorrow).toBe(1);
    expect(Number.isFinite(s.furthestDays as number)).toBe(true);
  });
});

describe("formatInterval", () => {
  // The real span the scheduler produces: ~5 hours after a lapse, 2.3 days after a
  // first correct answer, 175 days on a well-established concept.
  it("uses hours below a day, which is where a lapsed card lands", () => {
    expect(formatInterval(5 / 24)).toBe("in about 5 hours");
    expect(formatInterval(1 / 24)).toBe("in about an hour");
  });

  it("says tomorrow rather than 'in 1 days'", () => {
    expect(formatInterval(1)).toBe("tomorrow");
    expect(formatInterval(1.2)).toBe("tomorrow");
  });

  it("counts days up to a fortnight", () => {
    expect(formatInterval(2.3)).toBe("in 2 days");
    expect(formatInterval(12)).toBe("in 12 days");
  });

  it("switches to weeks, then months, so a long gap stays readable", () => {
    expect(formatInterval(50)).toBe("in 7 weeks");
    expect(formatInterval(30)).toBe("in 4 weeks");
    expect(formatInterval(175)).toBe("in 6 months");
  });

  it("never renders a negative or a NaN interval at a student", () => {
    expect(formatInterval(-3)).toBe("soon");
    expect(formatInterval(Number.NaN)).toBe("soon");
  });
});
