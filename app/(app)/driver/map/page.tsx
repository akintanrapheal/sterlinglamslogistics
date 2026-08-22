"use client"

import { useEffect, useState, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Menu, List, MapPin, MapPinOff, Navigation, Phone } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useDriver } from "@/components/driver-context"
import type { Order } from "@/lib/data"
import { cn } from "@/lib/utils"
import { loadGoogleMaps, geocodeAddress } from "@/lib/google-maps"
import { parseFirestoreDate } from "@/lib/order-utils"
import { getHubCoordinates } from "@/lib/geocode"
import { buildNavUrl, getNavApp } from "@/lib/nav"

export default function DriverMapPage() {
  const router = useRouter()
  const { session, driver, orders, isOnline, loadingSession, setDrawerOpen, refreshOrders, liveGps } = useDriver()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const driverMarkerRef = useRef<google.maps.Marker | null>(null)
  const hubMarkerRef = useRef<google.maps.Marker | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

  // Redirect if no session
  useEffect(() => {
    if (!loadingSession && !session) {
      router.replace("/driver")
    }
  }, [loadingSession, session, router])

  const activeOrders = useMemo(() => {
    if (!isOnline) return []
    return orders
      .filter(
        (o) => o.status === "started" || o.status === "picked-up" || o.status === "in-transit"
      )
      .sort((a, b) => {
        const aTime = parseFirestoreDate(a.startedAt)?.getTime() ?? 0
        const bTime = parseFirestoreDate(b.startedAt)?.getTime() ?? 0
        return aTime - bTime
      })
  }, [orders, isOnline])

  // Stable key so effect only reruns when order list actually changes
  const ordersKey = useMemo(
    () => activeOrders.map((o) => `${o.id}:${o.status}`).join(","),
    [activeOrders]
  )

  // Poll for new orders every 15 seconds
  useEffect(() => {
    if (!session || !isOnline) return
    const interval = setInterval(() => refreshOrders(), 15000)
    return () => clearInterval(interval)
  }, [session, isOnline, refreshOrders])

  // Initialize Google Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    let cancelled = false

    async function initMap() {
      try {
        await loadGoogleMaps()
      } catch (err) {
        // Same guard as the admin Routes page: an unusable key should leave a
        // readable message on the map panel, not throw out of an effect.
        if (!cancelled) {
          setMapError(err instanceof Error ? err.message : "Google Maps failed to load.")
        }
        return
      }
      if (cancelled || !mapContainerRef.current) return

      // Shared helper, not a local literal. This screen used to carry its own
      // fallback of 6.4541,3.4347 — Lagos Island — while every other caller
      // and lib/geocode.ts's DEFAULT_HUB_COORDS use 6.4642667,3.5554814, the
      // actual Ikota/Ajah store. Since build.ps1 doesn't set NEXT_PUBLIC_HUB_*,
      // the APK always hit that fallback and drew the store ~20km from where
      // it is, on the wrong side of the city.
      const { lat: hubLat, lng: hubLng } = getHubCoordinates()

      // mapId enables Google Maps' vector renderer, which is what lets
      // two-finger rotate / tilt work on the default roadmap (raster maps
      // can only rotate in satellite view). Set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
      // to a Map ID from Google Cloud Console to enable rotation everywhere.
      // Without it, the rotate control still appears but only affects satellite.
      const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID

      const map = new google.maps.Map(mapContainerRef.current!, {
        ...(mapId ? { mapId } : {}),
        center: { lat: hubLat, lng: hubLng },
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        rotateControl: true,
        gestureHandling: "greedy",
        // Two-finger rotate and tilt are only honoured on a vector map, which
        // requires mapId above. On a raster map these are ignored and the
        // rotate control affects satellite view only. headingInteractionEnabled
        // and tiltInteractionEnabled must be opted into explicitly — a vector
        // map alone still ignores the gestures without them.
        ...(mapId
          ? {
              headingInteractionEnabled: true,
              tiltInteractionEnabled: true,
            }
          : {}),
        // Styles are ignored when mapId is set (Cloud-based styling takes over)
        ...(mapId ? {} : {
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "poi.park", stylers: [{ visibility: "simplified" }] },
            { featureType: "transit", stylers: [{ visibility: "simplified" }] },
          ],
        }),
      })

      // Store / Hub marker — green circle with white storefront icon,
      // matching driver-app's hubMarker style.
      const hubSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%2316a34a" stroke="white" stroke-width="2"/><svg x="7" y="7" width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M21.9 8.89l-1.05-4.37c-.22-.9-1-1.52-1.91-1.52H5.05c-.9 0-1.69.63-1.9 1.52L2.1 8.89c-.24 1.02-.02 2.06.62 2.88.08.11.19.19.28.29V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6.94c.09-.09.2-.18.28-.28.64-.82.87-1.87.62-2.89zm-2.99-3.9l1.05 4.37c.1.42.01.84-.25 1.17-.14.18-.44.47-.94.47-.61 0-1.18-.51-1.25-1.17L16.93 5l1.98-.01zM13 5h1.96l.54 4.52c.05.39-.07.78-.33 1.07-.22.26-.54.41-.95.41-.67 0-1.22-.58-1.22-1.29V5zM8.49 9.52L9.04 5H11v4.71c0 .71-.55 1.29-1.29 1.29-.34 0-.65-.15-.89-.41-.25-.29-.37-.68-.33-1.07zm-4.39-.16L5.05 5h1.98l-.58 4.86c-.08.66-.64 1.17-1.25 1.17-.49 0-.8-.29-.93-.47-.27-.32-.36-.75-.27-1.16zM5 19v-6.03c.08.01.15.03.23.03.87 0 1.66-.36 2.24-.95.6.6 1.4.95 2.31.95.87 0 1.65-.36 2.23-.93.59.57 1.39.93 2.29.93.84 0 1.64-.35 2.24-.95.58.59 1.37.95 2.24.95.08 0 .15-.02.23-.03V19H5z"/></svg></svg>`
      hubMarkerRef.current = new google.maps.Marker({
        map,
        position: { lat: hubLat, lng: hubLng },
        title: "Sterlin Glams Store",
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(hubSvg)}`,
          scaledSize: new google.maps.Size(32, 32),
          anchor: new google.maps.Point(16, 16),
        },
      })

      mapRef.current = map
      setMapReady(true)
    }

    initMap()

    return () => {
      cancelled = true
    }
  }, [])

  // Update ORDER markers only when orders change (not on GPS updates)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    let cancelled = false

    async function updateOrderMarkers() {
      const map = mapRef.current!

      // Clear old order markers
      for (const m of markersRef.current) {
        m.setMap(null)
      }
      markersRef.current = []

      const orderMeta: Array<{ order: Order; num: number; time: string }> = []

      for (let i = 0; i < activeOrders.length; i++) {
        if (cancelled) return
        const order = activeOrders[i]
        const num = i + 1

        const ts = order.startedAt ?? order.createdAt
        let timeStr = ""
        if (ts) {
          const d = ts instanceof Date ? ts : new Date(ts as string)
          if (!Number.isNaN(d.getTime())) {
            timeStr = d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase()
          }
        }

        const coords = await geocodeAddress(order.address)
        if (!coords || cancelled) continue

        const markerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38"><circle cx="19" cy="19" r="17" fill="%23222222" stroke="white" stroke-width="2"/><text x="19" y="24" text-anchor="middle" fill="white" font-size="15" font-weight="bold" font-family="sans-serif">${num}</text></svg>`

        const marker = new google.maps.Marker({
          map,
          position: coords,
          title: `${order.orderNumber} - ${order.customerName}`,
          icon: {
            url: `data:image/svg+xml;charset=UTF-8,${markerSvg}`,
            scaledSize: new google.maps.Size(38, 38),
            anchor: new google.maps.Point(19, 19),
          },
        })

        orderMeta.push({ order, num, time: timeStr })
        const meta = orderMeta[orderMeta.length - 1]
        marker.addListener("click", () =>
          setSelectedOrder({ ...meta.order, _mapNum: meta.num, _mapTime: meta.time } as Order & { _mapNum: number; _mapTime: string })
        )
        markersRef.current.push(marker)
      }
    }

    updateOrderMarkers()

    return () => {
      cancelled = true
    }
  }, [mapReady, ordersKey, isOnline])

  // Prefer local GPS position (instant) over Firestore lastLocation (delayed)
  const driverPos = liveGps ?? driver?.lastLocation ?? null

  // Update DRIVER location marker independently — smoothly animate to new position
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    if (!driverPos) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setMap(null)
        driverMarkerRef.current = null
      }
      return
    }

    const newPos = { lat: driverPos.lat, lng: driverPos.lng }

    if (driverMarkerRef.current) {
      // Smoothly animate to the new position
      const start = driverMarkerRef.current.getPosition()!
      const end = new google.maps.LatLng(newPos.lat, newPos.lng)
      const steps = 30
      const duration = 1000 // 1 second
      const stepMs = duration / steps
      let step = 0
      const animate = () => {
        step++
        const t = step / steps
        const lat = start.lat() + (end.lat() - start.lat()) * t
        const lng = start.lng() + (end.lng() - start.lng()) * t
        driverMarkerRef.current?.setPosition({ lat, lng })
        if (step < steps) setTimeout(animate, stepMs)
      }
      animate()
    } else {
      // First time — create the marker. Style matches Google Maps' built-in
      // "you are here" blue dot: a soft accuracy halo, a thick white ring,
      // and a solid blue dot in the middle (Google's brand blue #4285f4).
      const driverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="%234285f4" fill-opacity="0.18"/><circle cx="24" cy="24" r="10" fill="white"/><circle cx="24" cy="24" r="8" fill="%234285f4"/></svg>`
      driverMarkerRef.current = new google.maps.Marker({
        map: mapRef.current,
        position: newPos,
        title: "Your location",
        zIndex: 1000,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(driverSvg)}`,
          scaledSize: new google.maps.Size(48, 48),
          anchor: new google.maps.Point(24, 24),
        },
      })
      // Auto-center map on the driver's actual position when first GPS fix arrives
      mapRef.current?.panTo(newPos)
      mapRef.current?.setZoom(15)
    }
  }, [mapReady, driverPos?.lat, driverPos?.lng])

  if (loadingSession || !session) return null

  return (
    <div className="relative h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="absolute inset-x-0 top-0 z-[20] flex items-center justify-between bg-background/90 backdrop-blur px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-1.5 hover:bg-muted"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Map</h1>
        </div>
        <button
          type="button"
          onClick={() => router.push("/driver/dashboard")}
          className="rounded-lg p-1.5 hover:bg-muted"
        >
          <List className="h-5 w-5" />
        </button>
      </div>

      {/* Map */}
      <div ref={mapContainerRef} className="h-full w-full" />

      {mapError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
          <MapPinOff className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">Map unavailable</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Your deliveries are still listed under Orders. Ask dispatch to check the
            Google Maps key.
          </p>
        </div>
      )}

      {/* My location button */}
      {driverPos && (
        <button
          type="button"
          onClick={() => {
            if (mapRef.current && driverPos) {
              mapRef.current.panTo({ lat: driverPos.lat, lng: driverPos.lng })
              mapRef.current.setZoom(15)
            }
          }}
          className="absolute bottom-24 right-4 z-[20] flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-lg border"
        >
          <Navigation className="h-5 w-5 text-blue-600" />
        </button>
      )}

      {/* Order detail bottom sheet */}
      {selectedOrder && (() => {
        const sel = selectedOrder as Order & { _mapNum?: number; _mapTime?: string }
        const statusLabel = sel.status === "started" ? "Started" : sel.status === "picked-up" ? "Picked Up" : "In Transit"
        const statusColor = sel.status === "started" ? "bg-orange-100 text-orange-700 border-orange-200" : sel.status === "picked-up" ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-yellow-100 text-yellow-700 border-yellow-200"
        return (
          <div className="absolute inset-x-0 bottom-0 z-[20] animate-in slide-in-from-bottom-4">
            <div className="mx-3 mb-2 rounded-2xl border bg-background p-4 shadow-2xl">
              <div className="mb-3 flex justify-center">
                <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              </div>

              {/* Status + Nav/Phone */}
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="outline" className={cn("text-xs font-semibold", statusColor)}>
                  {statusLabel}
                </Badge>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      window.open(buildNavUrl(sel.address, getNavApp()), "_blank", "noopener")
                    }}
                    className="rounded-lg p-1.5 hover:bg-muted"
                  >
                    <Navigation className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { window.location.href = `tel:${sel.phone}` }}
                    className="rounded-lg p-1.5 hover:bg-muted"
                  >
                    <Phone className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Order number */}
              <p className="text-sm text-muted-foreground">#{sel.orderNumber}</p>

              {/* Customer + marker + time */}
              <div className="mt-2 flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{sel.customerName}{sel._mapNum ? ` (#${sel._mapNum})` : ""}</p>
                  <p className="text-sm text-muted-foreground">{sel.address}</p>
                </div>
                {sel._mapTime && (
                  <span className="shrink-0 text-sm font-medium text-muted-foreground">{sel._mapTime}</span>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
