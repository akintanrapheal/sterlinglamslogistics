/**
 * Safe wrappers around Capacitor plugins (Haptics, StatusBar, App).
 *
 * IMPORTANT: We access the plugins via the runtime-injected
 * `window.Capacitor.Plugins.*` global instead of npm-importing the
 * `@capacitor/*` packages. That global is injected automatically by
 * Capacitor inside the driver-mobile APK WebView; in a regular browser
 * it's `undefined` and every call here cleanly no-ops.
 *
 * Why not `import()` the packages?
 *   - The Next.js web build (Vercel / Turbopack) tries to resolve every
 *     dynamic import specifier at build time. If the plugin packages
 *     are only listed in driver-mobile/package.json (not in the root
 *     web package.json), the build fails with "Module not found".
 *   - Using the runtime global keeps the web bundle small AND avoids
 *     adding native-only npm deps to the web project.
 */

type ImpactStyle = "light" | "medium" | "heavy"

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  Plugins?: {
    Haptics?: {
      impact: (opts: { style: string }) => Promise<void>
      notification: (opts: { type: string }) => Promise<void>
    }
    StatusBar?: {
      setBackgroundColor: (opts: { color: string }) => Promise<void>
      setStyle: (opts: { style: string }) => Promise<void>
      setOverlaysWebView: (opts: { overlay: boolean }) => Promise<void>
    }
    App?: {
      addListener: (
        event: string,
        cb: () => void | Promise<void>,
      ) => Promise<{ remove: () => Promise<void> }>
      exitApp: () => Promise<void>
    }
  }
}

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null
}

/** Brief tactile bump on button presses. */
export async function hapticTap(style: ImpactStyle = "light"): Promise<void> {
  const haptics = getCapacitor()?.Plugins?.Haptics
  if (!haptics) return
  const map: Record<ImpactStyle, string> = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" }
  try { await haptics.impact({ style: map[style] }) } catch { /* ignore */ }
}

/** Distinct success notification pattern — use on "delivered" etc. */
export async function hapticSuccess(): Promise<void> {
  const haptics = getCapacitor()?.Plugins?.Haptics
  if (!haptics) return
  try { await haptics.notification({ type: "SUCCESS" }) } catch { /* ignore */ }
}

/** Distinct error notification pattern — use on failed actions. */
export async function hapticError(): Promise<void> {
  const haptics = getCapacitor()?.Plugins?.Haptics
  if (!haptics) return
  try { await haptics.notification({ type: "ERROR" }) } catch { /* ignore */ }
}

/**
 * Set the Android status bar colour + foreground style.
 *
 * `lightIcons` describes the *icons*, which is the thing callers actually
 * reason about. Capacitor's own enum is named for the background it suits —
 * Style.Dark means "light text, for dark backgrounds" — and the previous
 * signature exposed that inversion as a `dark` flag, so passing a white
 * background with `dark: true` produced white icons on white and made the
 * battery and signal indicators invisible.
 */
export async function applyStatusBar(opts: {
  backgroundColor: string
  lightIcons?: boolean
}): Promise<void> {
  const statusBar = getCapacitor()?.Plugins?.StatusBar
  if (!statusBar) return
  try {
    await statusBar.setBackgroundColor({ color: opts.backgroundColor })
    await statusBar.setStyle({ style: opts.lightIcons ? "DARK" : "LIGHT" })
    await statusBar.setOverlaysWebView({ overlay: false })
  } catch { /* ignore */ }
}

/**
 * Wire the Android hardware back button. Returns an unsubscribe fn.
 * Caller's handler returns true if it handled the press; if false the
 * default behaviour kicks in (history.back, or app exit when stack
 * is empty).
 */
export async function onAndroidBack(handler: () => boolean | Promise<boolean>): Promise<() => void> {
  const app = getCapacitor()?.Plugins?.App
  if (!app) return () => {}
  try {
    const listener = await app.addListener("backButton", async () => {
      const handled = await handler()
      if (!handled) {
        if (typeof window !== "undefined" && window.history.length > 1) {
          window.history.back()
        } else {
          await app.exitApp()
        }
      }
    })
    return () => { void listener.remove() }
  } catch {
    return () => {}
  }
}

/** True when running inside a Capacitor WebView (driver-mobile APK). */
export function isNativeApp(): boolean {
  return Boolean(getCapacitor()?.isNativePlatform?.())
}
