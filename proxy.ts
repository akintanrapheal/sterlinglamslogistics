import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const DRIVER_APP_COOKIE = "driver_app_locked"
const PAGE_CACHE_CONTROL = "no-store, no-cache, max-age=0, must-revalidate"

// Capacitor WebView origins for the bundled driver APKs. Both
// "https://localhost" (Android default) and "capacitor://localhost"
// (iOS default) need to be allowlisted so the static-export APK can
// hit /api/driver/* cross-origin. driverFetch uses credentials:
// "include", so we must echo a specific origin (not "*") and pair it
// with Access-Control-Allow-Credentials: true.
const CAPACITOR_ORIGINS = new Set([
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
])

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !CAPACITOR_ORIGINS.has(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Driver-Token, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

/**
 * API paths the bundled APK calls cross-origin from its WebView.
 *
 * /api/driver/* is the bulk of it, but /api/maps-key sits outside that prefix
 * and was therefore served without CORS headers. The WebView blocked the
 * response, the Maps loader fell back to an empty build-time key, and Google
 * rendered a watermarked "development purposes only" map with NoApiKeys — a
 * failure that looks exactly like a billing problem and is not one.
 */
function needsCors(pathname: string): boolean {
  return pathname.startsWith("/api/driver/") || pathname === "/api/maps-key"
}

function isAssetOrApi(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  )
}

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // ── CORS for the endpoints the APK calls ───────────────────────────────
  // The bundled driver-mobile-2 APK calls these from its WebView origin
  // (https://localhost), so each call triggers CORS. Handle the preflight
  // here, and tack the response headers onto the eventual route-handler
  // reply for non-OPTIONS requests. See needsCors for which paths qualify.
  if (needsCors(pathname)) {
    const headers = corsHeaders(request.headers.get("origin"))
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers })
    }
    if (Object.keys(headers).length > 0) {
      const res = NextResponse.next()
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      return res
    }
  }

  if (isAssetOrApi(pathname)) {
    return NextResponse.next()
  }

  const isDriverPath = pathname.startsWith("/driver")
  const hasDriverLock = request.cookies.get(DRIVER_APP_COOKIE)?.value === "1"
  const shouldEnableDriverLock = isDriverPath && searchParams.get("driverApp") === "1"

  if (hasDriverLock && !isDriverPath) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/driver"
    redirectUrl.search = ""
    const response = NextResponse.redirect(redirectUrl)
    response.headers.set("Cache-Control", PAGE_CACHE_CONTROL)
    return response
  }

  if (shouldEnableDriverLock) {
    const response = NextResponse.next()
    response.headers.set("Cache-Control", PAGE_CACHE_CONTROL)
    response.cookies.set({
      name: DRIVER_APP_COOKIE,
      value: "1",
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
    })
    return response
  }

  const response = NextResponse.next()
  response.headers.set("Cache-Control", PAGE_CACHE_CONTROL)
  return response
}

export const config = {
  matcher: ["/:path*"],
}
