"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import {
  MapPin,
  Phone,
  Navigation,
  Loader2,
  Menu,
  Truck,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  X,
  MessageSquare,
  MessageCircle,
} from "lucide-react"
import { formatCurrency } from "@/lib/data"
import type { Order } from "@/lib/data"
import { toast } from "@/hooks/use-toast"
import { useDriver } from "@/components/driver-context"
import { driverFetch } from "@/lib/driver-client"
import { buildNavUrl, getNavApp } from "@/lib/nav"
import { HUB_ADDRESS, HUB_PHONE } from "@/lib/hub"
import { hapticTap, hapticSuccess, hapticError } from "@/lib/native-bridge"
import { queueStatusUpdate } from "@/lib/status-queue"

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    started: "bg-blue-500/15 text-blue-600 border-blue-500/20",
    "picked-up": "bg-primary/15 text-primary border-primary/20",
    "in-transit": "bg-warning/15 text-warning border-warning/20",
    delivered: "bg-success/15 text-success border-success/20",
    unassigned: "bg-muted-foreground/15 text-muted-foreground border-muted-foreground/20",
    failed: "bg-destructive/15 text-destructive border-destructive/20",
    cancelled: "bg-destructive/15 text-destructive border-destructive/20",
  }
  const labelMap: Record<string, string> = {
    started: "Started",
    "picked-up": "Picked Up",
    "in-transit": "In Transit",
    delivered: "Delivered",
    unassigned: "Unassigned",
    failed: "Failed",
    cancelled: "Cancelled",
  }
  return (
    <Badge variant="outline" className={map[status] ?? ""}>
      {labelMap[status] ?? status}
    </Badge>
  )
}

