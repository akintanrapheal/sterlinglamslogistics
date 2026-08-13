import { adminDb } from "./firebase-admin"

/**
 * Resolves the active Google Maps API key.
 *
 * Priority: the key saved in Admin → Settings → Integrations, falling back to
 * the NEXT_PUBLIC_GOOGLE_MAPS_KEY build-time env var. The settings value wins so
 * a broken key can be swapped from the dashboard without a redeploy — changing
 * the env var requires rebuilding, because NEXT_PUBLIC_* is inlined at build.
 */

const SETTINGS_DOC = "integrationSettings"

/** Short TTL: long enough to avoid a Firestore read per geocode, short enough
 *  that a key replaced in the dashboard takes effect within a minute. */
const CACHE_TTL_MS = 60_000

let cached: { key: string; at: number } | null = null

function envKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""
}

export async function getServerMapsKey(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.key

  let key = envKey()

  try {
    const snap = await adminDb.collection("settings").doc(SETTINGS_DOC).get()
    const fromSettings = snap.exists ? (snap.data()?.googleMapsKey as unknown) : undefined
    if (typeof fromSettings === "string" && fromSettings.trim()) {
      key = fromSettings.trim()
    }
  } catch {
    // Firestore unreachable — fall back to the env key rather than losing maps.
  }

  cached = { key, at: Date.now() }
  return key
}

/** Drops the cache so the next read picks up a just-saved key immediately. */
export function invalidateMapsKeyCache(): void {
  cached = null
}
