import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IMPORTANCE_DEFAULT, IMPORTANCE_STARRED } from "@/lib/recallModel";

// The engine's store is mocked at the module boundary, as DeckExamDate's test does: what
// matters here is the value this control commits and the state it shows, not IndexedDB.
const unitImportance = vi.fn();
const setUnitImportance = vi.fn().mockResolvedValue(true);

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "student-1" } } }),
}));
vi.mock("@/lib/recallStorage", () => ({
  unitImportance: (...args: unknown[]) => unitImportance(...args),
  setUnitImportance: (...args: unknown[]) => setUnitImportance(...args),
}));
vi.mock("@/lib/haptics", () => ({ vibrateTap: () => {} }));

const { default: ConceptStar } = await import("@/components/ConceptStar");

const star = () => screen.queryByRole("button", { name: /Star this concept/ });
const starred = () => screen.queryByRole("button", { name: /Starred/ });

beforeEach(() => {
  unitImportance.mockReset();
  setUnitImportance.mockReset().mockResolvedValue(true);
});

describe("before the store has answered", () => {
  it("shows nothing rather than guessing at a state", async () => {
    // A control that renders unstarred while the read is in flight flips under the
    // student's thumb, and a tap in that window writes the value it is already at.
    unitImportance.mockReturnValue(new Promise(() => {}));
    render(<ConceptStar unitId="deck-1::c1" />);
    expect(star()).toBeNull();
    expect(starred()).toBeNull();
  });

  it("stays hidden for a concept the engine has never imported", async () => {
    unitImportance.mockResolvedValue(null);
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(unitImportance).toHaveBeenCalled());
    expect(star()).toBeNull();
  });

  it("stays hidden when the read fails", async () => {
    unitImportance.mockRejectedValue(new Error("db closed"));
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(unitImportance).toHaveBeenCalled());
    expect(star()).toBeNull();
  });
});

describe("what it offers, and what it commits", () => {
  it("offers a star on a concept sitting at the default", async () => {
    unitImportance.mockResolvedValue(IMPORTANCE_DEFAULT);
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(star()).toBeTruthy());
    // Labelled, not a bare glyph: there is no hover on the phone this ships to, so a
    // lone star cannot say whether it is state or an action.
    expect(star()!.getAttribute("aria-pressed")).toBe("false");
  });

  it("says what starring actually does", async () => {
    unitImportance.mockResolvedValue(IMPORTANCE_STARRED);
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(starred()).toBeTruthy());
    expect(starred()!.textContent).toMatch(/shown more often/);
    expect(starred()!.getAttribute("aria-pressed")).toBe("true");
  });

  it("commits the top of the range, and the unit it was given", async () => {
    unitImportance.mockResolvedValue(IMPORTANCE_DEFAULT);
    render(<ConceptStar unitId="deck-9::c7" />);
    await waitFor(() => expect(star()).toBeTruthy());
    fireEvent.click(star()!);
    expect(setUnitImportance).toHaveBeenCalledWith("student-1", "deck-9::c7", IMPORTANCE_STARRED);
  });

  it("returns to the default when unstarred, never to zero", async () => {
    // Zero is a real statement - "actively deprioritise this" - and no control in the
    // app makes it. Unstarring means "no signal", which is the midpoint.
    unitImportance.mockResolvedValue(IMPORTANCE_STARRED);
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(starred()).toBeTruthy());
    fireEvent.click(starred()!);
    expect(setUnitImportance).toHaveBeenCalledWith("student-1", "deck-1::c1", IMPORTANCE_DEFAULT);
    expect(setUnitImportance).not.toHaveBeenCalledWith("student-1", "deck-1::c1", 0);
  });

  it("flips under the thumb rather than after the write", async () => {
    // The write re-dates every memory row for the concept; a student should not watch a
    // spinner to find out whether their own tap landed.
    let release: (value: boolean) => void = () => {};
    unitImportance.mockResolvedValue(IMPORTANCE_DEFAULT);
    setUnitImportance.mockReturnValue(new Promise<boolean>((resolve) => (release = resolve)));
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(star()).toBeTruthy());
    fireEvent.click(star()!);
    expect(starred()).toBeTruthy();
    release(true);
  });

  it("puts the star back if the write fails", async () => {
    unitImportance.mockResolvedValue(IMPORTANCE_DEFAULT);
    setUnitImportance.mockRejectedValue(new Error("quota"));
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(star()).toBeTruthy());
    fireEvent.click(star()!);
    // Leaving it starred would tell the student the scheduler knows something it does not.
    await waitFor(() => expect(star()).toBeTruthy());
    expect(starred()).toBeNull();
  });

  it("ignores a second tap while the first is still writing", async () => {
    unitImportance.mockResolvedValue(IMPORTANCE_DEFAULT);
    setUnitImportance.mockReturnValue(new Promise<boolean>(() => {}));
    render(<ConceptStar unitId="deck-1::c1" />);
    await waitFor(() => expect(star()).toBeTruthy());
    fireEvent.click(star()!);
    fireEvent.click(starred()!);
    expect(setUnitImportance).toHaveBeenCalledTimes(1);
  });
});
