"use client"

import { useState, useEffect, useMemo } from "react"
import { Spinner } from "@/components/ui/spinner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  GripVertical,
  Search,
  Clock,
  Copy,
  CheckCircle2,
  XCircle,
  UserMinus,
  Zap,
  AlertTriangle,
  Package,
  Users,
  Truck,
  Phone,
  MessageCircle,
  ArrowLeftRight,
} from "lucide-react"
import { subscribeOrdersRealtime, subscribeDriversRealtime, updateOrder } from "@/lib/firestore"
import { formatCurrency } from "@/lib/data"
import type { Order, Driver } from "@/lib/data"
import { StatusBadge } from "@/components/orders/status-badge"
import { ORDER_STATUS, DRIVER_STATUS, TERMINAL_STATUSES } from "@/lib/constants"
import type { OrderStatus } from "@/lib/constants"
import { auth } from "@/lib/firebase"
import { formatDistanceToNow } from "date-fns"

/* ── helpers ─────────────────────────────────────────────── */

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function toMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  if (typeof value === "object" && "seconds" in (value as object))
    return (value as { seconds: number }).seconds * 1000
  return new Date(value as string).getTime() || 0
}

function timeAgo(val: unknown): string {
  const ms = toMs(val)
  if (!ms) return "never"
  try { return formatDistanceToNow(new Date(ms), { addSuffix: true }) } catch { return "" }
}

