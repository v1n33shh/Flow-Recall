const STORAGE_KEY = "flowrecall-theme";

export type Theme = "dark" | "light";

/** Applies the saved (or default "dark") theme to <html> as data-theme.
 *  Called once at native startup (see NativeAppClass.tsx) so the preference
 *  survives a cold app relaunch instead of always resetting to dark. */
export function applyStoredTheme() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  document.documentElement.setAttribute("data-theme", stored === "light" ? "light" : "dark");
}

export function getTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}
