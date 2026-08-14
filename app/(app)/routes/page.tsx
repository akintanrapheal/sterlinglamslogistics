"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner"
import {
  Search,
  Wifi,
  WifiOff,
  Copy,
  Maximize2,
  Minimize2,
  Layers,
  LocateFixed,
  ChevronUp,
  ChevronDown,
  Check,
} from "lucide-react"
import { subscribeDriversRealtime, subscribeOrdersRealtime } from "@/lib/firestore"
import { loadGoogleMaps } from "@/lib/google-maps"
import { useAuth } from "@/components/auth-provider"
import type { Driver, Order } from "@/lib/data"

type LatLng = { lat: number; lng: number }

const LAGOS_CENTER: LatLng = { lat: 6.5244, lng: 3.3792 }

const HUB: LatLng = {
  lat: Number(process.env.NEXT_PUBLIC_HUB_LAT) || 6.4642667,
  lng: Number(process.env.NEXT_PUBLIC_HUB_LNG) || 3.5554814,
}

export default function RoutesPage() {
  const { user } = useAuth()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [orderCoords, setOrderCoords] = useState<Record<string, LatLng>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [mobileView, setMobileView] = useState<"map" | "list">("map")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null)
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap")
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const firstOrdersLoadedRef = useRef(false)
  const firstDriversLoadedRef = useRef(false)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const orderMarkersRef = useRef<google.maps.Marker[]>([])
  const driverMarkersMapRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const driverAnimFramesRef = useRef<Map<string, number>>(new Map())
  const hubMarkerRef = useRef<google.maps.Marker | null>(null)
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null)
  const orderInfoWindowRef = useRef<google.maps.InfoWindow | null>(null)

  useEffect(() => {
    if (!user) return

    const unsubscribeOrders = subscribeOrdersRealtime((orderData) => {
      setOrders(orderData)
      firstOrdersLoadedRef.current = true
      if (firstDriversLoadedRef.current) setIsLoading(false)
    })

    const unsubscribeDrivers = subscribeDriversRealtime((driverData) => {
      setDrivers(driverData)
      firstDriversLoadedRef.current = true
      if (firstOrdersLoadedRef.current) setIsLoading(false)
    })

    return () => {
      unsubscribeOrders()
      unsubscribeDrivers()
    }
  }, [user])

  const visibleOrders = useMemo(
    () => orders.filter((o) => o.status !== "delivered" && o.status !== "cancelled"),
    [orders]
  )

  const activeDrivers = useMemo(
    () => drivers.filter((d) => d.status !== "offline" && d.lastLocation),
    [drivers]
  )

  // All non-offline drivers — shown in sidebar even if GPS hasn't landed yet
  const onlineDrivers = useMemo(
    () => drivers.filter((d) => d.status !== "offline"),
    [drivers]
  )

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    let result = visibleOrders

    // Status filter chip
    if (statusFilter === "unassigned") result = result.filter((o) => !o.assignedDriver)
    else if (statusFilter === "assigned") result = result.filter((o) => Boolean(o.assignedDriver) && o.status === "started")
    else if (statusFilter === "in-transit") result = result.filter((o) => o.status === "in-transit")
    else if (statusFilter === "picked-up") result = result.filter((o) => o.status === "picked-up")

    // Focused driver filter
    if (focusedDriverId) result = result.filter((o) => o.assignedDriver === focusedDriverId)

    // Text search
    if (q) result = result.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.address.toLowerCase().includes(q)
    )
    return result
  }, [searchTerm, visibleOrders, statusFilter, focusedDriverId])

  const unassignedOrders = useMemo(() => filteredOrders.filter((o) => !o.assignedDriver), [filteredOrders])
  const assignedOrders = useMemo(() => filteredOrders.filter((o) => Boolean(o.assignedDriver)), [filteredOrders])

  // Geocode order addresses – use stored lat/lng instantly, only geocode missing ones
  const jsGeocoderRef = useRef<google.maps.Geocoder | null>(null)
  const jsGeocachRef = useRef<Map<string, LatLng>>(new Map())

  useEffect(() => {
    let cancelled = false

    // Phase 1: Instantly use any orders that already have lat/lng from Firestore
    const instant: Record<string, LatLng> = {}
    const needsGeocode: Order[] = []

    for (const order of visibleOrders) {
      if (typeof order.lat === "number" && typeof order.lng === "number") {
        instant[order.id] = { lat: order.lat, lng: order.lng }
      } else if (order.address?.trim()) {
        const cacheKey = order.address.trim().toLowerCase()
        const cached = jsGeocachRef.current.get(cacheKey)
        if (cached) {
          instant[order.id] = cached
        } else {
          needsGeocode.push(order)
        }
      }
    }

    // Show stored coords immediately
    if (Object.keys(instant).length > 0) {
      setOrderCoords((prev) => ({ ...prev, ...instant }))
    }

    // Phase 2: Geocode missing ones in parallel batches and save coords to Firestore
    if (needsGeocode.length === 0) return

    async function geocodeMissing() {
      await loadGoogleMaps()
      if (!jsGeocoderRef.current) {
        jsGeocoderRef.current = new google.maps.Geocoder()
      }
      const geocoder = jsGeocoderRef.current
      const cache = jsGeocachRef.current
      const BATCH_SIZE = 10

      for (let i = 0; i < needsGeocode.length; i += BATCH_SIZE) {
        if (cancelled) break
        const batch = needsGeocode.slice(i, i + BATCH_SIZE)

        const results = await Promise.allSettled(
          batch.map((order) =>
            new Promise<{ id: string; coords: LatLng | null }>((resolve) => {
              const addr = order.address!.trim()
              geocoder.geocode(
                { address: `${addr}, Lagos, Nigeria`, region: "NG" },
                (results, status) => {
                  if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
                    const loc = results[0].geometry.location
                    resolve({ id: order.id, coords: { lat: loc.lat(), lng: loc.lng() } })
                  } else {
                    resolve({ id: order.id, coords: null })
                  }
                }
              )
            })
          )
        )

        if (cancelled) break

        const batchCoords: Record<string, LatLng> = {}
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.coords) {
            const { id, coords } = r.value
            const order = needsGeocode.find((o) => o.id === id)
            if (order) cache.set(order.address!.trim().toLowerCase(), coords)
            batchCoords[id] = coords
          }
        }

        // Update map progressively after each batch
        if (Object.keys(batchCoords).length > 0) {
          setOrderCoords((prev) => ({ ...prev, ...batchCoords }))
        }
      }

      // Do not write geocoded coords from client here to avoid duplicated
      // write amplification when multiple admins open this page.
    }

    geocodeMissing()
    return () => { cancelled = true }
  }, [visibleOrders])

  useEffect(() => {
    if (!visibleOrders.length) { setSelectedOrderId(null); return }
    const next =
      visibleOrders.find((o) => o.assignedDriver && orderCoords[o.id]) ??
      visibleOrders.find((o) => orderCoords[o.id]) ??
      visibleOrders[0]
    setSelectedOrderId((cur) => (cur && visibleOrders.some((o) => o.id === cur) ? cur : next.id))
  }, [visibleOrders, orderCoords])

  const selectedOrder = useMemo(() => visibleOrders.find((o) => o.id === selectedOrderId) ?? null, [selectedOrderId, visibleOrders])
  const selectedDriver = useMemo(() => {
    if (!selectedOrder?.assignedDriver) return null
    return drivers.find((d) => d.id === selectedOrder.assignedDriver) ?? null
  }, [drivers, selectedOrder])
  const selectedDestination = selectedOrder ? orderCoords[selectedOrder.id] : null

  /**
   * Dark circle driver marker — identical style to the customer tracking page.
   * IMPORTANT: must NOT use encodeURIComponent — Chrome disables SVG <animate>
   * (SMIL) when the data URL is fully percent-encoded. Escape only '#' manually,
   * exactly as the tracking page does.
   */
  function makeDriverMarkerIcon(name: string, size: number, selected: boolean): google.maps.Icon {
    // Canvas is 2× the marker size so the radar pulse can extend well past
    // the marker edge without being clipped. The dark marker stays at its
    // original size, centered inside the larger canvas.
    const canvas = size * 2
    const center = canvas / 2
    const r = size / 2 - 3
    const firstName = name.trim().split(" ")[0] ?? name
    const initial = (firstName[0] ?? "?").toUpperCase()
    const label = (selected ? firstName : initial).replace(/[<>&"]/g, "")
    const fontSize = selected ? Math.max(9, Math.round(size * 0.28)) : Math.round(size * 0.42)
    // Radar pulse on every driver — selected drivers pulse faster so they
    // remain visually distinguishable from idle ones. Green (#16a34a) is
    // encoded as %2316a34a — Chrome disables SVG <animate> if the data URL
    // is fully percent-encoded, so only the '#' is escaped manually.
    const pulseDur = selected ? "1s" : "2s"
    const pulseMax = center - 4
    const pulse = `<circle cx="${center}" cy="${center}" r="${r}" fill="%2316a34a" fill-opacity="0.18"><animate attributeName="r" values="${r - 2};${pulseMax};${r - 2}" dur="${pulseDur}" repeatCount="indefinite"/><animate attributeName="fill-opacity" values="0.5;0;0.5" dur="${pulseDur}" repeatCount="indefinite"/></circle>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">${pulse}<circle cx="${center}" cy="${center}" r="${r}" fill="%231a1a2e" stroke="white" stroke-width="3"/><text x="${center}" y="${center + 1}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" font-size="${fontSize}" fill="white">${label}</text></svg>`
    return {
      url: `data:image/svg+xml;charset=UTF-8,${svg}`,
      scaledSize: new google.maps.Size(canvas, canvas),
      anchor: new google.maps.Point(center, center),
    }
  }

  // ── Hub marker: orange circle background, white peaked-roof shop icon,
  // dark order-count badge in the top-right corner.
  function makeHubMarkerIcon(orderCount: number, size: number = 56): google.maps.Icon {
    const half = size / 2
    const r = half - 6
    const countStr = String(orderCount)
    const badgeFontSize = countStr.length > 2 ? 8 : 10
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <filter id="hs" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <circle cx="${half}" cy="${half}" r="${r}" fill="#f59e0b" stroke="white" stroke-width="3" filter="url(#hs)"/>
      <g stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M${half - 12} ${half} L${half} ${half - 10} L${half + 12} ${half} L${half + 12} ${half + 12} L${half - 12} ${half + 12} Z"/>
        <path d="M${half - 3} ${half + 12} L${half - 3} ${half + 6} L${half + 3} ${half + 6} L${half + 3} ${half + 12}"/>
      </g>
      <circle cx="${size - 12}" cy="14" r="9" fill="#1f2937" stroke="white" stroke-width="1.5"/>
      <text x="${size - 12}" y="14" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-weight="700" font-size="${badgeFontSize}" fill="white">${countStr}</text>
    </svg>`
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(half, half),
    }
  }

  // ── Helper: build filled‑circle SVG marker with single-line label ──
  function makeLabeledMarkerIcon(
    bgColor: string,
    label: string,
    size: number = 42,
    fontSize: number = 10,
  ): google.maps.Icon {
    const half = size / 2
    const r = half - 4
    const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <circle cx="${half}" cy="${half}" r="${r}" fill="${bgColor}" stroke="white" stroke-width="3" filter="url(%23s)"/>
      <text x="${half}" y="${half + 1}" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-weight="700" font-size="${fontSize}" fill="white" letter-spacing="0.2">${escaped}</text>
    </svg>`
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(half, half),
    }
  }

  // ── Helper: build two-line date marker (month + day) ──
  function makeDateMarkerIcon(
    bgColor: string,
    month: string,
    day: string,
    size: number = 48,
    isSelected: boolean = false,
  ): google.maps.Icon {
    const half = size / 2
    const r = half - 3
    const strokeW = isSelected ? 3.5 : 2.5
    const monthSize = Math.round(size * 0.22)
    const daySize = Math.round(size * 0.32)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <filter id="ds" x="-30%" y="-20%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-opacity="0.35"/>
        </filter>
      </defs>
      <circle cx="${half}" cy="${half}" r="${r}" fill="${bgColor}" stroke="white" stroke-width="${strokeW}" filter="url(%23ds)"/>
      <text x="${half}" y="${half - daySize * 0.32}" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-weight="600" font-size="${monthSize}" fill="white" opacity="0.95">${month}</text>
      <text x="${half}" y="${half + monthSize * 0.55}" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-weight="800" font-size="${daySize}" fill="white">${day}</text>
    </svg>`
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(half, half),
    }
  }

  function formatShortDate(date: unknown): string {
    if (!date) return ""
    const d = date instanceof Date ? date : new Date(date as string)
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  function formatShortTime(date: unknown): string {
    if (!date) return ""
    const d = date instanceof Date ? date : new Date(date as string)
    if (Number.isNaN(d.getTime())) return ""
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    return t.replace("AM", "a").replace("PM", "p").replace(" ", " ")
  }

  function getDateParts(date: unknown): { month: string; day: string; time: string; isToday: boolean } {
    const todayStr = new Date().toDateString()
    if (!date) return { month: "", day: "", time: "", isToday: false }
    const d = date instanceof Date ? date : new Date(date as string)
    if (Number.isNaN(d.getTime())) return { month: "", day: "", time: "", isToday: false }
    const month = d.toLocaleDateString("en-US", { month: "short" })
    const day = String(d.getDate())
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      .replace("AM", "a").replace("PM", "p").replace(" ", " ")
    return { month, day, time, isToday: d.toDateString() === todayStr }
  }

  // ── Status → color map (Shipday‑style teal / red) ──
  function orderColor(order: Order): string {
    if (order.status === "in-transit") return "#f97316"  // orange
    if (order.status === "picked-up") return "#8b5cf6"   // purple
    if (order.status === "started" || order.assignedDriver) return "#2dd4bf" // teal (assigned/started)
    return "#ef4444"                                      // red (unassigned)
  }

  // ── Init Google Map ── (re-run when isLoading changes so we catch the container after it mounts)
  useEffect(() => {
    let mounted = true

    async function initMap() {
      if (!mapContainerRef.current || mapRef.current) return
      await loadGoogleMaps()
      if (!mounted || !mapContainerRef.current) return

      const map = new google.maps.Map(mapContainerRef.current, {
        center: LAGOS_CENTER,
        zoom: 11,
        minZoom: 8,
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "simplified" }] },
        ],
      })
      mapRef.current = map
      orderInfoWindowRef.current = new google.maps.InfoWindow()
    }

    initMap()

    return () => {
      mounted = false
      orderMarkersRef.current.forEach((m) => m.setMap(null))
      orderMarkersRef.current = []
      for (const [, m] of driverMarkersMapRef.current) m.setMap(null)
      driverMarkersMapRef.current.clear()
      for (const frame of driverAnimFramesRef.current.values()) cancelAnimationFrame(frame)
      driverAnimFramesRef.current.clear()
      if (hubMarkerRef.current) hubMarkerRef.current.setMap(null)
      if (directionsRendererRef.current) directionsRendererRef.current.setMap(null)
      mapRef.current = null
    }
  }, [isLoading])

  // Track whether we've already fit bounds for the current data set
  const hasFitBoundsRef = useRef(false)
  const prevDataKeyRef = useRef("")

  // ── Update order markers + hub + route (Shipday-style) ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear previous order markers + hub + directions
    orderMarkersRef.current.forEach((m) => m.setMap(null))
    orderMarkersRef.current = []
    if (hubMarkerRef.current) { hubMarkerRef.current.setMap(null); hubMarkerRef.current = null }
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setMap(null)
      directionsRendererRef.current = null
    }

    // Detect whether the underlying data changed (not just selection)
    const dataKey = `${visibleOrders.map(o => o.id).join(",")}_${Object.keys(orderCoords).sort().join(",")}`
    const dataChanged = dataKey !== prevDataKeyRef.current
    prevDataKeyRef.current = dataKey
    if (dataChanged) hasFitBoundsRef.current = false

    const bounds = new google.maps.LatLngBounds()
    let hasPoints = false

    // ── Hub marker: shop icon with order-count badge ──
    hubMarkerRef.current = new google.maps.Marker({
      map,
      position: HUB,
      title: `Store Hub (${visibleOrders.length} orders)`,
      icon: makeHubMarkerIcon(visibleOrders.length),
      zIndex: 1000,
    })
    bounds.extend(HUB)
    hasPoints = true

    // ── Order markers: two-line date pins (Mon\nDD) ──
    visibleOrders.forEach((order) => {
      const coords = orderCoords[order.id]
      if (!coords) return

      const isSelected = selectedOrderId === order.id
      const color = orderColor(order)

      const { month, day, time, isToday } = getDateParts(order.createdAt)
      const size = isSelected ? 54 : 46

      // Use two-line date icon for dates, single-line for today's time
      const icon = isToday && time
        ? makeLabeledMarkerIcon(color, time, size, isSelected ? 12 : 10)
        : month && day
          ? makeDateMarkerIcon(color, month, day, size, isSelected)
          : makeLabeledMarkerIcon(color, "New", size, isSelected ? 12 : 10)

      const marker = new google.maps.Marker({
        map,
        position: coords,
        title: `${order.orderNumber} – ${order.customerName}`,
        icon,
        zIndex: isSelected ? 999 : 10,
      })

      marker.addListener("click", () => {
        setSelectedOrderId(order.id)
        const iw = orderInfoWindowRef.current
        if (iw) {
          iw.setContent(`
            <div style="font-family:system-ui;min-width:160px">
              <div style="font-weight:700;font-size:13px;margin-bottom:2px">#${order.orderNumber}</div>
              <div style="font-size:12px;color:#555">${order.customerName}</div>
              <div style="font-size:11px;color:#888;margin-top:4px">${order.address}</div>
              <div style="font-size:11px;margin-top:6px;color:${color};font-weight:600">${order.assignedDriver ? "Assigned" : "Unassigned"} · ${order.status}</div>
            </div>
          `)
          iw.open(map, marker)
        }
      })

      orderMarkersRef.current.push(marker)
      bounds.extend(coords)
      hasPoints = true
    })

    // ── Directions route for selected assigned order ──
    if (selectedDriver?.lastLocation && selectedDestination) {
      const directionsService = new google.maps.DirectionsService()
      const directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: { strokeColor: "#0ea5e9", strokeWeight: 4, strokeOpacity: 0.9 },
      })
      directionsRendererRef.current = directionsRenderer

      directionsService.route(
        {
          origin: { lat: selectedDriver.lastLocation.lat, lng: selectedDriver.lastLocation.lng },
          destination: selectedDestination,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            directionsRenderer.setDirections(result)
          }
        }
      )
    }

    // Only fit bounds when data actually changes, not on selection clicks
    if (!hasFitBoundsRef.current && hasPoints) {
      const lagosBounds = new google.maps.LatLngBounds(
        { lat: 6.35, lng: 3.0 },
        { lat: 6.75, lng: 3.75 },
      )
      const lagosFilteredBounds = new google.maps.LatLngBounds()
      let lagosPoints = 0
      visibleOrders.forEach((order) => {
        const coords = orderCoords[order.id]
        if (!coords) return
        if (lagosBounds.contains(coords)) {
          lagosFilteredBounds.extend(coords)
          lagosPoints++
        }
      })
      // Include driver positions in bounds
      activeDrivers.forEach((driver) => {
        if (!driver.lastLocation) return
        const pos = { lat: driver.lastLocation.lat, lng: driver.lastLocation.lng }
        if (lagosBounds.contains(pos)) {
          lagosFilteredBounds.extend(pos)
          lagosPoints++
        }
      })
      lagosFilteredBounds.extend(HUB)

      if (lagosPoints > 0) {
        map.fitBounds(lagosFilteredBounds, 36)
      } else {
        map.setCenter(LAGOS_CENTER)
        map.setZoom(11)
      }
      hasFitBoundsRef.current = true
    }
  }, [activeDrivers, orderCoords, selectedDestination, selectedDriver, selectedOrderId, visibleOrders])

  // ── Live driver markers — smoothly animate position changes ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(activeDrivers.filter((d) => d.lastLocation).map((d) => d.id))

    // Remove markers for drivers who went offline
    for (const [id, marker] of driverMarkersMapRef.current) {
      if (!currentIds.has(id)) {
        marker.setMap(null)
        driverMarkersMapRef.current.delete(id)
        const frame = driverAnimFramesRef.current.get(id)
        if (frame) { cancelAnimationFrame(frame); driverAnimFramesRef.current.delete(id) }
      }
    }

    // Add or animate existing driver markers
    activeDrivers.forEach((driver) => {
      if (!driver.lastLocation) return
      const newPos = { lat: driver.lastLocation.lat, lng: driver.lastLocation.lng }
      const isSelectedDrv = Boolean(selectedDriver && selectedDriver.id === driver.id)
      // Drivers always overlay order markers (hub=1000, selected order=999)
      const icon = makeDriverMarkerIcon(driver.name, isSelectedDrv ? 48 : 36, isSelectedDrv)
      const zIdx = isSelectedDrv ? 2000 : 1500

      const existing = driverMarkersMapRef.current.get(driver.id)

      if (existing) {
        existing.setIcon(icon)
        existing.setZIndex(zIdx)

        // Cancel any in-progress animation for this driver
        const prevFrame = driverAnimFramesRef.current.get(driver.id)
        if (prevFrame) cancelAnimationFrame(prevFrame)

        const startPos = existing.getPosition()!
        const fromLat = startPos.lat()
        const fromLng = startPos.lng()
        const toLat = newPos.lat
        const toLng = newPos.lng

        // Skip animation if position hasn't meaningfully changed
        if (Math.abs(fromLat - toLat) < 0.000005 && Math.abs(fromLng - toLng) < 0.000005) return

        const startedAt = performance.now()
        const durationMs = 900
        const step = (now: number) => {
          const progress = Math.min((now - startedAt) / durationMs, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          existing.setPosition({
            lat: fromLat + (toLat - fromLat) * eased,
            lng: fromLng + (toLng - fromLng) * eased,
          })
          if (progress < 1) {
            driverAnimFramesRef.current.set(driver.id, requestAnimationFrame(step))
          } else {
            driverAnimFramesRef.current.delete(driver.id)
          }
        }
        driverAnimFramesRef.current.set(driver.id, requestAnimationFrame(step))
      } else {
        const marker = new google.maps.Marker({
          map,
          position: newPos,
          title: driver.name,
          icon,
          zIndex: zIdx,
        })

        marker.addListener("click", () => {
          const iw = orderInfoWindowRef.current
          if (iw) {
            iw.setContent(`
              <div style="font-family:system-ui;min-width:140px">
                <div style="font-weight:700;font-size:13px">${driver.name}</div>
                <div style="font-size:12px;color:#555">${driver.phone ?? ""}</div>
                <div style="font-size:11px;color:#3b82f6;font-weight:600;margin-top:4px">${driver.status}</div>
              </div>
            `)
            iw.open(map, marker)
          }
        })

        driverMarkersMapRef.current.set(driver.id, marker)
      }
    })
  }, [activeDrivers, selectedDriver])

  const focusOrderOnMap = (order: Order) => {
    setSelectedOrderId(order.id)
    const map = mapRef.current
    const coords = orderCoords[order.id]
    if (!map || !coords) return
    map.panTo(coords)
    map.setZoom(14)
  }

  const fitAllBounds = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const bounds = new google.maps.LatLngBounds()
    let count = 0
    visibleOrders.forEach((o) => { const c = orderCoords[o.id]; if (c) { bounds.extend(c); count++ } })
    activeDrivers.forEach((d) => { if (d.lastLocation) { bounds.extend({ lat: d.lastLocation.lat, lng: d.lastLocation.lng }); count++ } })
    bounds.extend(HUB)
    if (count > 0) map.fitBounds(bounds, 48)
    else { map.setCenter(LAGOS_CENTER); map.setZoom(11) }
  }, [visibleOrders, orderCoords, activeDrivers])

  const zoomToDriver = useCallback((driver: Driver) => {
    if (!driver.lastLocation) return
    const map = mapRef.current
    if (!map) return
    map.panTo({ lat: driver.lastLocation.lat, lng: driver.lastLocation.lng })
    map.setZoom(15)
    setMobileView("map")
  }, [])

  const copyAddress = useCallback((orderId: string, address: string) => {
    navigator.clipboard.writeText(address).catch(() => {})
    setCopiedId(orderId)
    setTimeout(() => setCopiedId((prev) => (prev === orderId ? null : prev)), 2000)
  }, [])

  // Keyboard navigation: ArrowUp/Down cycles through filtered orders
  useEffect(() => {
    const allOrders = [...filteredOrders]
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
      e.preventDefault()
      const idx = allOrders.findIndex((o) => o.id === selectedOrderId)
      const next = e.key === "ArrowDown"
        ? allOrders[Math.min(idx + 1, allOrders.length - 1)]
        : allOrders[Math.max(idx - 1, 0)]
      if (next) focusOrderOnMap(next)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [filteredOrders, selectedOrderId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle map type
  useEffect(() => {
    mapRef.current?.setMapTypeId(mapType)
  }, [mapType])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      {/* Mobile: Map / Orders tab toggle */}
      <div className="flex shrink-0 border-b xl:hidden">
        <button
          type="button"
          onClick={() => {
            setMobileView("map")
            setTimeout(() => {
              if (mapRef.current) google.maps.event.trigger(mapRef.current, "resize")
            }, 50)
          }}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mobileView === "map" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => setMobileView("list")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mobileView === "list" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
        >
          Orders ({filteredOrders.length})
        </button>
      </div>

      <div className={`flex min-h-0 flex-1 ${isFullscreen ? "" : "xl:grid xl:grid-cols-[360px_minmax(0,1fr)]"}`}>
      <aside className={`min-h-0 flex-col border-r bg-card ${isFullscreen ? "hidden" : ""} ${mobileView === "list" ? "flex flex-1" : "hidden"} xl:flex xl:h-full`}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">Routes</h1>
          {(searchTerm || statusFilter !== "all" || focusedDriverId) && (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setSearchTerm(""); setStatusFilter("all"); setFocusedDriverId(null) }}>
              Clear filters
            </button>
          )}
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-4 divide-x border-b text-center">
          {[
            { label: "Active", value: visibleOrders.length, color: "text-foreground" },
            { label: "Unassigned", value: unassignedOrders.length, color: "text-destructive" },
            { label: "In Transit", value: visibleOrders.filter((o) => o.status === "in-transit").length, color: "text-orange-500" },
            { label: "Drivers", value: onlineDrivers.length, color: "text-emerald-600" },
          ].map((s) => (
            <div key={s.label} className="py-2">
              <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Status filter chips */}
        <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 scrollbar-none">
          {[
            { key: "all", label: "All" },
            { key: "unassigned", label: "Unassigned" },
            { key: "assigned", label: "Assigned" },
            { key: "in-transit", label: "In Transit" },
            { key: "picked-up", label: "Picked Up" },
          ].map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setStatusFilter(chip.key)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${statusFilter === chip.key ? "bg-primary text-primary-foreground" : "border text-muted-foreground hover:bg-secondary"}`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearchTerm("")}
              placeholder="Search orders (↑↓ to navigate)"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-2">
          {/* Online drivers panel */}
          {onlineDrivers.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Online drivers ({onlineDrivers.length})</p>
                {focusedDriverId && (
                  <button type="button" onClick={() => setFocusedDriverId(null)} className="text-[11px] text-primary hover:underline">Show all</button>
                )}
              </div>
              <div className="space-y-1">
                {onlineDrivers.map((driver) => {
                  const hasGps = Boolean(driver.lastLocation)
                  const pingMs = driver.lastPingAt ? (typeof driver.lastPingAt === "object" && "seconds" in (driver.lastPingAt as object) ? (driver.lastPingAt as { seconds: number }).seconds * 1000 : Number(driver.lastPingAt)) : null
                  const pingAgo = pingMs ? Math.round((Date.now() - pingMs) / 1000) : null
                  const pingText = pingAgo === null ? "No ping yet" : pingAgo < 60 ? `${pingAgo}s ago` : `${Math.floor(pingAgo / 60)}m ago`
                  const driverOrderCount = visibleOrders.filter((o) => o.assignedDriver === driver.id).length
                  const isFocused = focusedDriverId === driver.id
                  return (
                    <div
                      key={driver.id}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${isFocused ? "border-primary bg-primary/5" : "bg-background"}`}
                    >
                      <button
                        type="button"
                        onClick={() => setFocusedDriverId(isFocused ? null : driver.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title={`Click to ${isFocused ? "unfocus" : "focus"} ${driver.name}'s orders`}
                      >
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1a1a2e] text-xs font-bold text-white">
                          {(driver.name.trim().split(" ")[0]?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">{driver.name.split(" ")[0]}</span>
                          <span className="text-[10px] text-muted-foreground">{pingText}</span>
                          {!hasGps && driver.lastPingError && (
                            <span className="text-[10px] text-amber-600 break-all leading-snug">{driver.lastPingError}</span>
                          )}
                        </div>
                      </button>
                      {driverOrderCount > 0 && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">{driverOrderCount}</span>
                      )}
                      {hasGps
                        ? <Wifi className="size-3.5 shrink-0 text-emerald-500" aria-label="GPS active" />
                        : <WifiOff className="size-3.5 shrink-0 text-amber-500" aria-label="Waiting for GPS…" />
                      }
                      {hasGps && (
                        <button
                          type="button"
                          onClick={() => zoomToDriver(driver)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          aria-label={`Zoom to ${driver.name}`}
                        >
                          <LocateFixed className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Unassigned orders */}
          {(statusFilter === "all" || statusFilter === "unassigned") && !focusedDriverId && (
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Unassigned orders ({unassignedOrders.length})</p>
              <div className="space-y-2">
                {unassignedOrders.length === 0 && (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No unassigned orders</p>
                )}
                {unassignedOrders.map((order) => {
                  const color = orderColor(order)
                  const isSelected = selectedOrderId === order.id
                  return (
                    <div
                      key={order.id}
                      className={`overflow-hidden rounded-lg border transition ${isSelected ? "border-red-400 shadow-sm" : "hover:border-border/80"}`}
                    >
                      <button
                        type="button"
                        onClick={() => focusOrderOnMap(order)}
                        className="flex w-full items-start gap-3 p-3 text-left"
                      >
                        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-foreground">#{order.orderNumber}</p>
                          <p className="text-sm text-foreground">{order.customerName}</p>
                          <p className="truncate text-xs text-muted-foreground">{order.address}</p>
                          {order.distanceKm != null && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{order.distanceKm.toFixed(1)} km · ~{Math.round(order.distanceKm / 0.5)} min</p>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 border-t px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => copyAddress(order.id, order.address)}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          {copiedId === order.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                          {copiedId === order.id ? "Copied" : "Copy address"}
                        </button>
                        {order.phone && (
                          <span className="ml-auto text-[10px] text-muted-foreground">{order.phone}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Assigned / filtered orders */}
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">
              {focusedDriverId
                ? `${drivers.find((d) => d.id === focusedDriverId)?.name.split(" ")[0] ?? "Driver"}'s orders (${filteredOrders.length})`
                : `Assigned orders (${assignedOrders.length})`}
            </p>
            <div className="space-y-2">
              {(focusedDriverId ? filteredOrders : assignedOrders).length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No orders</p>
              )}
              {(focusedDriverId ? filteredOrders : assignedOrders).map((order) => {
                const driver = drivers.find((d) => d.id === order.assignedDriver)
                const color = orderColor(order)
                const isSelected = selectedOrderId === order.id
                return (
                  <div
                    key={order.id}
                    className={`overflow-hidden rounded-lg border transition ${isSelected ? "border-blue-400 shadow-sm" : "hover:border-border/80"}`}
                  >
                    <button
                      type="button"
                      onClick={() => focusOrderOnMap(order)}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground">#{order.orderNumber}</p>
                        <p className="text-sm text-foreground">{order.customerName}</p>
                        <p className="truncate text-xs text-muted-foreground">{order.address}</p>
                        {order.distanceKm != null && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{order.distanceKm.toFixed(1)} km · ~{Math.round(order.distanceKm / 0.5)} min</p>
                        )}
                        {driver && !focusedDriverId && (
                          <p className="mt-1 truncate text-[11px] font-medium text-blue-600">Driver: {driver.name}</p>
                        )}
                      </div>
                    </button>
                    {/* Expanded detail for selected order */}
                    {isSelected && (
                      <div className="border-t bg-secondary/30 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                        {order.phone && <p><span className="font-medium text-foreground">Phone:</span> {order.phone}</p>}
                        {order.amount != null && <p><span className="font-medium text-foreground">Amount:</span> ₦{order.amount.toLocaleString()}</p>}
                        {order.paymentMethod && <p><span className="font-medium text-foreground">Payment:</span> {order.paymentMethod}</p>}
                        {order.pickupAddress && <p><span className="font-medium text-foreground">Pickup:</span> {order.pickupAddress}</p>}
                        {order.deliveryInstruction && <p><span className="font-medium text-foreground">Note:</span> {order.deliveryInstruction}</p>}
                      </div>
                    )}
                    <div className="flex items-center gap-1 border-t px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => copyAddress(order.id, order.address)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        {copiedId === order.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                        {copiedId === order.id ? "Copied" : "Copy address"}
                      </button>
                      <span className="ml-auto capitalize text-[10px]" style={{ color }}>{order.status}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </aside>

      <section className={`relative overflow-hidden bg-card ${mobileView === "map" ? "flex flex-1 flex-col" : "hidden"} xl:flex xl:flex-1 xl:flex-col`}>
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Map overlay controls — top-right */}
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          {/* Fit all bounds */}
          <button
            onClick={fitAllBounds}
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium shadow-md hover:bg-white"
            title="Fit all markers"
          >
            <LocateFixed className="size-3.5 text-primary" />
            Fit all
          </button>
          {/* Map type toggle */}
          <button
            onClick={() => setMapType((t) => t === "roadmap" ? "satellite" : "roadmap")}
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium shadow-md hover:bg-white"
            title="Toggle map type"
          >
            <Layers className="size-3.5 text-primary" />
            {mapType === "roadmap" ? "Satellite" : "Roadmap"}
          </button>
          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium shadow-md hover:bg-white xl:flex"
            title={isFullscreen ? "Show sidebar" : "Fullscreen map"}
          >
            {isFullscreen ? <Minimize2 className="size-3.5 text-primary" /> : <Maximize2 className="size-3.5 text-primary" />}
            {isFullscreen ? "Sidebar" : "Fullscreen"}
          </button>
        </div>

        {/* Keyboard nav hint */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1 rounded-lg bg-white/80 px-2 py-1 text-[10px] text-muted-foreground shadow">
          <ChevronUp className="size-3" /><ChevronDown className="size-3" /> navigate orders
        </div>

        {/* Legend — bottom-right */}
        <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-3 rounded-lg bg-white/95 px-4 py-2 text-xs shadow-md">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-amber-500" /> Hub
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" /> Unassigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-teal-400" /> Assigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-orange-500" /> In Transit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-blue-500" /> Driver
          </span>
        </div>

        {/* Selected order summary — bottom-left */}
        {selectedOrder && (
          <div className="pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-lg bg-white/95 p-3 text-xs shadow-md">
            <p className="font-bold text-foreground">#{selectedOrder.orderNumber} · {selectedOrder.customerName}</p>
            <p className="mt-0.5 text-muted-foreground">{selectedOrder.address}</p>
            {selectedOrder.phone && <p className="mt-0.5 text-muted-foreground">{selectedOrder.phone}</p>}
            <div className="mt-1.5 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: orderColor(selectedOrder) }} />
              <span className="font-medium capitalize" style={{ color: orderColor(selectedOrder) }}>{selectedOrder.status}</span>
              {selectedOrder.distanceKm != null && (
                <span className="text-muted-foreground">· {selectedOrder.distanceKm.toFixed(1)} km · ~{Math.round(selectedOrder.distanceKm / 0.5)} min</span>
              )}
            </div>
            {selectedOrder.amount != null && (
              <p className="mt-1 text-muted-foreground">Amount: ₦{selectedOrder.amount.toLocaleString()}</p>
            )}
          </div>
        )}
      </section>
      </div>
    </div>
  )
}