function waitingTime(val: unknown): string {
  const ms = toMs(val)
  if (!ms) return ""
  const mins = Math.floor((Date.now() - ms) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function isOverdue(order: Order): boolean {
  const activeStatuses: OrderStatus[] = [ORDER_STATUS.STARTED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.IN_TRANSIT]
  if (!activeStatuses.includes(order.status)) return false
  const started = toMs(order.startedAt)
  return started > 0 && Date.now() - started > 3 * 60 * 60 * 1000
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

/* ── stat card ───────────────────────────────────────────── */
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className={`flex size-9 items-center justify-center rounded-lg ${color}`}>{icon}</div>
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground">{value}</p>
      </div>
    </div>
  )
}

function formatTs(val: unknown): string {
  if (!val) return ""
  const d = val instanceof Date ? val : typeof val === "object" && "toDate" in (val as Record<string, unknown>) ? (val as { toDate(): Date }).toDate() : new Date(val as string)
  return d.toLocaleString("en-NG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/* ── timeline card ───────────────────────────────────────── */

function OrderTimeline({ order }: { order: Order }) {
  const pickupLabel = order.pickupName || "Pickup"
  const pickupAddr = order.pickupAddress || "—"
  const deliveryAddr = order.address || "—"

  return (
    <div className="relative flex gap-3 px-3 py-3">
      {/* dots + dashed line */}
      <div className="flex flex-col items-center pt-1">
        <span className="z-10 size-2.5 rounded-full bg-muted-foreground/50" />
        <span className="my-0.5 w-px flex-1 border-l border-dashed border-muted-foreground/30" />
        <span className="z-10 size-2.5 rounded-full bg-emerald-500" />
      </div>

      {/* text */}
      <div className="flex flex-1 flex-col gap-3 min-w-0">
        {/* pickup */}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{pickupLabel}</p>
          <p className="truncate text-xs text-muted-foreground">{pickupAddr}</p>
          {order.startedAt ? <p className="mt-0.5 text-[11px] text-muted-foreground/70">{formatTs(order.startedAt)}</p> : null}
        </div>
        {/* delivery */}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{order.customerName}</p>
          <p className="truncate text-xs text-muted-foreground">{deliveryAddr}</p>
          {order.deliveredAt ? <p className="mt-0.5 text-[11px] text-muted-foreground/70">{formatTs(order.deliveredAt)}</p> : null}
        </div>
      </div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────── */

export default function DispatchPage() {
  const [orderList, setOrderList] = useState<Order[]>([])
  const [allDrivers, setAllDrivers] = useState<Driver[]>([])
  const [selectedDrivers, setSelectedDrivers] = useState<Record<string, string>>({})
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [activePanel, setActivePanel] = useState<"drivers" | "assigned" | "unassigned">("drivers")
  const [unassignedSearch, setUnassignedSearch] = useState("")

  async function getAdminHeaders(): Promise<Record<string, string>> {
    const token = await auth.currentUser?.getIdToken()
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  useEffect(() => {
    setIsLoading(true)

    const unsubOrders = subscribeOrdersRealtime((data) => {
      setOrderList(data)
      setIsLoading(false)
      setError(null)
    })

    const unsubDrivers = subscribeDriversRealtime((data) => {
      setAllDrivers(data)
    })

    return () => {
      unsubOrders()
      unsubDrivers()
    }
  }, [])

  useEffect(() => {
    if (allDrivers.length === 0) {
      setActiveDriverId(null)
      return
    }

    if (!activeDriverId || !allDrivers.some((d) => d.id === activeDriverId)) {
      setActiveDriverId(allDrivers[0].id)
    }
  }, [allDrivers, activeDriverId])

  const availableDrivers = useMemo(
    () => allDrivers.filter((d) => d.status === DRIVER_STATUS.AVAILABLE || d.status === DRIVER_STATUS.ON_DELIVERY),
    [allDrivers]
  )
  const onlineDrivers = useMemo(() => allDrivers.filter((d) => d.status !== DRIVER_STATUS.OFFLINE), [allDrivers])
  const offlineDrivers = useMemo(() => allDrivers.filter((d) => d.status === DRIVER_STATUS.OFFLINE), [allDrivers])

  const pendingOrders = useMemo(() => {
    const q = unassignedSearch.trim().toLowerCase()
    return orderList
      .filter((o) => o.status === ORDER_STATUS.UNASSIGNED)
      .filter((o) => !q || o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || (o.address?.toLowerCase().includes(q) ?? false))
  }, [orderList, unassignedSearch])

  const assignedOrders = useMemo(
    () => orderList
      .filter((o) => o.assignedDriver === activeDriverId && o.status !== ORDER_STATUS.UNASSIGNED && !TERMINAL_STATUSES.includes(o.status))
      .sort((a, b) => (a.routeOrder ?? Infinity) - (b.routeOrder ?? Infinity)),
    [orderList, activeDriverId]
  )

  const totalUnassigned = orderList.filter((o) => o.status === ORDER_STATUS.UNASSIGNED).length
  const totalActive = orderList.filter((o) => !TERMINAL_STATUSES.includes(o.status) && o.status !== ORDER_STATUS.UNASSIGNED).length
  const totalOnline = onlineDrivers.length
  const totalAvailable = availableDrivers.filter((d) => d.status === DRIVER_STATUS.AVAILABLE).length

  function driverOrderCounts(driverId: string) {
    const orders = orderList.filter((o) => o.assignedDriver === driverId && !TERMINAL_STATUSES.includes(o.status) && o.status !== ORDER_STATUS.UNASSIGNED)
    return {
      total: orders.length,
      started: orders.filter((o) => o.status === ORDER_STATUS.STARTED).length,
      pickedUp: orders.filter((o) => o.status === ORDER_STATUS.PICKED_UP).length,
      inTransit: orders.filter((o) => o.status === ORDER_STATUS.IN_TRANSIT).length,
    }
  }

  function handleSelectDriver(orderId: string, driverId: string) {
    setSelectedDrivers((prev) => ({ ...prev, [orderId]: driverId }))
  }

  async function handleDispatch(orderId: string, preferredDriverId?: string) {
    const driverId = preferredDriverId ?? selectedDrivers[orderId]
    if (!driverId) return

    try {
      setIsSaving(true)
      const startedAt = new Date()
      const targetOrder = orderList.find((o) => o.id === orderId)
      const res = await fetch("/api/admin/dispatch/assign", {
        method: "POST",
        headers: await getAdminHeaders(),
        body: JSON.stringify({
          orderId,
          driverId,
        }),
      })
      if (!res.ok) throw new Error("Failed to dispatch order")

      setOrderList((prev) =>
        prev.map((order) =>
          order.id === orderId
            ? { ...order, assignedDriver: driverId, status: ORDER_STATUS.STARTED, startedAt }
            : order
        )
      )
      setSelectedDrivers((prev) => {
        const next = { ...prev }
        delete next[orderId]
        return next
      })

      // order_accepted notification is fired server-side from the dispatch/assign
      // API route — no need to fire it here too (would cause duplicate WhatsApp/email)

      // driver list updates automatically via realtime subscription
    } catch (err) {
      console.error("Error dispatching order:", err)
      setError("Failed to dispatch order")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDrop(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const reordered = [...assignedOrders]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const orderedIds = reordered.map((o) => o.id)
    // optimistic local update
    setOrderList((prev) => {
      const next = [...prev]
      for (let i = 0; i < orderedIds.length; i++) {
        const idx = next.findIndex((o) => o.id === orderedIds[i])
        if (idx !== -1) next[idx] = { ...next[idx], routeOrder: i }
      }
      return next
    })
    const res = await fetch("/api/admin/dispatch/reorder", {
      method: "POST",
      headers: await getAdminHeaders(),
      body: JSON.stringify({ orderedIds }),
    })
    if (!res.ok) setError("Failed to save route order")
  }

  async function handleUnassign(order: Order) {
    try {
      setIsSaving(true)
      await updateOrder(order.id, { assignedDriver: null, status: ORDER_STATUS.UNASSIGNED })
    } catch {
      setError("Failed to unassign order")
    } finally { setIsSaving(false) }
  }

  async function handleQuickStatus(order: Order, status: "delivered" | "failed") {
    try {
      setIsSaving(true)
      const updates: Partial<Order> = { status }
      if (status === "delivered") updates.deliveredAt = new Date()
      await updateOrder(order.id, updates)
    } catch {
      setError("Failed to update order status")
    } finally { setIsSaving(false) }
  }

  async function handleAutoAssign() {
    const unassigned = orderList.filter((o) => o.status === ORDER_STATUS.UNASSIGNED)
    if (!unassigned.length || !availableDrivers.length) return
    setIsSaving(true)
    try {
      const headers = await getAdminHeaders()
      await Promise.all(
        unassigned.map((order, i) => {
          const driver = availableDrivers[i % availableDrivers.length]
          return fetch("/api/admin/dispatch/assign", {
            method: "POST",
            headers,
            body: JSON.stringify({ orderId: order.id, driverId: driver.id }),
          })
        })
      )
    } catch {
      setError("Auto-assign failed")
    } finally { setIsSaving(false) }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dispatch</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dispatch center for drivers and order assignment</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Package className="size-4 text-yellow-600" />} label="Unassigned" value={totalUnassigned} color="bg-yellow-500/10" />
        <StatCard icon={<Truck className="size-4 text-blue-600" />} label="Active orders" value={totalActive} color="bg-blue-500/10" />
        <StatCard icon={<Users className="size-4 text-emerald-600" />} label="Drivers online" value={totalOnline} color="bg-emerald-500/10" />
        <StatCard icon={<Zap className="size-4 text-emerald-600" />} label="Available" value={totalAvailable} color="bg-emerald-500/10" />
      </div>

      {/* Auto-assign button */}
      {totalUnassigned > 0 && availableDrivers.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleAutoAssign}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
          >
            <Zap className="size-4" />
            Auto-assign {totalUnassigned} order{totalUnassigned !== 1 ? "s" : ""} to {availableDrivers.length} driver{availableDrivers.length !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        {/* Mobile tab switcher */}
        <div className="flex border-b xl:hidden">
          {(["drivers", "assigned", "unassigned"] as const).map((panel) => (
            <button
              key={panel}
              type="button"
              onClick={() => setActivePanel(panel)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                activePanel === panel ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
              }`}
            >
              {panel === "drivers" ? `Drivers (${allDrivers.length})` : panel === "assigned" ? `Assigned (${assignedOrders.length})` : `Unassigned (${totalUnassigned})`}
            </button>
          ))}
        </div>
        <div className="grid gap-0 xl:grid-cols-[260px_1fr_1fr]">
        {/* ── Drivers sidebar ────────────────────────────── */}
        <div className={`border-r ${activePanel === "drivers" ? "block" : "hidden xl:block"}`}>
          <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
            Drivers <span className="ml-1 text-xs font-normal text-muted-foreground">({allDrivers.length})</span>
          </div>
          <div className="max-h-[75vh] overflow-y-auto">
            {allDrivers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No drivers found.</p>
            ) : (
              <>
                {/* Online section */}
                {onlineDrivers.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Online</div>
                    {onlineDrivers.map((driver) => {
                      const isActive = activeDriverId === driver.id
                      const counts = driverOrderCounts(driver.id)
                      const statusColor = driver.status === DRIVER_STATUS.AVAILABLE ? "bg-emerald-500" : "bg-amber-400"
                      const statusLabel = driver.status === DRIVER_STATUS.AVAILABLE ? "Available" : "On Delivery"
                      return (
                        <button
                          key={driver.id}
                          onClick={() => setActiveDriverId(driver.id)}
                          className={`flex w-full items-center gap-3 border-l-[3px] px-3 py-3 text-left transition-colors ${isActive ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-transparent hover:bg-secondary/50"}`}
                        >
                          <div className="relative">
                            <Avatar className="size-9 shrink-0">
                              <AvatarFallback className={isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : ""}>
                                {getInitials(driver.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background ${statusColor}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{driver.name}</p>
                            <p className="text-[10px] text-muted-foreground">{statusLabel}</p>
                            {!!driver.lastPingAt && (
                              <p className="text-[10px] text-muted-foreground/60">{timeAgo(driver.lastPingAt)}</p>
                            )}
                            {counts.total > 0 && (
                              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                {counts.started > 0 && <span className="rounded bg-blue-500/10 px-1 text-[9px] text-blue-600">{counts.started} started</span>}
                                {counts.pickedUp > 0 && <span className="rounded bg-amber-500/10 px-1 text-[9px] text-amber-600">{counts.pickedUp} picked</span>}
                                {counts.inTransit > 0 && <span className="rounded bg-purple-500/10 px-1 text-[9px] text-purple-600">{counts.inTransit} transit</span>}
                              </div>
                            )}
                            {/* capacity bar */}
                            <div className="mt-1 flex items-center gap-1">
                              <div className="h-1 w-14 overflow-hidden rounded-full bg-muted">
                                <div className={`h-full rounded-full ${counts.total >= 4 ? "bg-destructive" : counts.total >= 2 ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(100, (counts.total / 5) * 100)}%` }} />
                              </div>
                              <span className="text-[9px] text-muted-foreground">{counts.total}/5</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            {driver.phone && (
                              <a href={`tel:${driver.phone}`} onClick={(e) => e.stopPropagation()} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Call driver">
                                <Phone className="size-3.5" />
                              </a>
                            )}
                            {driver.phone && (
                              <a href={`https://wa.me/${driver.phone.replace(/\D/g,"")}?text=${encodeURIComponent("Hey! Please check your order status.")}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-green-500" aria-label="WhatsApp driver">
                                <MessageCircle className="size-3.5" />
                              </a>
                            )}
                            {counts.total > 0 && (
                              <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">{counts.total}</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Offline section */}
                {offlineDrivers.length > 0 && (
                  <>
                    <div className="mt-1 border-t px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Offline</div>
                    {offlineDrivers.map((driver) => {
                      const isActive = activeDriverId === driver.id
                      const counts = driverOrderCounts(driver.id)
                      return (
                        <button
                          key={driver.id}
                          onClick={() => setActiveDriverId(driver.id)}
                          className={`flex w-full items-center gap-3 border-l-[3px] px-3 py-3 text-left opacity-50 transition-colors ${isActive ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-transparent hover:bg-secondary/50"}`}
                        >
                          <div className="relative">
                            <Avatar className="size-9 shrink-0">
                              <AvatarFallback>{getInitials(driver.name)}</AvatarFallback>
                            </Avatar>
                            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-muted-foreground/40" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{driver.name}</p>
                            <p className="text-[10px] text-muted-foreground">Offline</p>
                            {!!driver.lastPingAt && (
                              <p className="text-[10px] text-muted-foreground/60">{timeAgo(driver.lastPingAt)}</p>
                            )}
                          </div>
                          {counts.total > 0 && (
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">{counts.total}</span>
                          )}
                        </button>
                      )
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Assigned orders ────────────────────────────── */}
        <div className={`border-r ${activePanel === "assigned" ? "block" : "hidden xl:block"}`}>
          <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
            Assigned Orders <span className="ml-1 text-xs font-normal text-muted-foreground">({assignedOrders.length})</span>
          </div>
          <div className="max-h-[75vh] space-y-3 overflow-y-auto p-3">
            {assignedOrders.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">No active orders for this driver.</p>
            ) : (
              assignedOrders.map((order, idx) => (
                <div
                  key={order.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
                  onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                  onDrop={() => { if (dragIdx !== null) handleDrop(dragIdx, idx); setDragIdx(null); setDragOverIdx(null) }}
                  className={`overflow-hidden rounded-lg border bg-background shadow-sm transition-opacity ${
                    dragIdx === idx ? "opacity-50" : ""
                  } ${dragOverIdx === idx && dragIdx !== idx ? "ring-2 ring-emerald-500/50" : ""} ${isOverdue(order) ? "border-destructive/40" : ""}`}
                >
                  {/* card header */}
                  <div className="flex items-center gap-2 border-b px-3 py-2.5">
                    <StatusBadge status={order.status} />
                    <span className="text-sm font-semibold text-foreground">{order.orderNumber}</span>
                    {isOverdue(order) && (
                      <span className="flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        <AlertTriangle className="size-2.5" aria-label="Overdue" />Overdue
                      </span>
                    )}
                    <span className="ml-auto text-sm font-semibold text-foreground">{formatCurrency(order.amount)}</span>
                    {order.phone && (
                      <button onClick={() => copyToClipboard(order.phone)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Copy phone">
                        <Copy className="size-3.5" />
                      </button>
                    )}
                    <Select
                      value={selectedDrivers[order.id] ?? ""}
                      onValueChange={(value) => handleSelectDriver(order.id, value)}
                    >
                      <SelectTrigger className="h-7 w-[120px] text-xs">
                        <SelectValue placeholder="Reassign" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDrivers.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            <span className="flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${d.status === DRIVER_STATUS.AVAILABLE ? "bg-green-500" : "bg-orange-400"}`} />
                              {d.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <button
                      className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-secondary cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </button>
                  </div>

                  {/* distance + ETA */}
                  {order.distanceKm != null && (
                    <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                      <span>{order.distanceKm.toFixed(1)} km</span>
                      <span>·</span>
                      <span>~{Math.round(order.distanceKm / 0.5)} min ETA</span>
                    </div>
                  )}

                  {/* pickup → delivery timeline */}
                  <OrderTimeline order={order} />

                  {/* actions footer */}
                  <div className="flex items-center gap-1 border-t px-3 py-2">
                    <button
                      onClick={() => handleUnassign(order)}
                      disabled={isSaving}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      <UserMinus className="size-3" />Unassign
                    </button>
                    {/* Reassign dropdown */}
                    <Select
                      value={selectedDrivers[order.id] ?? ""}
                      onValueChange={(value) => handleSelectDriver(order.id, value)}
                    >
                      <SelectTrigger className="h-6 w-[90px] text-[10px] border-dashed text-muted-foreground">
                        <ArrowLeftRight className="size-2.5" />
                        <SelectValue placeholder="Reassign" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDrivers.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            <span className="flex items-center gap-1.5 text-xs">
                              <span className={`h-1.5 w-1.5 rounded-full ${d.status === DRIVER_STATUS.AVAILABLE ? "bg-green-500" : "bg-orange-400"}`} />
                              {d.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => handleQuickStatus(order, "delivered")}
                        disabled={isSaving}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
                      >
                        <CheckCircle2 className="size-3" />Delivered
                      </button>
                      <button
                        onClick={() => handleQuickStatus(order, "failed")}
                        disabled={isSaving}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        <XCircle className="size-3" />Failed
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Unassigned / New orders ────────────────────── */}
        <div className={activePanel === "unassigned" ? "block" : "hidden xl:block"}>
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <span className="text-sm font-semibold text-foreground">
              Unassigned <span className="ml-1 text-xs font-normal text-muted-foreground">({totalUnassigned})</span>
            </span>
            <div className="relative ml-auto">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search…"
                value={unassignedSearch}
                onChange={(e) => setUnassignedSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setUnassignedSearch("")}
                className="h-7 w-40 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="max-h-[75vh] space-y-3 overflow-y-auto p-3">
            {pendingOrders.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">
                {unassignedSearch ? "No orders match your search." : "No pending orders."}
              </p>
            ) : (
              pendingOrders.map((order) => {
                const ageMs = Date.now() - toMs(order.createdAt)
                const agingColor = ageMs > 2 * 60 * 60 * 1000 ? "border-l-4 border-l-red-500" : ageMs > 30 * 60 * 1000 ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-green-400"
                return (
                <div key={order.id} className={`overflow-hidden rounded-lg border bg-background shadow-sm ${agingColor}`}>
                  {/* card header */}
                  <div className="flex items-center gap-2 border-b px-3 py-2.5">
                    <span className="text-sm font-semibold text-foreground">{order.orderNumber}</span>
                    {!!order.createdAt && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Clock className="size-2.5" />{waitingTime(order.createdAt)}
                      </span>
                    )}
                    <span className="ml-auto text-sm font-semibold text-foreground">{formatCurrency(order.amount)}</span>
                    {order.phone && (
                      <button onClick={() => copyToClipboard(order.phone)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Copy phone">
                        <Copy className="size-3.5" />
                      </button>
                    )}
                    <Select onValueChange={(value) => handleDispatch(order.id, value)}>
                      <SelectTrigger className="h-7 w-[120px] rounded-md border bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <SelectValue placeholder="+ Assign" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDrivers.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">No online drivers</div>
                        ) : (
                          availableDrivers.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              <span className="flex items-center gap-1.5">
                                <span className={`h-1.5 w-1.5 rounded-full ${d.status === DRIVER_STATUS.AVAILABLE ? "bg-green-500" : "bg-orange-400"}`} />
                                {d.name}
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* distance */}
                  {order.distanceKm != null && (
                    <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                      <span>{order.distanceKm.toFixed(1)} km</span>
                      <span>·</span>
                      <span>~{Math.round(order.distanceKm / 0.5)} min ETA</span>
                    </div>
                  )}

                  {/* pickup → delivery timeline */}
                  <OrderTimeline order={order} />
                </div>
                )
              })
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
