"use client"

import { useDriver } from "@/components/driver-context"
import { hapticTap } from "@/lib/native-bridge"
import { CloudOff, Loader2, MapPinOff, RefreshCw, WifiOff } from "lucide-react"

/**
 * Connection / sync / GPS state, shown on every driver screen.
 *
 * These warnings used to live inline on the dashboard only, so a driver who
 * was mid-delivery — the exact moment a failed sync or lost GPS matters —
 * had no indication anything was wrong. Rendering from the shell instead
 * means the state follows them across screens.
 *
 * Deliberately renders nothing in the healthy case, so it costs no vertical
 * space on a phone screen unless there is something to say.
 */
export function DriverStatusBanner() {
  const { isConnected, syncing, pendingDeliveryCount, gpsError, syncPending, session } = useDriver()

  // Nothing to report, or nobody logged in to report it to.
  if (!session) return null
  const showOffline = !isConnected
  const showPending = pendingDeliveryCount > 0
  if (!showOffline && !showPending && !gpsError) return null

  async function onRetry() {
    void hapticTap()
    await syncPending()
  }

  return (
    <div
      className="sticky top-0 z-40 flex flex-col gap-px"
      // Sits under the notch when the WebView draws edge-to-edge.
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {showOffline && (
        <Banner tone="danger" icon={<WifiOff className="h-4 w-4 shrink-0" />} live="assertive">
          <span>No connection to the server. Work is being saved on this phone.</span>
        </Banner>
      )}

      {showPending && (
        <Banner
          tone="warning"
          icon={
            syncing ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <CloudOff className="h-4 w-4 shrink-0" />
            )
          }
        >
          <span className="flex-1">
            {syncing
              ? `Syncing ${pendingDeliveryCount} update${pendingDeliveryCount > 1 ? "s" : ""}…`
              : `${pendingDeliveryCount} update${pendingDeliveryCount > 1 ? "s" : ""} waiting to send`}
          </span>
          {!syncing && (
            <button
              type="button"
              onClick={onRetry}
              // h-8/px-3 keeps this above the ~44px effective tap target once
              // the banner padding is counted — it's pressed with gloves on.
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-black/20 px-3 text-xs font-semibold active:bg-black/30"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry now
            </button>
          )}
        </Banner>
      )}

      {gpsError && (
        <Banner tone="danger" icon={<MapPinOff className="h-4 w-4 shrink-0" />} live="assertive">
          <span>GPS unavailable — customers can&apos;t see your location.</span>
        </Banner>
      )}
    </div>
  )
}

function Banner({
  tone,
  icon,
  children,
  live = "polite",
}: {
  tone: "danger" | "warning"
  icon: React.ReactNode
  children: React.ReactNode
  live?: "polite" | "assertive"
}) {
  // Fixed white-on-saturated rather than theme tokens: these must read the
  // same in bright sun through a windscreen as they do at night.
  const toneClass = tone === "danger" ? "bg-red-600" : "bg-amber-600"
  return (
    <div
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live}
      className={`flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-white ${toneClass}`}
    >
      {icon}
      {children}
    </div>
  )
}
