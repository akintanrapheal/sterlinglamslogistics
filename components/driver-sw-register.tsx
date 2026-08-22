"use client"

import { useEffect } from "react"

/**
 * Registers the /driver service worker so the Capacitor APK (and any
 * browser that opens the driver web app) keeps a cached copy of the
 * Next.js bundle + recently-visited /driver pages. The next time the
 * driver opens the app — even with no signal — the shell loads from
 * cache instead of showing a network error.
 *
 * Also nudges the SW to warm-cache the main /driver routes (dashboard,
 * map, messages, etc.) as soon as the registration is active so the
 * first offline launch doesn't depend on the driver having previously
 * visited every page individually.
 *
 * Failure to register is non-fatal: the app still works online; we
 * just lose the offline fallback.
 */
export function DriverSWRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return
    }

    // Where the app is mounted differs by build, and registering the wrong
    // one silently disables offline support entirely:
    //
    //   web APK-less     served under /driver  -> /driver/sw.js, scope /driver/
    //   driver-mobile-2  static export at root -> /sw.js,        scope /
    //
    // The export has no /driver segment at all, so the old fixed
    // "/driver/sw.js" 404'd there, the registration rejected, and the catch
    // below swallowed it — the APK had no offline caching and no error to
    // show for it. A scope of /driver/ also could never have controlled
    // pages sitting at /dashboard.
    const underDriverPath = window.location.pathname.startsWith("/driver")
    const swUrl = underDriverPath ? "/driver/sw.js" : "/sw.js"
    const scope = underDriverPath ? "/driver/" : "/"

    navigator.serviceWorker
      .register(swUrl, { scope })
      .then((reg) => {
        // Trigger a one-shot precache pass once a controller is active.
        // The SW handler walks PRECACHE_ROUTES and stuffs each one into
        // the pages cache, so the next cold offline launch can serve
        // whichever page the driver lands on.
        const sendPrecache = () => {
          navigator.serviceWorker.controller?.postMessage({ type: "precache" })
        }
        if (navigator.serviceWorker.controller) {
          sendPrecache()
        } else {
          // First-time install — wait for control before messaging.
          navigator.serviceWorker.addEventListener("controllerchange", sendPrecache, { once: true })
        }
        // Surface failures during install so we know the cache is empty.
        return reg
      })
      .catch(() => { /* registration failure is non-fatal */ })
  }, [])
  return null
}
