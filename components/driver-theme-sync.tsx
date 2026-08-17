"use client"

import { useEffect } from "react"
import { applyTheme, getStoredTheme } from "@/lib/driver-theme"

/**
 * Applies the saved theme on mount and keeps "system" following the OS.
 *
 * The bootstrap script in the driver layout handles the very first paint;
 * this covers the rest of the app's life — in particular the case where the
 * driver has "system" selected and Android flips to dark mode (scheduled
 * night mode, battery saver) while the APK is open. Without the listener the
 * app would stay light until it was restarted.
 */
export function DriverThemeSync() {
  useEffect(() => {
    applyTheme(getStoredTheme())

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    function onSystemChange() {
      // Only "system" defers to the OS; an explicit choice must not be
      // overridden when the phone changes mode.
      if (getStoredTheme() === "system") applyTheme("system")
    }
    media.addEventListener("change", onSystemChange)
    return () => media.removeEventListener("change", onSystemChange)
  }, [])

  return null
}
