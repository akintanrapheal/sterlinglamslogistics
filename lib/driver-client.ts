"use client"

const TOKEN_KEY = "driverToken"
let _redirectingToLogin = false

/**
 * Optional absolute origin to prefix API calls with. Same-origin builds
 * (sterlinglamslogistics.com) leave this empty and use relative paths.
 * Static-export builds (driver-mobile-2 APK, where the UI runs from
 * local files and there's no same-origin API) set
 * NEXT_PUBLIC_API_BASE_URL=https://sterlinglamslogistics.com at build
 * time so /api/driver/* calls reach the live server.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "")

/**
 * Absolute URL for an API path, for callers that use plain fetch rather than
 * driverFetch. In a same-origin web build this returns the path untouched; in
 * the static-export APK it prefixes the baked-in origin.
 *
 * Exported because any relative "/api/..." fetch outside this module silently
 * breaks inside the APK — the WebView origin (https://localhost) serves the
 * bundled UI and nothing else, so the request 404s rather than erroring
 * obviously.
 */
export function apiUrl(path: string): string {
  if (!API_BASE || !path.startsWith("/")) return path
  return `${API_BASE}${path}`
}

function resolveUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!API_BASE) return input
  if (typeof input === "string") {
    if (input.startsWith("/")) return `${API_BASE}${input}`
    return input
  }
  return input
}

export function setDriverToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

export function getDriverToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function clearDriverToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

/**
 * fetch wrapper that attaches the driver session token as `X-Driver-Token`
 * (cookies cover web; the header covers Capacitor WebView clients where
 * cookies may not roundtrip reliably).
 *
 * On a 401 response the session is cleared and the driver is redirected to
 * the login page so they never see a broken UI with silent auth failures.
 */
export async function driverFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getDriverToken()
  const headers = new Headers(init.headers ?? {})
  if (token && !headers.has("X-Driver-Token")) {
    headers.set("X-Driver-Token", token)
  }
  const response = await fetch(resolveUrl(input), { ...init, headers, credentials: "include" })
  if (response.status === 401 && !_redirectingToLogin) {
    _redirectingToLogin = true
    clearDriverToken()
    try { localStorage.removeItem("driverSession") } catch { /* ignore */ }
    // Use relative path in same-origin builds; in the static-export APK
    // there's no /driver route on the API origin — go back to index.html
    window.location.replace(API_BASE ? "./" : "/driver")
  }
  return response
}
