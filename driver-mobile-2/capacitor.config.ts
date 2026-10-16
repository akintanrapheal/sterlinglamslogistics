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
 * build.ps1 (-ApiBase, default https://sterlinglamslogistics.com) for data —
 * only the UI is local. allowNavigation keeps the WebView permitted to talk
 * to the real API origin.
 *
 * The apex is the default again now that hosting has moved to Netlify. The
 * Vercel origin stays allowlisted so a build can be pointed back at it
 * without touching this file — useful if the apex ever misbehaves, which is
 * why the default moved away from it in the first place.
 */
const config: CapacitorConfig = {
  // Must match applicationId in android/app/build.gradle — cap sync does not
  // rewrite that once the Android project is scaffolded, so a mismatch is
  // silent: the APK installs under build.gradle's id while this file claims
  // another. It read "com.sterlinglams.driver2" while every build actually
  // installed as "com.sterlinglams.driver", which made it look like the old
  // app was still in use when it had in fact been replaced.
  //
  // Kept on the original id deliberately, now that driver-mobile has been
  // removed and this is the only driver app: existing installs upgrade in
  // place and drivers keep their session and any queued deliveries.
  appId: "com.sterlinglams.driver",
  appName: "Sterlin Driver",
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
