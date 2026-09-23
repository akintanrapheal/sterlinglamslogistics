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
    BackgroundGeolocation?: {
      addWatcher: (
        opts: {
          backgroundMessage?: string
          backgroundTitle?: string
          requestPermissions?: boolean
          stale?: boolean
          distanceFilter?: number
        },
        cb: (
          position?: { latitude: number; longitude: number; accuracy?: number; speed?: number },
          error?: { code?: string; message?: string },
        ) => void,
      ) => Promise<string>
      removeWatcher: (opts: { id: string }) => Promise<void>
      openSettings: () => Promise<void>
    }
    DeviceAdmin?: {
      status: () => Promise<{
        isAdmin: boolean
        deviceOwner: boolean
        uninstallBlocked: boolean
        adminDisabledAt: number
      }>
      requestAdmin: () => Promise<{ alreadyActive: boolean }>
      clearDisabledFlag: () => Promise<void>
      openSecuritySettings: () => Promise<void>
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

/**
 * Run a callback when the Android app returns to the foreground.
 *
 * visibilitychange alone isn't enough inside a Capacitor WebView — Android
 * can suspend the whole process, and the page may be restored without the
 * document ever reporting a visibility transition. Returns an unsubscribe fn;
 * a no-op outside the APK.
 */
export async function onAppResume(handler: () => void): Promise<() => void> {
  const app = getCapacitor()?.Plugins?.App
  if (!app) return () => {}
  try {
    const listener = await app.addListener("resume", handler)
    return () => { void listener.remove() }
  } catch {
    return () => {}
  }
}

export interface BackgroundLocationFix {
  latitude: number
  longitude: number
  accuracy?: number
  /** Metres per second, when the device reports it. */
  speed?: number
}

/**
 * Track location while the app is backgrounded.
 *
 * The WebView's navigator.geolocation is suspended as soon as Android
 * backgrounds the app, so a driver who switched apps or locked their phone
 * disappeared from dispatch's map while still driving. This runs in a
 * foreground service instead, which keeps reporting until it is stopped.
 *
 * Android requires a permanent notification for that service; backgroundTitle
 * and backgroundMessage are what the driver sees in their shade, so they say
 * plainly why it is running.
 *
 * Returns a stop function, or null when there is no plugin — in a browser, or
 * if the APK was built without it. Callers must keep their existing
 * foreground watchPosition for that case rather than relying on this.
 */
export async function startBackgroundLocation(
  onFix: (fix: BackgroundLocationFix) => void,
  onError?: (message: string, permissionDenied: boolean) => void,
): Promise<null | (() => void)> {
  const plugin = getCapacitor()?.Plugins?.BackgroundGeolocation
  if (!plugin) return null

  try {
    const id = await plugin.addWatcher(
      {
        backgroundTitle: "Vehicle location is being recorded",
        // Wording matters: tracking now runs whenever the driver is signed
        // in, not only during a shift, so a notification promising "while you
        // are online" would misdescribe it. Signing out is what stops it, and
        // this says so.
        backgroundMessage: "Recorded while you are signed in. Sign out to stop.",
        requestPermissions: true,
        // Deliver the last known fix immediately rather than waiting for the
        // first new one, so the map isn't blank right after going online.
        stale: false,
        // Metres of movement before a new fix is reported. Sitting in traffic
        // shouldn't drain the battery or spend Firestore writes.
        distanceFilter: 25,
      },
      (position, error) => {
        if (error) {
          // NOT_AUTHORIZED means the driver declined, or granted only
          // "while using the app" — which Android treats as no background
          // permission at all.
          onError?.(error.message ?? "Location error", error.code === "NOT_AUTHORIZED")
          return
        }
        if (position) onFix(position)
      },
    )
    return () => { void plugin.removeWatcher({ id }).catch(() => { /* already gone */ }) }
  } catch (err) {
    onError?.(err instanceof Error ? err.message : "Could not start background location", false)
    return null
  }
}

/** Open the app's system settings, where "Allow all the time" is granted. */
export async function openLocationSettings(): Promise<void> {
  try { await getCapacitor()?.Plugins?.BackgroundGeolocation?.openSettings() } catch { /* ignore */ }
}

export interface DeviceProtectionStatus {
  /** Holds device-admin rights, so Android refuses to uninstall the app. */
  isAdmin: boolean
  /** Fully managed device — the only state where removal is truly blocked. */
  deviceOwner: boolean
  /** Either of the above: uninstall cannot be completed as things stand. */
  uninstallBlocked: boolean
  /**
   * When admin rights were last revoked, epoch ms, or 0.
   *
   * Recorded on the device because revocation is exactly the moment someone
   * is about to remove the app, and there may be no network at the time.
   * Reported on the next successful sync instead of being lost.
   */
  adminDisabledAt: number
}

/**
 * Whether this device is protected against the app being uninstalled.
 *
 * Returns null outside the APK, where the question is meaningless.
 */
export async function getDeviceProtection(): Promise<DeviceProtectionStatus | null> {
  const plugin = getCapacitor()?.Plugins?.DeviceAdmin
  if (!plugin) return null
  try {
    return await plugin.status()
  } catch {
    return null
  }
}

/**
 * Ask the driver to grant device-admin rights.
 *
 * Android owns the confirmation screen and it cannot be bypassed, so this
 * only opens it; the driver still has to agree. Resolves as soon as the
 * screen is shown, not when they decide — poll getDeviceProtection to learn
 * the outcome.
 */
export async function requestDeviceAdmin(): Promise<boolean> {
  const plugin = getCapacitor()?.Plugins?.DeviceAdmin
  if (!plugin) return false
  try {
    const r = await plugin.requestAdmin()
    return Boolean(r?.alreadyActive)
  } catch {
    return false
  }
}

/** Clear the stored revocation marker once the office has been told. */
export async function clearDeviceAdminFlag(): Promise<void> {
  try { await getCapacitor()?.Plugins?.DeviceAdmin?.clearDisabledFlag() } catch { /* ignore */ }
}

/** True when running inside a Capacitor WebView (driver-mobile APK). */
export function isNativeApp(): boolean {
  return Boolean(getCapacitor()?.isNativePlatform?.())
}
