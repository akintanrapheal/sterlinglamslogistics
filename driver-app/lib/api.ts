import { getToken, clearSession } from "./storage"
import { router } from "expo-router"

/**
 * API origin for the driver app.
 *
 * Points at Vercel rather than the apex domain. The apex is served by
 * Hostinger, which intermittently returns its own LiteSpeed 403 ("Access to
 * this resource on the server is denied!") for minutes at a time — long
 * enough to block a driver mid-round. Vercel serves the same app without
 * that edge in front of it.
 *
 * Exported so every call site shares one origin; the login and location
 * calls used to hardcode the apex separately and would have been missed.
 */
export const API_BASE = "https://sterlinglamslogistics.vercel.app"

const BASE = API_BASE
const TIMEOUT_MS = 12_000

let _redirecting = false
// In-memory token cache — avoids SecureStore read on every request
let _tokenCache: string | null = null

export function clearTokenCache() {
  _tokenCache = null
}

export async function driverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Read from cache; only hit SecureStore when cache is empty
  if (_tokenCache === null) {
    _tokenCache = await getToken()
  }
  const token = _tokenCache
  const headers = new Headers(init.headers ?? {})
  if (token) headers.set("X-Driver-Token", token)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401 && !_redirecting) {
    _redirecting = true
    _tokenCache = null // invalidate cache on auth failure
    await clearSession()
    router.replace("/")
    setTimeout(() => { _redirecting = false }, 3000)
  }

  return response
}

export async function fetchDriverOrders(driverId: string): Promise<import("./types").Order[]> {
  const res = await driverFetch(`/api/driver/orders?driverId=${encodeURIComponent(driverId)}`)
  if (!res.ok) return []
  const data = await res.json() as { orders?: import("./types").Order[] }
  return data.orders ?? []
}
