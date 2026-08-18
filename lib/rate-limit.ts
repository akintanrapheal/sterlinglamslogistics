import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { createLogger } from "@/lib/logger"

const log = createLogger("rate-limit")

let ratelimit: Ratelimit | null = null
let driverLocationRatelimit: Ratelimit | null = null
let driverApiRatelimit: Ratelimit | null = null

function getRateLimiter() {
  if (ratelimit) return ratelimit

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      log.error("Upstash Redis not configured in production — rate limiting will reject requests")
    } else {
      log.warn("Upstash Redis not configured — rate limiting disabled in development")
    }
    return null
  }

  ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    analytics: true,
  })

  return ratelimit
}

/**
 * Separate limiter for driver location pings — 30 req/min per driver.
 * GPS fires every 5 s = 12 req/min per driver. 30 gives comfortable headroom
 * without sharing an IP bucket across multiple drivers on the same network.
 */
function getDriverLocationLimiter() {
  if (driverLocationRatelimit) return driverLocationRatelimit

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  driverLocationRatelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(30, "60 s"),
    analytics: true,
  })

  return driverLocationRatelimit
}

/**
 * Limiter for authenticated driver API calls, keyed per driver.
 *
 * These endpoints previously shared the generic 20 req/60 s IP bucket, which
 * an ordinary shift exceeded on its own: the app polls /profile every 10 s
 * (6/min) before the driver touches anything, then adds order fetches, order
 * detail views and a status write per delivery step. Worse, drivers on
 * mobile carriers share a NAT IP, so two or three working at once drained
 * the shared bucket on background polling alone and all of them started
 * getting 429s mid-delivery.
 *
 * 120/min per driver leaves generous headroom for the poll plus bursts on
 * app resume, while still bounding a single compromised token. Because the
 * bucket is per driver, one busy driver can no longer starve another.
 */
function getDriverApiLimiter() {
  if (driverApiRatelimit) return driverApiRatelimit

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  driverApiRatelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(120, "60 s"),
    analytics: true,
  })

  return driverApiRatelimit
}

/**
 * Rate limit an authenticated driver API call. Call this *after* the session
 * has been verified, so the bucket is keyed on the driver rather than an IP
 * that may be shared by a whole carrier NAT.
 */
export async function checkDriverApiRateLimit(driverId: string): Promise<NextResponse | null> {
  const limiter = getDriverApiLimiter()
  if (!limiter) return null

  try {
    const result = await limiter.limit(getDriverRateLimitIdentifier(driverId))
    if (!result.success) {
      log.warn({ driverId, remaining: result.remaining }, "Driver API rate limit exceeded")
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(result.reset),
          },
        },
      )
    }
    return null
  } catch (err) {
    log.error({ err }, "Driver API rate limit check failed — allowing request")
    return null
  }
}

/**
 * Check rate limit for an identifier (e.g. IP address).
 * Returns null if allowed, or a NextResponse(429) if rate-limited.
 * If Upstash is not configured, always allows through.
 */
export async function checkRateLimit(
  identifier: string,
): Promise<NextResponse | null> {
  const limiter = getRateLimiter()
  if (!limiter) {
    // Rate limiter not configured — allow through
    return null
  }

  try {
    const result = await limiter.limit(identifier)
    if (!result.success) {
      log.warn({ identifier, remaining: result.remaining }, "Rate limit exceeded")
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(result.reset),
          },
        },
      )
    }
    return null
  } catch (err) {
    log.error({ err }, "Rate limit check failed — allowing request")
    return null
  }
}

/**
 * Extract a usable identifier from a request for rate limiting.
 */
export function getRateLimitIdentifier(req: Request): string {
  // Prefer platform-provided client IP headers before generic X-Forwarded-For.
  // This reduces spoofing risk when requests pass through trusted proxies/CDNs.
  const candidate =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-vercel-forwarded-for") ??
    req.headers.get("x-forwarded-for") ??
    ""

  const ip = candidate.split(",")[0]?.trim() || "unknown"
  return ip
}

/**
 * Rate limit identifier for authenticated driver endpoints.
 * Uses the verified driverId so each driver gets their own bucket regardless
 * of shared IP (e.g. multiple drivers behind the same NAT or dispatching hub).
 */
export function getDriverRateLimitIdentifier(driverId: string): string {
  return `driver:${driverId}`
}

/**
 * Rate limit specifically for driver location pings.
 * Uses a per-driver bucket (not IP) so multiple drivers on the same
 * network don't block each other. 30 req/min allows GPS every 5 s
 * with headroom for bursts on app resume.
 */
export async function checkDriverLocationRateLimit(driverId: string): Promise<NextResponse | null> {
  const limiter = getDriverLocationLimiter()
  if (!limiter) return null

  try {
    const result = await limiter.limit(`loc:${driverId}`)
    if (!result.success) {
      log.warn({ driverId, remaining: result.remaining }, "Driver location rate limit exceeded")
      return NextResponse.json(
        { ok: false, error: "Too many location updates." },
        { status: 429 },
      )
    }
    return null
  } catch (err) {
    log.error({ err }, "Driver location rate limit check failed — allowing")
    return null
  }
}
