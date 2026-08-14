import type { Metadata, Viewport } from "next"
import { DriverShell } from "@/components/driver-shell"
import "./globals.css"

/**
 * Static-export root layout for the driver-mobile-2 APK.
 *
 * This is the canonical root layout — it must provide <html> and <body>
 * because Next.js's App Router requires them at the root. build.ps1
 * SKIPS copying the main project's app/(app)/layout.tsx over this
 * file (see the SkipNames list in step 2) so the wrap-in-DriverShell
 * behaviour is preserved without losing the html/body scaffolding.
 *
 * No DriverSWRegister and no PWA manifest — both are part of the live
 * web shipping model. The APK ships its UI locally so there's nothing
 * to service-worker, and the manifest would just 404 inside the WebView.
 */

export const metadata: Metadata = {
  title: "Sterlin Driver",
  description: "Sterlin Glams Driver App",
}

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DriverShell>{children}</DriverShell>
      </body>
    </html>
  )
}
