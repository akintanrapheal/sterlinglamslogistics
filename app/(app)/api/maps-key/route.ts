import { NextResponse } from "next/server"
import { getServerMapsKey } from "@/lib/server/maps-key"

/**
 * Returns the Google Maps *browser* key for the client-side JS API loader.
 *
 * This endpoint is intentionally public: a Maps JavaScript API key is visible to
 * anyone who loads the map, so serving it here exposes nothing that the page
 * source would not. It must therefore be an HTTP-referrer-restricted key — never
 * put an unrestricted or server-only key in Settings → Integrations.
 */
export async function GET() {
  const key = await getServerMapsKey()

  return NextResponse.json(
    { key },
    {
      headers: {
        // Cache briefly so map loads stay fast, but a replaced key still takes
        // effect within a minute without a redeploy.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  )
}
