"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { optimizeRouteOrder } from "@/lib/google-maps"
import type { Driver, Order } from "@/lib/data"
import { toast } from "@/hooks/use-toast"
import { driverFetch, clearDriverToken } from "@/lib/driver-client"
import { getPendingDeliveries, removePendingDelivery, pendingDeliveryCount as getPendingCount } from "@/lib/delivery-queue"
import { getPendingStatusUpdates, removeStatusUpdate, pendingStatusCount } from "@/lib/status-queue"
import { loadCachedOrders, saveCachedOrders, clearCachedOrders } from "@/lib/order-cache"
import { onAppResume } from "@/lib/native-bridge"

interface DriverSession {
  id: string
  name: string
  phone: string
}

interface DriverContextValue {
  session: DriverSession | null
  driver: Driver | null
  orders: Order[]
  isOnline: boolean
  justWentOnline: boolean
  consumeJustWentOnline: () => void
  loadingSession: boolean
  loadingOrders: boolean
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  goOnline: () => Promise<void>
  goOffline: () => Promise<void>
  refreshOrders: () => Promise<void>
  /**
   * Apply a change to one order in local state without refetching the list.
   *
   * Status actions used to await refreshOrders(), so the card only moved
   * after a full round trip returned the whole order list — the driver
   * pressed a button and watched a spinner before anything happened. Patch
   * locally first and let the request settle in the background.
   */
  patchOrder: (orderId: string, changes: Partial<Order>) => void
  optimizeRoute: (lastStopId?: string | null) => Promise<boolean>
  login: (session: DriverSession) => void
  logout: () => void
  /** Latest GPS position from the device (updated locally before Firestore round-trip) */
  liveGps: { lat: number; lng: number } | null
  /** True when GPS tracking is active but has encountered an error */
  gpsError: boolean
  /** Number of deliveries saved offline waiting to sync */
  pendingDeliveryCount: number
  /**
   * Whether the API is actually reachable — set from real request outcomes,
   * not navigator.onLine, which stays true in the dead zones and captive
   * portals drivers hit most.
   */
  isConnected: boolean
  /** True while the offline queues are being flushed. */
  syncing: boolean
  /** Force a flush of the offline queues (the banner's "Retry now"). */
  syncPending: () => Promise<void>
}

// Backoff bounds for flushing the offline write queues.
const RETRY_BASE_MS = 20_000
const RETRY_MAX_MS = 5 * 60_000

/**
 * How often to re-read the order list while a driver is online.
 *
 * 20s keeps a newly assigned job visible quickly without being wasteful:
 * against the 120/min per-driver API budget this costs 3/min, alongside the
 * 6/min profile poll.
 */
const ORDER_POLL_MS = 20_000

const DriverContext = createContext<DriverContextValue | null>(null)

export function useDriver() {
  const ctx = useContext(DriverContext)
  if (!ctx) throw new Error("useDriver must be used within DriverProvider")
  return ctx
}

