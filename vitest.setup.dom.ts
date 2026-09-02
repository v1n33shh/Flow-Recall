import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount between tests. Without this, testing-library's queries search a document
// that still holds every previously rendered tree, so a passing assertion can be
// reading the last test's output - the failure mode that makes a component suite
// worth less than no suite at all.
afterEach(() => {
  cleanup();
});

// One gotcha worth knowing before writing the next test here: a raw
// `node.click()` fires React's handler but does NOT flush the re-render, so an
// assertion on the resulting DOM reads the tree from before the state update and
// fails in a way that looks like a component bug. Use testing-library's
// `fireEvent`, which wraps the dispatch in `act()`. The same applies to a manual
// `dispatchEvent` on a controlled input.
