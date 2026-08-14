import type { CapacitorConfig } from "@capacitor/cli"

/**
 * driver-mobile-2 — full offline-first variant.
 *
 * Differences from driver-mobile:
 *   - No `server.url`. The WebView loads www/ from local APK assets at
 *     cold start, so no network is required for the shell to render.
 *   - Different appId so this APK installs side-by-side with the
 *     original driver-mobile during A/B testing on the same device.
 *
 * The bundled app calls the API origin baked in at build time by
 * build.ps1 (-ApiBase, default https://sterlinglamslogistics.vercel.app)
 * for data — only the UI is local. allowNavigation keeps the WebView
 * permitted to talk to the real API origin.
 *
 * Both the Vercel origin and the apex domain are allowlisted so flipping
 * -ApiBase between them needs no change here. The Vercel origin is the
 * default because the apex is fronted by Cloudflare, which intermittently
 * 403s this app's requests (custom UA below trips its bot rules).
 */
const config: CapacitorConfig = {
  appId: "com.sterlinglams.driver2",
  appName: "Sterlin Driver 2",
  webDir: "www",
  server: {
    androidScheme: "https",
    allowNavigation: [
      "sterlinglamslogistics.vercel.app",
      "*.vercel.app",
      "sterlinglamslogistics.com",
      "*.sterlinglamslogistics.com"
    ]
  },
  android: {
    allowMixedContent: false,
    appendUserAgent: "SterlinDriverApp2"
  },
  plugins: {
    Geolocation: {},
    Camera: {}
  }
}

export default config
