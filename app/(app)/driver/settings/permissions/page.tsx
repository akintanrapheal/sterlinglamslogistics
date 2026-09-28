"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, BatteryCharging, Check, MapPin, X } from "lucide-react"

import { useDriver } from "@/components/driver-context"
import {
  batteryExempt,
  hapticTap,
  isNativeApp,
  onAppResume,
  openLocationSettings,
  requestBatteryExemption,
} from "@/lib/native-bridge"

/**
 * The permissions tracking depends on, and whether they are granted.
 *
 * These were only ever surfaced as banners, which appear when something is
 * already wrong and vanish once dismissed. A driver who wanted to check or
 * change one had nowhere to go, and the office had no way to talk someone
 * through it over the phone. A settings page can be visited deliberately.
 */
export default function DriverPermissionsPage() {
  const router = useRouter()
  const { nativeTracking, batteryUnrestricted } = useDriver()
  const [battery, setBattery] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      void batteryExempt().then((v) => {
        if (!cancelled) setBattery(v)
      })
    }
    check()

    // Granting means leaving for Android's settings, so the result can only
    // be observed on the way back.
    let removeResume: (() => void) | undefined
    void onAppResume(check).then((fn) => {
      if (cancelled) fn?.()
      else removeResume = fn
    })

    return () => {
      cancelled = true
      removeResume?.()
    }
  }, [])

  const batteryOk = battery ?? batteryUnrestricted

  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-background py-3">
        <button type="button" onClick={() => router.back()} className="rounded-lg p-1.5 hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Permissions</h1>
      </div>

      <p className="px-1 pb-4 text-sm text-muted-foreground">
        Dispatch can only see your vehicle while these are allowed.
      </p>

      <div className="space-y-3">
        <Row
          icon={<MapPin className="h-5 w-5" />}
          title="Location — all the time"
          body='Must be "Allow all the time", not "only while using the app", or dispatch loses you when the app is closed.'
          // Android does not expose whether background location is granted in
          // a way this page can read reliably, so no tick is claimed here —
          // stating it plainly beats showing a status that might be wrong.
          status={null}
          action="Open settings"
          onAction={() => { void hapticTap(); void openLocationSettings() }}
        />

        <Row
          icon={<BatteryCharging className="h-5 w-5" />}
          title="Unrestricted battery use"
          body="Without this, Android puts the app to sleep after a while and location updates stop — even though everything looks fine on your screen."
          status={isNativeApp() ? batteryOk : null}
          action={batteryOk ? "Change" : "Allow"}
          onAction={() => { void hapticTap(); void requestBatteryExemption() }}
        />
      </div>

      {isNativeApp() && !nativeTracking && (
        <p className="mt-6 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Location reporting is not running. Sign out and back in, and make sure
          location is allowed.
        </p>
      )}
    </div>
  )
}

function Row({
  icon,
  title,
  body,
  status,
  action,
  onAction,
}: {
  icon: React.ReactNode
  title: string
  body: string
  status: boolean | null
  action: string
  onAction: () => void
}) {
  return (
    <div className="rounded-xl border p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {status === true && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Check className="h-3 w-3" /> Allowed
              </span>
            )}
            {status === false && (
              <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                <X className="h-3 w-3" /> Blocked
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onAction}
        // Full width and h-10: pressed in a vehicle, often with gloves.
        className="mt-3 flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:opacity-90"
      >
        {action}
      </button>
    </div>
  )
}
