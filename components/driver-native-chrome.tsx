"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { applyStatusBar, onAndroidBack } from "@/lib/native-bridge"
import { useDriver } from "@/components/driver-context"

/**
 * Native chrome wiring for the driver Capacitor APK.
 *
 * - Styles the Android status bar to match the app theme (green on light).
 * - Intercepts the Android hardware back button so it:
 *     1. closes the left drawer if open, otherwise
 *     2. falls back to web history (the shim handles app-exit when stack
 *        is empty).
 *
 * Pure no-op in a regular browser (the native-bridge shim's try/catch
 * around the dynamic plugin imports never resolves to the real plugin).
 */
export function DriverNativeChrome() {
  const router = useRouter()
  const { drawerOpen, setDrawerOpen } = useDriver()

  // Status bar — follow the app theme so the bar blends into the background
  // instead of sitting on top of it as a slab of the wrong colour.
  //
  // This was pinned to #ffffff and applied once on mount, so in dark mode a
  // white strip sat above a near-black app. It also asked for light icons on
  // that white background, which rendered the battery and signal indicators
  // white-on-white — invisible rather than merely mismatched.
  //
  // Re-runs whenever the `dark` class on <html> changes, which covers the
  // driver switching theme in Settings and the OS flipping night mode while
  // "System Default" is selected.
  useEffect(() => {
    function syncStatusBar() {
      const isDark = document.documentElement.classList.contains("dark")
      void applyStatusBar({
        // Matches --background in app/globals.css for each theme.
        backgroundColor: isDark ? "#121212" : "#ffffff",
        lightIcons: isDark,
      })
    }

    syncStatusBar()
    const observer = new MutationObserver(syncStatusBar)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  // Android hardware back button. Re-register when drawerOpen flips so the
  // closure sees the current value.
  useEffect(() => {
    let unsub: (() => void) | null = null

    void onAndroidBack(() => {
      if (drawerOpen) {
        setDrawerOpen(false)
        return true // handled — don't pop history
      }
      // Let the shim's default handling kick in (history.back or app exit)
      return false
    }).then((u) => { unsub = u })

    return () => { unsub?.() }
  }, [drawerOpen, setDrawerOpen, router])

  return null
}
