import type { CapacitorConfig } from "@capacitor/cli"

/**
 * Default to the Vercel origin, not the apex. The apex is served by
 * Hostinger, which intermittently returns its own LiteSpeed 403 ("Access to
 * this resource on the server is denied!") for minutes at a time. This
 * variant loads the entire UI over the network, so a 403 here doesn't just
 * fail an API call — it leaves the driver staring at the offline screen for
 * the duration.
 *
 * Override with DRIVER_APP_URL to point at the apex or a staging server.
 */
const baseUrl = (process.env.DRIVER_APP_URL || "https://sterlinglamslogistics.vercel.app/driver").replace(/\/$/, "")

const config: CapacitorConfig = {
  appId: "com.sterlinglams.driver",
  appName: "Sterlin Driver",
  webDir: "www",
  server: {
    url: baseUrl,
    cleartext: baseUrl.startsWith("http://"),
    allowNavigation: [
      "sterlinglamslogistics.vercel.app",
      "*.vercel.app",
      "sterlinglamslogistics.com",
      "*.sterlinglamslogistics.com",
    ],
    // When the WebView can't reach `url` (no signal at cold launch, server
    // down, etc.) Android shows its ugly net::ERR_FAILED page. errorPath
    // tells Capacitor to fall back to a local file shipped in webDir/www
    // instead — branded screen, auto-reconnect on network restore.
    errorPath: "offline.html"
  },
  android: {
    allowMixedContent: false,
    appendUserAgent: "SterlinDriverApp"
  },
  plugins: {
    Geolocation: {
      // Uses fine location for accurate driver tracking
    },
    Camera: {
      // Used for proof-of-delivery photos
    }
  }
}

export default config
