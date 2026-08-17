import type { Metadata, Viewport } from "next"
import { DriverShell } from "@/components/driver-shell"
import { DriverSWRegister } from "@/components/driver-sw-register"
import { DriverThemeSync } from "@/components/driver-theme-sync"
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/driver-theme"

export const metadata: Metadata = {
  title: "Sterlinglams - Driver App",
  description: "Driver mobile interface for Sterlinglams deliveries",
  manifest: "/driver/manifest.json",
}

export const viewport: Viewport = {
  themeColor: "#16a34a",
}

export default function DriverLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* Runs before paint so the first frame is already the right colour;
          DriverThemeSync then keeps it in step for the rest of the session. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <DriverThemeSync />
      <DriverSWRegister />
      <DriverShell>
        {children}
      </DriverShell>
    </>
  )
}