export function DriverProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [session, setSession] = useState<DriverSession | null>(null)
  const [driver, setDriver] = useState<Driver | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [isOnline, setIsOnline] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [justWentOnline, setJustWentOnline] = useState(false)
  const [liveGps, setLiveGps] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsError, setGpsError] = useState(false)
  const [pendingDeliveryCount, setPendingDeliveryCount] = useState(0)
  // Reachability of the *API*, not just the radio. navigator.onLine only
  // reports whether a link exists, which is why it stays true through the
  // failures drivers actually hit (edge errors, captive portals, dead zones
  // that still associate). Seeded optimistically so the banner doesn't flash
  // on a cold start before the first request resolves.
  const [isConnected, setIsConnected] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const watchIdRef = useRef<number | null>(null)
  const lastGpsWriteRef = useRef<number>(0)
  const isRetryingRef = useRef(false)
  const retryPendingRef = useRef<(() => Promise<void>) | null>(null)
  // True while refreshes are failing, so the toast fires once per outage
  // rather than once per polled attempt.
  const refreshFailedRef = useRef(false)

  // Load session from localStorage
  useEffect(() => {
    const raw = localStorage.getItem("driverSession")
    if (!raw) {
      setLoadingSession(false)
      return
    }
    try {
      const parsed = JSON.parse(raw) as DriverSession
      if (parsed?.id) {
        setSession(parsed)
      }
    } catch {
      localStorage.removeItem("driverSession")
    }
    setLoadingSession(false)
  }, [])

  // Poll driver profile every 10 s so status and lastLocation stay in sync
  useEffect(() => {
    if (!session) return
    let cancelled = false

    async function pollProfile() {
      try {
        const res = await driverFetch("/api/driver/profile", {})
        if (cancelled) return

        // A 404 means the token is valid but the driver record it names is
        // gone — the account was deleted, or the Firestore data was rebuilt
        // and the document has a new id. The session can never recover on its
        // own, and every other driver call fails alongside it.
        //
        // This used to fall into the `!res.ok` early return, so the app sat
        // there indefinitely showing the placeholder name and a 0.00 rating
        // while orders quietly failed to refresh — with nothing on screen
        // connecting the two or suggesting signing in again.
        if (res.status === 404) {
          toast({
            title: "Session out of date",
            description: "Your driver account could not be found. Please sign in again.",
            variant: "destructive",
          })
          logout()
          return
        }

        if (!res.ok) return
        const data = (await res.json()) as { ok: boolean; driver?: Driver }
        if (data.driver && !cancelled) {
          setDriver(data.driver)
          setIsOnline(data.driver.status === "available" || data.driver.status === "on-delivery")
        }
      } catch { /* ignore transient errors — next poll will retry */ }
    }

    pollProfile()
    const id = window.setInterval(pollProfile, 10_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [session])

  // GPS tracking when online
  useEffect(() => {
    if (!session || !isOnline) return
    if (!navigator.geolocation) {
      toast({ title: "Location unavailable", description: "Your device does not support GPS.", variant: "destructive" })
      return
    }
    if (watchIdRef.current !== null) return

    const sessionId = session.id

    // Get an immediate position fix so the map shows the driver right away
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setLiveGps(coords)
        lastGpsWriteRef.current = Date.now()
        try {
          await driverFetch("/api/driver/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driverId: sessionId, lat: coords.lat, lng: coords.lng }),
          })
        } catch { /* silently ignore */ }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          toast({ title: "Location access denied", description: "Go to your device Settings → App Permissions → Location and enable it for this app so customers can track your delivery.", variant: "destructive" })
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setLiveGps(coords)
        setGpsError(false)

        // Throttle writes — at most once every 5 seconds
        const now = Date.now()
        if (now - lastGpsWriteRef.current < 5000) return
        lastGpsWriteRef.current = now
        try {
          await driverFetch("/api/driver/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driverId: sessionId, lat: coords.lat, lng: coords.lng }),
          })
        } catch { /* best-effort */ }
      },
      (err) => {
        setGpsError(true)
        if (err.code === err.PERMISSION_DENIED) {
          toast({ title: "Location access denied", description: "Go to Settings → App Permissions → Location and enable it so customers can track your delivery.", variant: "destructive" })
        } else {
          toast({ title: "GPS unavailable", description: "Location tracking lost. Your position won't update until GPS recovers.", variant: "destructive" })
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [session, isOnline])

  // Offline write queues — POD submissions + status updates. Both flush
  // on the same "online" event and on mount if the device is already up.
  useEffect(() => {
    function updateCount() {
      // Banner shows combined count so the driver sees the total pending
      // writes — POD submissions (with photo/signature) and status updates.
      setPendingDeliveryCount(getPendingCount() + pendingStatusCount())
    }
    updateCount()

    async function retryPending() {
      if (isRetryingRef.current) return
      isRetryingRef.current = true
      // Any fetch that throws is a transport failure — that, not
      // navigator.onLine, is what drives the "no connection" banner.
      let transportFailed = false
      const hadWork = getPendingCount() + pendingStatusCount() > 0
      if (hadWork) setSyncing(true)
      try {
        // 1) POD submissions
        const pending = getPendingDeliveries()
        for (const item of pending) {
          try {
            const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(item.orderId)}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                driverId: item.driverId,
                status: "delivered",
                ...(item.photoData ? { photoData: item.photoData } : {}),
                ...(item.signatureData ? { signatureData: item.signatureData } : {}),
                ...(item.deliveryNotes ? { deliveryNotes: item.deliveryNotes } : {}),
                // Absent on entries queued before these were captured.
                ...(item.signerName ? { signerName: item.signerName } : {}),
                ...(typeof item.deliveryLat === "number" && typeof item.deliveryLng === "number"
                  ? { deliveryLat: item.deliveryLat, deliveryLng: item.deliveryLng }
                  : {}),
              }),
            })
            if (res.ok) {
              removePendingDelivery(item.orderId)
              toast({ title: "Delivery synced", description: `${item.orderNumber} confirmed while offline.` })
            } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
              // The server understood and refused. Retrying can't fix a
              // malformed or already-applied submission, and silently looping
              // on it would keep the pending badge up forever while newer
              // items queue behind it. Drop it and tell the driver, so they
              // can redo that one delivery rather than lose the whole queue.
              removePendingDelivery(item.orderId)
              toast({
                title: "Delivery could not be synced",
                description: `${item.orderNumber} was rejected by the server — please confirm it again.`,
                variant: "destructive",
              })
            }
          } catch { transportFailed = true /* retry next time */ }
        }
        // 2) Status updates (Mark as Picked Up / On the way / revert)
        const pendingStatus = getPendingStatusUpdates()
        for (const item of pendingStatus) {
          try {
            const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(item.orderId)}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                driverId: item.driverId,
                status: item.status,
                ...(item.failedReason ? { failedReason: item.failedReason } : {}),
              }),
            })
            if (res.ok) {
              removeStatusUpdate(item.orderId)
              toast({ title: "Synced", description: `${item.orderNumber} → ${item.status}` })
            } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
              // Same reasoning as the POD queue above: a 4xx won't heal.
              removeStatusUpdate(item.orderId)
              toast({
                title: "Status update rejected",
                description: `${item.orderNumber} could not be set to ${item.status}.`,
                variant: "destructive",
              })
            }
          } catch { transportFailed = true /* retry next time */ }
        }
        updateCount()
        // Only a request that actually completed tells us anything about
        // reachability; if there was nothing queued, leave the flag alone.
        if (hadWork) setIsConnected(!transportFailed)
      } finally {
        isRetryingRef.current = false
        setSyncing(false)
      }
    }

    // Expose a manual trigger so the connection banner's "Retry now" button
    // and the pull-to-refresh path can force a flush.
    retryPendingRef.current = retryPending

    function markOffline() { setIsConnected(false) }
    async function onOnline() {
      setIsConnected(true)
      await retryPending()
    }

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", markOffline)

    // The `online` event alone is not enough. It fires on *link* changes, not
    // on server reachability — so if the device keeps its connection but the
    // API is failing (edge 403s, DNS, a deploy), queued writes would sit
    // forever waiting for an event that never comes. Poll while work is
    // outstanding, backing off so a long outage doesn't hammer the radio and
    // drain the battery.
    let timer: number | null = null
    let delay = RETRY_BASE_MS
    function schedule() {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        if (getPendingCount() + pendingStatusCount() > 0) {
          const before = getPendingCount() + pendingStatusCount()
          await retryPending()
          const after = getPendingCount() + pendingStatusCount()
          // Progress resets the backoff; a stalled queue widens the gap.
          delay = after < before ? RETRY_BASE_MS : Math.min(delay * 2, RETRY_MAX_MS)
        } else {
          delay = RETRY_BASE_MS
        }
        schedule()
      }, delay)
    }
    schedule()

    // Also retry immediately if the device is already online when the component mounts
    if (navigator.onLine) void retryPending()
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", markOffline)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  // Restore the last-known round as soon as the session is known, before any
  // network call. With no signal this is the difference between the driver
  // seeing their deliveries and seeing an empty list.
  useEffect(() => {
    if (!session) return
    const cached = loadCachedOrders(session.id)
    if (cached.length > 0) {
      // Only seed — never overwrite a list already refreshed from the server.
      setOrders((prev) => (prev.length > 0 ? prev : cached))
    }
  }, [session])

  const patchOrder = useCallback((orderId: string, changes: Partial<Order>) => {
    setOrders((prev) => {
      const next = prev.map((o) => (o.id === orderId ? { ...o, ...changes } : o))
      // Persist optimistic changes too, so a status advanced offline survives
      // the app being killed before it syncs.
      if (session) saveCachedOrders(session.id, next)
      return next
    })
  }, [session])

  const refreshOrders = useCallback(async () => {
    if (!session) return
    setLoadingOrders(true)
    try {
      const res = await driverFetch(`/api/driver/orders?driverId=${encodeURIComponent(session.id)}`, {})
      if (!res.ok) {
        // Distinguish the failure modes. "Failed to load deliveries" for
        // everything told the driver nothing about whether to wait, retry, or
        // report it — and a throttled request is worth waiting out, not
        // hammering, which is what a driver naturally does with a bare error.
        if (res.status === 429) {
          toast({
            title: "Slow down a moment",
            description: "Too many requests. Your deliveries will refresh shortly.",
          })
          return
        }
        throw new Error(`Failed to load orders (${res.status})`)
      }
      const { orders: data } = (await res.json()) as { ok: boolean; orders: Order[] }
      const hasRouteOrder = data.some((o) => typeof o.routeOrder === "number")
      const sorted = data.sort((a, b) => {
        // If route has been optimized, sort active orders by routeOrder
        if (hasRouteOrder) {
          const aActive = a.status !== "delivered" && a.status !== "cancelled" && a.status !== "failed"
          const bActive = b.status !== "delivered" && b.status !== "cancelled" && b.status !== "failed"
          // Active orders with routeOrder come first, in order
          if (aActive && bActive) {
            const aR = a.routeOrder ?? 9999
            const bR = b.routeOrder ?? 9999
            if (aR !== bR) return aR - bR
          }
          // Inactive orders go to the bottom
          if (aActive && !bActive) return -1
          if (!aActive && bActive) return 1
        }
        // Fallback: sort by status priority
        const priority: Record<string, number> = {
          started: 0,
          "picked-up": 1,
          "in-transit": 2,
          delivered: 3,
          failed: 4,
          cancelled: 5,
          unassigned: 6,
        }
        return (priority[a.status] ?? 5) - (priority[b.status] ?? 5)
      })
      setOrders(sorted)
      saveCachedOrders(session.id, sorted)
      // Recovered — the next failure is news again.
      refreshFailedRef.current = false
    } catch (err) {
      // Keep whatever is already on screen. Blanking the list on a transient
      // failure would strand a driver mid-shift with no addresses to work
      // from, which is worse than showing slightly stale ones.
      //
      // Toast only on the transition into failure. The map polls every 15s, so
      // announcing every failed attempt meant a banner reappearing four times
      // a minute for as long as the problem lasted — unreadable, and it buries
      // toasts the driver actually needs to act on. The DriverStatusBanner
      // already shows the persistent state.
      if (!refreshFailedRef.current) {
        refreshFailedRef.current = true
        const offline = !navigator.onLine || err instanceof TypeError
        toast({
          title: offline ? "No connection" : "Couldn't refresh deliveries",
          description: offline
            ? "Showing your last loaded deliveries. They'll update when you reconnect."
            : "Showing your last loaded deliveries. Pull down to try again.",
          variant: "destructive",
        })
      }
    } finally {
      setLoadingOrders(false)
    }
  }, [session])

  const optimizeRoute = useCallback(async (lastStopId?: string | null): Promise<boolean> => {
    if (!session || !driver?.lastLocation) return false
    try {
      const res = await driverFetch(`/api/driver/orders?driverId=${encodeURIComponent(session.id)}`, {})
      if (!res.ok) throw new Error("Failed to load orders for optimization")
      const { orders: data } = (await res.json()) as { ok: boolean; orders: Order[] }
      const active = data.filter(
        (o) => o.status === "picked-up" || o.status === "in-transit"
      )
      // Need lat/lng on orders to optimize
      const withCoords = active.filter(
        (o) => typeof o.lat === "number" && typeof o.lng === "number"
      ) as (Order & { lat: number; lng: number })[]

      if (withCoords.length < 2) {
        // Nothing to optimize with 0-1 stops
        return false
      }

      const orderedIds = await optimizeRouteOrder(
        driver.lastLocation,
        withCoords.map((o) => ({ id: o.id, lat: o.lat, lng: o.lng })),
        lastStopId,
      )

      // Persist via API route (server-side admin SDK write)
      await driverFetch("/api/driver/route/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      })

      // Refresh to reflect new order
      await refreshOrders()
      return true
    } catch {
      toast({ title: "Error", description: "Route optimization failed.", variant: "destructive" })
      return false
    }
  }, [session, driver, refreshOrders])

  // Load orders when online
  useEffect(() => {
    if (session && isOnline) refreshOrders()
  }, [session, isOnline, refreshOrders])

  /**
   * Keep the order list current without the driver pulling to refresh.
   *
   * Polling previously lived only on the map screen, so a driver sitting on
   * the Orders tab — where they spend the shift — never saw a newly assigned
   * job, and an order unassigned by dispatch stayed on their list until they
   * pulled down. Run it from the context instead so every screen benefits.
   *
   * Also refresh on resume: Android suspends timers for a backgrounded app,
   * so without this the first thing a driver sees after unlocking the phone
   * is whatever was on screen when they pocketed it.
   */
  useEffect(() => {
    if (!session || !isOnline) return

    const interval = window.setInterval(() => { void refreshOrders() }, ORDER_POLL_MS)

    function onVisible() {
      if (document.visibilityState === "visible") void refreshOrders()
    }
    document.addEventListener("visibilitychange", onVisible)

    // Capacitor fires this on Android resume; harmless no-op in a browser.
    let removeAppListener: (() => void) | null = null
    void onAppResume(() => { void refreshOrders() }).then((fn) => { removeAppListener = fn })

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
      removeAppListener?.()
    }
  }, [session, isOnline, refreshOrders])

  async function goOnline() {
    if (!session) return
    try {
      const res = await driverFetch("/api/driver/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          driverId: session.id,
          status: "available",
        }),
      })
      if (!res.ok) throw new Error("Failed to go online")
      setIsOnline(true)
      setJustWentOnline(true)
      setGpsError(false)
      lastGpsWriteRef.current = 0
      const profileRes = await driverFetch("/api/driver/profile", {})
      if (profileRes.ok) {
        const { driver: d } = (await profileRes.json()) as { driver?: Driver }
        if (d) setDriver(d)
      }
    } catch {
      toast({ title: "Error", description: "Failed to go online.", variant: "destructive" })
    }
  }

  async function goOffline() {
    if (!session) return
    try {
      const res = await driverFetch("/api/driver/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          driverId: session.id,
          status: "offline",
        }),
      })
      if (!res.ok) throw new Error("Failed to go offline")
      setIsOnline(false)
      setJustWentOnline(false)
      const profileRes = await driverFetch("/api/driver/profile", {})
      if (profileRes.ok) {
        const { driver: d } = (await profileRes.json()) as { driver?: Driver }
        if (d) setDriver(d)
      }
    } catch {
      toast({ title: "Error", description: "Failed to go offline.", variant: "destructive" })
    }
  }

  /**
   * Call this from the login form after a successful API response.
   * It writes localStorage *and* updates the context state in the same
   * synchronous frame, so the dashboard's session-presence check sees
   * the new session immediately on navigation. Without this, dashboard
   * sees session=null (context state hasn't refreshed from localStorage)
   * and bounces back to /driver — creating an infinite login loop in
   * Capacitor where the provider stays mounted across navigations.
   */
  function login(newSession: DriverSession) {
    try {
      localStorage.setItem("driverSession", JSON.stringify(newSession))
    } catch { /* storage disabled — context still works in-memory */ }
    setSession(newSession)
    setLoadingSession(false)
  }

  function logout() {
    localStorage.removeItem("driverSession")
    // Drop the cached round as well — handsets get shared between drivers,
    // and customer names, addresses and phone numbers must not outlive the
    // session that fetched them.
    if (session) clearCachedOrders(session.id)
    clearDriverToken()
    setSession(null)
    setDriver(null)
    setOrders([])
    setIsOnline(false)
    router.replace("/driver")
  }

  const contextValue = useMemo(() => ({
    session,
    driver,
    orders,
    isOnline,
    justWentOnline,
    consumeJustWentOnline: () => setJustWentOnline(false),
    loadingSession,
    loadingOrders,
    drawerOpen,
    setDrawerOpen,
    goOnline,
    goOffline,
    refreshOrders,
    patchOrder,
    optimizeRoute,
    login,
    logout,
    liveGps,
    gpsError,
    pendingDeliveryCount,
    isConnected,
    syncing,
    syncPending: async () => { await retryPendingRef.current?.() },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [session, driver, orders, isOnline, justWentOnline, loadingSession, loadingOrders, drawerOpen, refreshOrders, patchOrder, optimizeRoute, liveGps, gpsError, pendingDeliveryCount, isConnected, syncing])

  return (
    <DriverContext.Provider value={contextValue}>
      {children}
    </DriverContext.Provider>
  )
}
