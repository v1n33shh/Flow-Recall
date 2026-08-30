import { describe, expect, it } from "vitest";
import { confirmationMatches } from "./deleteAccount";

describe("confirmationMatches", () => {
  const email = "student@example.com";

  it("accepts the address exactly", () => {
    expect(confirmationMatches(email, email)).toBe(true);
  });

  it("forgives what a phone keyboard adds by itself", () => {
    expect(confirmationMatches("  student@example.com ", email)).toBe(true);
    expect(confirmationMatches("Student@Example.com", email)).toBe(true);
  });

  it("rejects anything that is not the address", () => {
    expect(confirmationMatches("", email)).toBe(false);
    expect(confirmationMatches("student", email)).toBe(false);
    expect(confirmationMatches("student@example.co", email)).toBe(false);
    expect(confirmationMatches("other@example.com", email)).toBe(false);
  });

  // The schema allows a null email. Treating a blank expectation as satisfied
  // would reduce the gate to one tap for exactly those accounts.
  it("never matches when there is no address to confirm", () => {
    expect(confirmationMatches("", null)).toBe(false);
    expect(confirmationMatches("", undefined)).toBe(false);
    expect(confirmationMatches("anything", null)).toBe(false);
    expect(confirmationMatches("   ", "")).toBe(false);
  });
});
