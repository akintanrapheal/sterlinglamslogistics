"use client"

/**
 * Driver app theme preference.
 *
 * The Display settings screen used to own this logic outright: it wrote
 * `driverTheme` to localStorage and toggled the `dark` class inline. Nothing
 * read it back at startup, so the choice survived only until the APK was
 * closed — reopening it came up light while the settings screen still showed
 * "Dark" selected, because that screen reads the stored value it just never
 * applied.
 *
 * Keeping the read, the write and the DOM effect in one place is what makes
 * the preference actually persist.
 */

export type DriverTheme = "light" | "dark" | "system"

export const THEME_KEY = "driverTheme"

export function isDriverTheme(value: unknown): value is DriverTheme {
  return value === "light" || value === "dark" || value === "system"
}

/** Stored preference, defaulting to "system" when unset or corrupt. */
export function getStoredTheme(): DriverTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return isDriverTheme(raw) ? raw : "system"
  } catch {
    // Private mode / storage disabled.
    return "system"
  }
}

export function setStoredTheme(theme: DriverTheme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

export function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** Resolve "system" against the OS setting and toggle the `dark` class. */
export function applyTheme(theme: DriverTheme): void {
  if (typeof document === "undefined") return
  const dark = theme === "dark" || (theme === "system" && prefersDark())
  document.documentElement.classList.toggle("dark", dark)
}

/**
 * Inlined into the document before paint so the first frame is already the
 * right colour. Without it the app renders light, then snaps to dark once
 * hydration runs the effect — very visible on the APK's cold start.
 *
 * Kept dependency-free and defensive: it runs before any bundle and must
 * never throw, or it would block the rest of the document.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";
var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d);
}catch(e){}})();
`.trim()
