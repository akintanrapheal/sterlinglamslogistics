"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Clock,
  Download,
  Gauge,
  LocateFixed,
  MapPin,
  Route as RouteIcon,
  TimerOff,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth-provider"
import { Spinner } from "@/components/ui/spinner"
import { subscribeDriversRealtime } from "@/lib/firestore"
import { loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps"
import type { Driver } from "@/lib/data"
import { cn } from "@/lib/utils"

interface TrailPoint {
  lat: number
  lng: number
  t: number
  s?: number
}

interface Stop {
  lat: number
  lng: number
  from: number
  to: number
  durationMs: number
}

interface DeviceState {
  lastPingAt: number | null
  lastReportedAt: number | null
  supportsTrail: boolean
  uninstallBlocked: boolean
}

interface Summary {
  distanceKm: number
  movingMs: number
  stoppedMs: number
  avgSpeedKmh: number
  maxSpeedKmh: number
  stopCount: number
  pointCount: number
  firstSeen: number
  lastSeen: number
}

/** Local date key, matching the Lagos-based key the trail is stored under. */
function todayKey(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return "<1 min"
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })
}

export default function TrackingPage() {
  const { user } = useAuth()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driverId, setDriverId] = useState("")
  const [date, setDate] = useState(todayKey())

  const [points, setPoints] = useState<TrailPoint[]>([])
  const [stops, setStops] = useState<Stop[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [device, setDevice] = useState<DeviceState | null>(null)
  /**
   * The line to draw, which is the road-matched path when snapping succeeded.
   *
   * Separate from `points`: markers, stops and timings come from the raw
   * fixes, because snapping moves a point onto the nearest road and would
   * shift a stop away from where the driver actually waited.
   */
  const [path, setPath] = useState<google.maps.LatLngLiteral[]>([])
  /**
   * The route as separate runs, split where reporting stopped.
   *
   * Drawn instead of one continuous line: joining fixes across an outage drew
   * a straight line through whatever lay between them — across the lagoon, in
   * the case that prompted this — which reads as a journey rather than as
   * missing data.
   */
  const [segments, setSegments] = useState<google.maps.LatLngLiteral[][]>([])
  const [snapped, setSnapped] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const overlaysRef = useRef<Array<google.maps.Polyline | google.maps.Marker>>([])

  useEffect(() => {
    if (!user) return
    return subscribeDriversRealtime((d) => {
      setDrivers(d)
      // Select the first driver automatically so the page opens on something
      // rather than an empty map with a prompt.
      setDriverId((cur) => cur || d[0]?.id || "")
    })
  }, [user])

  // ── Map init. Gated on mapReady for the same reason the Routes page is:
  // the map is created behind an await, and effects that draw on it run
  // against a null ref if they don't depend on its creation.
  useEffect(() => {
    let mounted = true
    let unsubscribeAuthFailure: (() => void) | null = null

    async function init() {
      if (!mapContainerRef.current || mapRef.current) return
      try {
        await loadGoogleMaps()
      } catch (err) {
        if (mounted) setMapError(err instanceof Error ? err.message : "Google Maps failed to load.")
        return
      }
      unsubscribeAuthFailure = onGoogleMapsAuthFailure(() => {
        if (mounted) {
          setMapError(
            "Google rejected this API key. Check that billing is enabled on the Google Cloud project that owns it.",
          )
        }
      })
      if (!mounted || !mapContainerRef.current) return

      mapRef.current = new google.maps.Map(mapContainerRef.current, {
        center: { lat: 6.4653323, lng: 3.5575161 },
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      })
      setMapReady(true)
    }

    void init()
    return () => {
      mounted = false
      unsubscribeAuthFailure?.()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  const load = useCallback(async () => {
    if (!driverId) return
    setLoading(true)
    setError(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch(
        `/api/admin/driver-trail?driverId=${encodeURIComponent(driverId)}&date=${date}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      )
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load trail")
      setPoints(json.points ?? [])
      setStops(json.stops ?? [])
      setSummary(json.summary ?? null)
      setDevice(json.device ?? null)
      setPath(json.path ?? (json.points ?? []).map((p: TrailPoint) => ({ lat: p.lat, lng: p.lng })))
      setSegments(
        Array.isArray(json.segments) && json.segments.length > 0
          ? json.segments
          : [json.path ?? (json.points ?? []).map((p: TrailPoint) => ({ lat: p.lat, lng: p.lng }))],
      )
      setSnapped(Boolean(json.snapped))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this driver's history")
      setPoints([])
      setStops([])
      setSummary(null)
      setDevice(null)
      setPath([])
      setSnapped(false)
    } finally {
      setLoading(false)
    }
  }, [driverId, date])

  useEffect(() => {
    if (user && driverId) void load()
  }, [user, driverId, date, load])

  // ── Draw the trail.
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return

    for (const o of overlaysRef.current) o.setMap(null)
    overlaysRef.current = []
    if (points.length === 0 || path.length === 0) return

    // One polyline per run. The breaks between them are the point: where the
    // phone stopped reporting, the map shows nothing rather than inventing a
    // straight line across it.
    for (const segment of segments) {
      if (segment.length < 2) continue
      const line = new google.maps.Polyline({
        map,
        path: segment,
        strokeColor: "#2563eb",
        strokeOpacity: 0.85,
        strokeWeight: 4,
        // Arrows make the direction of travel readable, which matters when a
        // route doubles back on itself.
        icons: [
          {
            icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.5, strokeColor: "#1d4ed8" },
            offset: "0",
            repeat: "120px",
          },
        ],
      })
      overlaysRef.current.push(line)
    }

    const dot = (pos: google.maps.LatLngLiteral, color: string, label: string, title: string) =>
      new google.maps.Marker({
        map,
        position: pos,
        title,
        label: { text: label, color: "#fff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      })

    // Anchored on raw fixes, not the snapped line: start and end should sit
    // where the driver actually was.
    const first = { lat: points[0].lat, lng: points[0].lng }
    const last = { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng }
    overlaysRef.current.push(
      dot(first, "#16a34a", "A", `Start — ${formatTime(points[0].t)}`),
      dot(last, "#dc2626", "B", `Last seen — ${formatTime(points[points.length - 1].t)}`),
    )

    stops.forEach((s, i) => {
      overlaysRef.current.push(
        dot(
          { lat: s.lat, lng: s.lng },
          "#f59e0b",
          String(i + 1),
          `Stopped ${formatDuration(s.durationMs)} — ${formatTime(s.from)} to ${formatTime(s.to)}`,
        ),
      )
    })

    const bounds = new google.maps.LatLngBounds()
    for (const p of path) bounds.extend(p)
    map.fitBounds(bounds, 48)
  }, [mapReady, points, stops, path, segments])

  const zoomTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.panTo({ lat, lng })
    mapRef.current?.setZoom(17)
  }, [])

  const exportCsv = useCallback(() => {
    const rows = [
      ["time", "lat", "lng", "speed_kmh"],
      ...points.map((p) => [
        new Date(p.t).toISOString(),
        String(p.lat),
        String(p.lng),
        p.s != null ? (p.s * 3.6).toFixed(1) : "",
      ]),
    ]
    const csv = rows.map((r) => r.join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    const name = drivers.find((d) => d.id === driverId)?.name ?? driverId
    a.download = `trail-${name}-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [points, drivers, driverId, date])

  const driverName = useMemo(
    () => drivers.find((d) => d.id === driverId)?.name ?? "",
    [drivers, driverId],
  )

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Driver</label>
          <select
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {drivers.length === 0 && <option value="">No drivers</option>}
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Date</label>
          <input
            type="date"
            value={date}
            max={todayKey()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !driverId}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
        >
          {loading ? "Loading…" : "Reload"}
        </button>
        {points.length > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
          >
            <Download className="size-4" />
            Export CSV
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
          {[
            { icon: RouteIcon, label: "Distance", value: `${summary.distanceKm} km` },
            { icon: Clock, label: "Moving", value: formatDuration(summary.movingMs) },
            { icon: TimerOff, label: "Stopped", value: formatDuration(summary.stoppedMs) },
            { icon: Gauge, label: "Avg speed", value: `${summary.avgSpeedKmh} km/h` },
            { icon: Gauge, label: "Max speed", value: `${summary.maxSpeedKmh} km/h` },
            { icon: MapPin, label: "Stops", value: String(summary.stopCount) },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="bg-background px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="size-3.5" />
                {label}
              </div>
              <p className="mt-0.5 text-lg font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Stops timeline */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-border lg:block">
          <div className="border-b border-border p-3">
            <p className="text-sm font-semibold">
              {driverName || "Driver"} · {date}
            </p>
            {summary && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tracked {formatTime(summary.firstSeen)} – {formatTime(summary.lastSeen)} ·{" "}
                {summary.pointCount} points
                {snapped ? " · matched to roads" : " · raw GPS"}
                {segments.length > 1 && ` · ${segments.length - 1} reporting gap${segments.length > 2 ? "s" : ""}`}
              </p>
            )}
            {device?.supportsTrail && !device.uninstallBlocked && (
              // Surfaced here because this is the page where someone is
              // already asking questions about a specific driver's phone.
              <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="mt-px size-3 shrink-0" />
                App can be uninstalled on this phone — device protection is not active.
              </p>
            )}
          </div>

          {stops.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {points.length === 0
                ? "No movement recorded for this day."
                : "No stops long enough to report. A stop is 3 minutes or more in one place."}
            </p>
          ) : (
            <ul>
              {stops.map((s, i) => (
                <li key={`${s.from}-${i}`}>
                  <button
                    type="button"
                    onClick={() => zoomTo(s.lat, s.lng)}
                    className="flex w-full items-start gap-2.5 border-b border-border/60 p-3 text-left hover:bg-secondary/50"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{formatDuration(s.durationMs)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(s.from)} – {formatTime(s.to)}
                      </p>
                    </div>
                    <LocateFixed className="ml-auto mt-1 size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Map */}
        <section className="relative min-w-0 flex-1">
          <div ref={mapContainerRef} className="absolute inset-0" />

          {mapError && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-muted/95 p-6 text-center">
              <AlertTriangle className="size-7 text-warning" />
              <p className="font-semibold">Map unavailable</p>
              <p className="max-w-md text-sm text-muted-foreground">{mapError}</p>
            </div>
          )}

          {!mapError && !loading && points.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-xl border border-border bg-background/95 p-4 text-center shadow-lg">
                {/* An empty day has two very different causes and they need
                    opposite responses: ask the driver, or install the app.
                    Saying only "no movement" points at the wrong one. */}
                {device && !device.supportsTrail ? (
                  <>
                    <AlertTriangle className="mx-auto mb-2 size-6 text-amber-600" />
                    <p className="text-sm font-semibold">This phone isn&apos;t recording history</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      It has never reported location-history support, so it is running an
                      older version of the driver app. Install the current build on this
                      driver&apos;s phone and their trails will start recording.
                    </p>
                    {device.lastPingAt && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        The app is otherwise working — last seen{" "}
                        {new Date(device.lastPingAt).toLocaleString("en-NG", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        .
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <MapPin className="mx-auto mb-2 size-6 text-muted-foreground" />
                    <p className="text-sm font-semibold">No movement recorded</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This phone records history, but nothing was stored for this date —
                      the driver was signed out, or the app was not installed yet.
                    </p>
                    {device?.lastReportedAt && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Last reported{" "}
                        {new Date(device.lastReportedAt).toLocaleString("en-NG", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        .
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
              <Spinner />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