export default function DriverDashboard() {
  const router = useRouter()
  const {
    session,
    driver,
    orders,
    isOnline,
    justWentOnline,
    consumeJustWentOnline,
    loadingSession,
    loadingOrders,
    setDrawerOpen,
    goOnline,
    refreshOrders,
    patchOrder,
    optimizeRoute,
  } = useDriver()
  // Re-entrancy guard for per-order status writes. This is a ref, not state,
  // because the card now advances optimistically — driving a spinner off it
  // would show the *next* step's button spinning straight after the tap.
  const inFlightRef = useRef<Set<string>>(new Set())
  const [showOnlineToast, setShowOnlineToast] = useState(false)
  const [routeModalOpen, setRouteModalOpen] = useState(false)
  const [reportOrder, setReportOrder] = useState<Order | null>(null)
  const [reportReason, setReportReason] = useState("")
  // Bottom-sheet pickers, mirroring driver-app's UX
  const [navSheet, setNavSheet] = useState<Order | null>(null)
  const [contactSheet, setContactSheet] = useState<Order | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const touchStartY = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const PULL_THRESHOLD = 60
  // Optimize route flow: "check" | "confirm" | "choose-last" | "optimizing" | "done" | null
  const [optimizeStep, setOptimizeStep] = useState<"check" | "confirm" | "choose-last" | "optimizing" | "done" | null>(null)
  const [selectedLastStop, setSelectedLastStop] = useState<string | null>(null)
  const [optimizeResult, setOptimizeResult] = useState<boolean>(false)

  // Redirect to login if no session
  useEffect(() => {
    if (!loadingSession && !session) {
      router.replace("/driver")
    }
  }, [loadingSession, session, router])

  // Show "You are online" toast only once per Go Online action
  useEffect(() => {
    if (justWentOnline) {
      setShowOnlineToast(true)
      consumeJustWentOnline()
      const timer = setTimeout(() => setShowOnlineToast(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [justWentOnline, consumeJustWentOnline])

  const handlePullRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setPullDistance(0)
    await refreshOrders()
    // Keep spinner visible briefly so user sees it
    setTimeout(() => setIsRefreshing(false), 600)
  }, [refreshOrders])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return
    const el = scrollContainerRef.current
    // Only allow pull when scrolled to the very top
    if (el && el.scrollTop > 0) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.5, 80))
    }
  }, [isRefreshing])

  const onTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD) {
      handlePullRefresh()
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, handlePullRefresh])

  /**
   * Advance an order to `next`, showing it immediately.
   *
   * The card is patched before the request goes out, so pressing a button
   * changes the card on the same frame. Previously each handler awaited the
   * POST and then awaited refreshOrders(), meaning two round trips had to
   * complete before anything moved — the spin-then-change drivers were
   * seeing on every tap.
   *
   * On a network failure the update is queued and the optimistic state is
   * *kept*: the write will replay, so reverting the card would be a lie and
   * would also lose the driver's place in the flow. Only a real server
   * rejection rolls back, since that is the one case where the new status
   * genuinely did not take.
   */
  async function advanceStatus(
    order: Order,
    next: "picked-up" | "in-transit",
    successToast: { title: string; description: string },
  ) {
    if (!session || inFlightRef.current.has(order.id)) return
    const previousStatus = order.status
    inFlightRef.current.add(order.id)
    void hapticTap("medium")
    patchOrder(order.id, { status: next })

    try {
      const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(order.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: session.id, status: next }),
      })
      if (!res.ok) throw new Error(`Failed to mark ${next}`)
      void hapticSuccess()
      // Customer WhatsApp + SMS + email are dispatched server-side from the
      // /api/driver/orders/[orderId]/status route after the in-transit update.
      toast(successToast)
    } catch (err) {
      const isNetworkError = !navigator.onLine || err instanceof TypeError
      if (isNetworkError) {
        queueStatusUpdate({
          id: `${order.id}_${Date.now()}`,
          orderId: order.id,
          orderNumber: order.orderNumber,
          driverId: session.id,
          status: next,
          queuedAt: Date.now(),
        })
        void hapticSuccess()
        toast({ title: "Saved offline", description: `${order.orderNumber} will sync when you reconnect.` })
      } else {
        patchOrder(order.id, { status: previousStatus })
        void hapticError()
        toast({ title: "Error", description: "Failed to update order.", variant: "destructive" })
      }
    } finally {
      inFlightRef.current.delete(order.id)
    }
  }

  function handleMarkPickedUp(order: Order) {
    void advanceStatus(order, "picked-up", {
      title: "Picked up",
      description: `${order.orderNumber} marked as picked up.`,
    })
  }

  function handleMarkOnTheWay(order: Order) {
    void advanceStatus(order, "in-transit", {
      title: "In transit",
      description: `${order.orderNumber} is now on the way.`,
    })
  }

  // Driver tapped the small back-arrow on a picked-up / in-transit card —
  // revert one step so they can re-press the previous action. The server
  // status route already supports picked-up → started and in-transit →
  // picked-up reverts (see the txn in app/(app)/api/driver/orders/[orderId]/status/route.ts).
  async function handleRevertStatus(order: Order) {
    if (!session || inFlightRef.current.has(order.id)) return
    const prevStatus =
      order.status === "picked-up" ? "started" :
      order.status === "in-transit" ? "picked-up" :
      null
    if (!prevStatus) return
    const currentStatus = order.status
    inFlightRef.current.add(order.id)
    void hapticTap("light")
    patchOrder(order.id, { status: prevStatus })
    try {
      const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(order.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: session.id, status: prevStatus }),
      })
      if (!res.ok) throw new Error("Failed to revert status")
    } catch {
      patchOrder(order.id, { status: currentStatus })
      void hapticError()
      toast({ title: "Error", description: "Could not undo last step.", variant: "destructive" })
    } finally {
      inFlightRef.current.delete(order.id)
    }
  }

  async function handleReportFailed() {
    if (!reportOrder || !session || !reportReason) return
    setActionPending(true)
    try {
      const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(reportOrder.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: session.id, status: "failed", failedReason: reportReason }),
      })
      if (!res.ok) throw new Error("Failed")
      toast({ title: "Reported", description: `${reportOrder.orderNumber} marked as failed.` })
      setReportOrder(null)
      setReportReason("")
    } catch {
      toast({ title: "Error", description: "Failed to report issue.", variant: "destructive" })
    } finally {
      setActionPending(false)
    }
  }

  function handleViewOrder(order: Order) {
    router.push(`/driver/order?id=${encodeURIComponent(order.id)}`)
  }

  const activeOrders = orders.filter(
    (o) => o.status === "started" || o.status === "picked-up" || o.status === "in-transit"
  )

  if (loadingSession || !session) return null

  // Offline state - Welcome screen (Screenshot 1)
  if (!isOnline) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-green-100 text-4xl font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">
          {driver?.name?.charAt(0)?.toUpperCase() ?? "D"}
        </div>
        <h1 className="mb-1 text-2xl font-bold">
          Hello, {driver?.name?.split(" ")[0]?.toLowerCase() ?? "driver"}
        </h1>
        <p className="mb-2 text-sm text-muted-foreground">Welcome back</p>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Start taking orders
        </p>
        <button
          type="button"
          onClick={goOnline}
          className="rounded-full bg-green-600 px-16 py-4 text-base font-semibold text-white shadow-lg hover:bg-green-700 active:scale-95 transition-transform"
        >
          Go Online
        </button>
      </div>
    )
  }

  // Online state - Orders list (Screenshot 2)
  return (
    <div
      ref={scrollContainerRef}
      className="mx-auto max-w-md px-4 pb-8 h-[calc(100vh-80px)] overflow-y-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        className="flex justify-center overflow-hidden transition-all duration-200"
        style={{ height: isRefreshing ? 48 : pullDistance > 0 ? pullDistance : 0 }}
      >
        <div className="flex items-center justify-center py-2">
          <RefreshCw
            className={`h-6 w-6 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`}
            style={{
              transform: isRefreshing ? undefined : `rotate(${pullDistance * 3}deg)`,
              opacity: isRefreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1),
            }}
          />
        </div>
      </div>
      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center justify-between bg-background py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-1.5 hover:bg-muted"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Orders</h1>
        </div>
        <div className="flex items-center gap-1">
          {activeOrders.length > 0 && (
            <button
              type="button"
              onClick={() => setRouteModalOpen(true)}
              className="rounded-lg p-2 hover:bg-muted"
              title="Route Options"
            >
              <Navigation className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Pending-sync and GPS warnings now live in DriverStatusBanner, rendered
          by the shell so they follow the driver onto every screen instead of
          only appearing here on the dashboard. */}

      {/* Online toast notification */}
      {showOnlineToast && (
        <div className="mb-3 rounded-xl bg-green-600 px-4 py-2.5 text-center text-sm font-medium text-white shadow-lg animate-in fade-in slide-in-from-top-2">
          You are online and accepting orders
        </div>
      )}

      {/* Orders list.
          The spinner is gated on having nothing to show, not merely on
          loadingOrders. Otherwise every refresh — the map's 15s poll, a
          pull-to-refresh, or simply reopening the app — replaced a perfectly
          good list of deliveries with a spinner for the duration of the
          request, which is the "lazy loading" drivers were seeing even though
          the orders were already cached on the device. */}
      {loadingOrders && orders.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : activeOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Truck className="mb-3 h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No active orders</p>
          <p className="text-xs text-muted-foreground">New orders will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeOrders.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="mb-2 flex items-start justify-between">
                <div className="flex-1" onClick={() => handleViewOrder(order)}>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{order.orderNumber}</p>
                    <StatusBadge status={order.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{order.customerName}</p>
                </div>
                {order.status !== "started" && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setNavSheet(order)}
                      className="rounded-lg p-1.5 hover:bg-muted"
                      title="Navigate"
                    >
                      <Navigation className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setContactSheet(order)}
                      className="rounded-lg p-1.5 hover:bg-muted"
                      title="Contact"
                    >
                      <Phone className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </button>
                  </div>
                )}
              </div>

              <div className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{order.address}</span>
              </div>

              {/* Action button — pill-shaped to match driver-app.
                  Started has just the orange action button (no back arrow:
                  nothing to revert to). Picked-up and in-transit show a
                  small back arrow that reverts one step via handleRevertStatus. */}
              {order.status === "started" && (
                <button
                  type="button"
                  onClick={() => handleMarkPickedUp(order)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 py-3.5 text-sm font-bold text-white hover:bg-orange-600 active:scale-[0.98] transition-transform"
                >
                  Mark as Picked Up  →
                </button>
              )}
              {order.status === "picked-up" && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRevertStatus(order)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
                    title="Back to Started"
                    aria-label="Back to Started"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMarkOnTheWay(order)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-green-500 py-3.5 text-sm font-bold text-white hover:bg-green-600 active:scale-[0.98] transition-transform"
                  >
                    Mark as On the way  →
                  </button>
                  <button
                    type="button"
                    onClick={() => { setReportOrder(order); setReportReason("") }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-destructive/30 text-destructive hover:bg-destructive/10"
                    title="Report issue"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </button>
                </div>
              )}
              {order.status === "in-transit" && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRevertStatus(order)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
                    title="Back to Picked Up"
                    aria-label="Back to Picked Up"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { void hapticTap("medium"); router.push(`/driver/delivery?id=${encodeURIComponent(order.id)}`) }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-700 py-3.5 text-sm font-bold text-white hover:bg-emerald-800 active:scale-[0.98] transition-transform"
                  >
                    Mark as Complete  →
                  </button>
                  <button
                    type="button"
                    onClick={() => { setReportOrder(order); setReportReason("") }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-destructive/30 text-destructive hover:bg-destructive/10"
                    title="Report issue"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Route Options Modal */}
      {routeModalOpen && !optimizeStep && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setRouteModalOpen(false)}
          />
          <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border-2 border-yellow-400 bg-background p-6 shadow-2xl">
            <h3 className="mb-5 text-center text-lg font-bold">Route Options</h3>
            <div className="space-y-3">
              <button
                type="button"
                className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                onClick={async () => {
                  setRouteModalOpen(false)
                  const started = activeOrders.filter((o) => o.status === "started")
                  if (started.length === 0) {
                    toast({ title: "All orders already picked up" })
                    return
                  }
                  toast({ title: `Picking up ${started.length} order${started.length > 1 ? "s" : ""}...` })
                  let failed = 0
                  for (const order of started) {
                    try {
                      const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(order.id)}/status`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ driverId: session?.id, status: "picked-up" }),
                      })
                      if (!res.ok) failed++
                    } catch {
                      failed++
                    }
                  }
                  await refreshOrders()
                  if (failed > 0) {
                    toast({ title: "Some orders failed", description: `${failed} order(s) could not be updated.`, variant: "destructive" })
                  } else {
                    toast({ title: "All orders picked up" })
                  }
                }}
              >
                Pick Up All Orders
              </button>
              <button
                type="button"
                className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700"
                onClick={() => {
                  setRouteModalOpen(false)
                  const allPickedUp = activeOrders.every(
                    (o) => o.status === "picked-up" || o.status === "in-transit"
                  )
                  setOptimizeStep(allPickedUp ? "confirm" : "check")
                }}
              >
                Optimize Route
              </button>
              <button
                type="button"
                className="w-full rounded-xl border-2 border-muted-foreground/30 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
                onClick={() => setRouteModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}

      {/* Optimize Step 1: "all orders must be picked up" */}
      {optimizeStep === "check" && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" />
          <div className="fixed inset-x-6 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border-2 border-yellow-400 bg-background p-6 shadow-2xl">
            <p className="mb-6 text-center text-base font-semibold">
              For route optimization, all orders must be picked up
            </p>
            <button
              type="button"
              className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700"
              onClick={() => setOptimizeStep(null)}
            >
              OK
            </button>
          </div>
        </>
      )}

      {/* Optimize Step 2: "Do you want to re-optimize route?" */}
      {optimizeStep === "confirm" && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" />
          <div className="fixed inset-x-6 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl bg-background p-6 shadow-2xl">
            <p className="mb-6 text-center text-base font-semibold">
              Do you want to re-optimize route?
            </p>
            <div className="space-y-3">
              <button
                type="button"
                className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700"
                onClick={() => {
                  setSelectedLastStop(null)
                  setOptimizeStep("choose-last")
                }}
              >
                Yes
              </button>
              <button
                type="button"
                className="w-full rounded-xl border py-3 text-sm font-semibold text-foreground hover:bg-muted"
                onClick={() => setOptimizeStep(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Optimize Step 3: "Choose the last stop" bottom sheet */}
      {optimizeStep === "choose-last" && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setOptimizeStep(null)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4">
            <div className="rounded-t-2xl bg-background px-5 pb-6 pt-4 shadow-2xl">
              <div className="mb-4 flex justify-center">
                <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              </div>
              <h3 className="mb-4 text-center text-base font-bold">
                Choose the last stop (optional)
              </h3>
              <div className="mb-4 max-h-60 space-y-3 overflow-y-auto">
                {activeOrders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted"
                    onClick={() => setSelectedLastStop(order.id)}
                  >
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40">
                      {selectedLastStop === order.id && (
                        <div className="h-3 w-3 rounded-full bg-green-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{order.address}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  className="w-full rounded-xl border py-3 text-sm font-semibold text-foreground hover:bg-muted"
                  onClick={async () => {
                    setOptimizeStep("optimizing")
                    const ok = await optimizeRoute(selectedLastStop)
                    setOptimizeResult(ok)
                    setOptimizeStep("done")
                  }}
                >
                  Choose
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700"
                  onClick={async () => {
                    setSelectedLastStop(null)
                    setOptimizeStep("optimizing")
                    const ok = await optimizeRoute(null)
                    setOptimizeResult(ok)
                    setOptimizeStep("done")
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Optimize Step 4: Optimizing in progress */}
      {optimizeStep === "optimizing" && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" />
          <div className="fixed inset-x-6 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl bg-background p-6 shadow-2xl">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              <p className="text-center text-base font-semibold">
                Optimizing your route...
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Report Issue / Failed Delivery Modal ── */}
      {reportOrder && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setReportOrder(null)} />
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4">
            <div className="rounded-t-2xl bg-background px-5 pb-8 pt-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-bold">Report Issue</h3>
                <button type="button" onClick={() => setReportOrder(null)} className="rounded-lg p-1.5 hover:bg-muted">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">What happened with <span className="font-semibold text-foreground">{reportOrder.orderNumber}</span>? This will mark the delivery as failed.</p>
              <div className="mb-4 space-y-2">
                {["Customer not home", "Wrong address / cannot find location", "Customer refused delivery", "Access denied / gated area", "Item damaged", "Other"].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReportReason(r)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${reportReason === r ? "border-orange-400 bg-orange-50 text-orange-700" : "hover:bg-muted"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!reportReason || actionPending}
                onClick={handleReportFailed}
                className="w-full rounded-xl bg-orange-500 py-3.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {actionPending ? "Reporting..." : "Mark as Failed Delivery"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Optimize Step 5: Done confirmation */}
      {optimizeStep === "done" && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" />
          <div className="fixed inset-x-6 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border-2 border-yellow-400 bg-background p-6 shadow-2xl">
            <p className="mb-6 text-center text-base font-semibold">
              {optimizeResult ? "Route optimized! Orders resorted." : "Could not optimize route. Make sure orders have addresses."}
            </p>
            <button
              type="button"
              className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700"
              onClick={() => {
                setOptimizeStep(null)
              }}
            >
              OK
            </button>
          </div>
        </>
      )}

      {/* ── Navigate action sheet ─────────────────────────────────────────
          Lets the driver choose Customer vs Pickup destination and opens
          the chosen route in their preferred map app (Google/Waze/Apple),
          matching the driver-app native flow. */}
      {navSheet && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setNavSheet(null)} />
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4">
            <div
              className="rounded-t-2xl bg-background px-2 pt-3"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <button
                type="button"
                className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted"
                onClick={() => {
                  const o = navSheet
                  setNavSheet(null)
                  setTimeout(() => window.open(buildNavUrl(o.address, getNavApp()), "_blank", "noopener"), 200)
                }}
              >
                <Navigation className="h-5 w-5 text-foreground" />
                <span className="text-base font-semibold">Navigate to Customer</span>
              </button>
              <div className="h-px bg-border" />
              <button
                type="button"
                className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted"
                onClick={() => {
                  setNavSheet(null)
                  setTimeout(() => window.open(buildNavUrl(HUB_ADDRESS, getNavApp()), "_blank", "noopener"), 200)
                }}
              >
                <Navigation className="h-5 w-5 text-foreground" />
                <span className="text-base font-semibold">Navigate to Pick Up Location</span>
              </button>
            </div>
            <button
              type="button"
              className="mt-2 w-[calc(100%-1rem)] mx-2 rounded-2xl bg-background py-4 text-center text-base font-bold shadow"
              onClick={() => setNavSheet(null)}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── Contact action sheet ──────────────────────────────────────────
          Pickup phone, customer phone, SMS, WhatsApp — the same set
          driver-app shows, so a driver switching between apps doesn't
          have to relearn anything. */}
      {contactSheet && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setContactSheet(null)} />
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4">
            <div
              className="rounded-t-2xl bg-background px-2 pt-3"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <p className="mb-2 text-center text-base font-bold">Contact</p>
              {[
                { icon: Phone,         label: "Call pickup",     value: HUB_PHONE,                  action: () => { window.location.href = `tel:${HUB_PHONE}` } },
                { icon: Phone,         label: "Call customer",   value: contactSheet.phone ?? "",   action: () => { if (contactSheet.phone) window.location.href = `tel:${contactSheet.phone}` } },
                { icon: MessageSquare, label: "Text Customer",   value: contactSheet.phone ?? "",   action: () => { if (contactSheet.phone) window.location.href = `sms:${contactSheet.phone}` } },
                { icon: MessageCircle, label: "WhatsApp customer", value: contactSheet.phone ?? "", action: () => {
                  if (!contactSheet.phone) return
                  const cleaned = contactSheet.phone.replace(/\D/g, "")
                  setTimeout(() => window.open(`https://wa.me/${cleaned}`, "_blank", "noopener"), 200)
                } },
              ].map((item, i) => (
                <div key={i}>
                  {i > 0 && <div className="h-px bg-border" />}
                  <button
                    type="button"
                    onClick={() => { const a = item.action; setContactSheet(null); setTimeout(a, 150) }}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.value}</p>
                    </div>
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 w-[calc(100%-1rem)] mx-2 rounded-2xl bg-background py-4 text-center text-base font-bold shadow"
              onClick={() => setContactSheet(null)}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
