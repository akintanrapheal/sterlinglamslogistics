"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Package,
  Clock,
  Users,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Star,
  AlertTriangle,
  Truck,
  CircleDot,
  Zap,
  Trophy,
  Activity,
  XCircle,
  Target,
  Plus,
  Flame,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts"
import { format, startOfDay, subDays, getHours, subWeeks, startOfWeek, eachWeekOfInterval } from "date-fns"
import { subscribeOrdersRealtime, subscribeDriversRealtime } from "@/lib/firestore"
import { formatCurrency } from "@/lib/data"
import type { Order, Driver } from "@/lib/data"
import { StatusBadge } from "@/components/orders/status-badge"
import { ORDER_STATUS, DRIVER_STATUS } from "@/lib/constants"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().getTime()
  }
  if (typeof value === "number") return value
  return 0
}

function delta(current: number, previous: number): { pct: number; up: boolean } {
  if (previous === 0) return { pct: 0, up: true }
  const pct = ((current - previous) / previous) * 100
  return { pct: Math.abs(Math.round(pct)), up: pct >= 0 }
}

function avgDeliveryTimeMin(orders: Order[]): number {
  const times = orders
    .filter((o) => o.status === ORDER_STATUS.DELIVERED && toMs(o.deliveredAt) && (toMs(o.startedAt) || toMs(o.pickedUpAt)))
    .map((o) => (toMs(o.deliveredAt) - (toMs(o.startedAt) || toMs(o.pickedUpAt))) / 60000)
    .filter((t) => t > 0 && t < 600)
  return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0
}

function successRate(orders: Order[]): number {
  const terminal = orders.filter((o) =>
    [ORDER_STATUS.DELIVERED, ORDER_STATUS.FAILED, ORDER_STATUS.CANCELLED].includes(o.status as never)
  )
  if (!terminal.length) return 0
  const delivered = terminal.filter((o) => o.status === ORDER_STATUS.DELIVERED).length
  return Math.round((delivered / terminal.length) * 100)
}

// ---------------------------------------------------------------------------
// Delta badge
// ---------------------------------------------------------------------------

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const d = delta(current, previous)
  if (previous === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${d.up ? "text-success" : "text-destructive"}`}>
      {d.up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {d.pct}%
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("dashboardDailyGoal") ?? "0") || 0 } catch { return 0 }
  })
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState("")
  const goalInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsubOrders = subscribeOrdersRealtime((data) => {
      setOrders(data)
      setIsLoading(false)
      setLastUpdated(new Date())
    })
    const unsubDrivers = subscribeDriversRealtime((data) => {
      setDrivers(data)
    })
    return () => { unsubOrders(); unsubDrivers() }
  }, [])

  const driverMap = useMemo(() => {
    const m = new Map<string, Driver>()
    drivers.forEach((d) => m.set(d.id, d))
    return m
  }, [drivers])

  // ── Time boundaries ──
  const todayStart = startOfDay(new Date()).getTime()
  const yesterdayStart = startOfDay(subDays(new Date(), 1)).getTime()

  const todayOrders = useMemo(() => orders.filter((o) => toMs(o.createdAt) >= todayStart), [orders, todayStart])
  const yesterdayOrders = useMemo(
    () => orders.filter((o) => toMs(o.createdAt) >= yesterdayStart && toMs(o.createdAt) < todayStart),
    [orders, todayStart, yesterdayStart]
  )

  // ── Stat computations ──
  const totalRevenue = useMemo(() => orders.reduce((s, o) => s + (o.amount ?? 0), 0), [orders])
  const todayRevenue = useMemo(() => todayOrders.reduce((s, o) => s + (o.amount ?? 0), 0), [todayOrders])
  const yesterdayRevenue = useMemo(() => yesterdayOrders.reduce((s, o) => s + (o.amount ?? 0), 0), [yesterdayOrders])

  const unassigned = orders.filter((o) => o.status === ORDER_STATUS.UNASSIGNED).length
  const todayUnassigned = todayOrders.filter((o) => o.status === ORDER_STATUS.UNASSIGNED).length
  const yestUnassigned = yesterdayOrders.filter((o) => o.status === ORDER_STATUS.UNASSIGNED).length

  const delivered = orders.filter((o) => o.status === ORDER_STATUS.DELIVERED).length
  const todayDelivered = todayOrders.filter((o) => o.status === ORDER_STATUS.DELIVERED).length
  const yestDelivered = yesterdayOrders.filter((o) => o.status === ORDER_STATUS.DELIVERED).length

  const onDelivery = drivers.filter((d) => d.status === DRIVER_STATUS.ON_DELIVERY).length
  const available = drivers.filter((d) => d.status === DRIVER_STATUS.AVAILABLE).length
  const offline = drivers.filter((d) => d.status === DRIVER_STATUS.OFFLINE).length

  const avgTime = useMemo(() => avgDeliveryTimeMin(orders), [orders])
  const rate = useMemo(() => successRate(orders), [orders])

  const avgRating = useMemo(() => {
    const rated = orders.filter((o) => o.customerRating && o.customerRating > 0)
    return rated.length ? rated.reduce((s, o) => s + (o.customerRating ?? 0), 0) / rated.length : 0
  }, [orders])

  // ── Overdue orders (assigned/in-transit > 3 hours) ──
  const overdueOrders = useMemo(() => {
    const threshold = 3 * 60 * 60 * 1000
    const now = Date.now()
    return orders.filter((o) => {
      if (![ORDER_STATUS.STARTED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.IN_TRANSIT].includes(o.status as never)) return false
      const started = toMs(o.startedAt) || toMs(o.createdAt)
      return started > 0 && now - started > threshold
    })
  }, [orders])

  // ── Failed/cancelled today ──
  const failedToday = useMemo(() =>
    todayOrders.filter((o) => o.status === ORDER_STATUS.FAILED || o.status === ORDER_STATUS.CANCELLED).length,
    [todayOrders]
  )
  const failedYest = useMemo(() =>
    yesterdayOrders.filter((o) => o.status === ORDER_STATUS.FAILED || o.status === ORDER_STATUS.CANCELLED).length,
    [yesterdayOrders]
  )
  const failedTotal = orders.filter((o) => o.status === ORDER_STATUS.FAILED || o.status === ORDER_STATUS.CANCELLED).length

  // ── Last 7 days bar chart ──
  const last7Days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = subDays(new Date(), 6 - i)
      const dayStart = startOfDay(day).getTime()
      const dayEnd = dayStart + 86_400_000
      const count = orders.filter((o) => {
        const ms = toMs(o.createdAt)
        return ms >= dayStart && ms < dayEnd
      }).length
      return { label: format(day, "EEE"), count }
    })
  }, [orders])

  // ── Hourly heatmap (all time) ──
  const hourlyHeatmap = useMemo(() => {
    const counts = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}:00`, count: 0 }))
    orders.forEach((o) => {
      const ms = toMs(o.createdAt)
      if (ms) {
        const h = getHours(new Date(ms))
        counts[h].count++
      }
    })
    return counts
  }, [orders])

  // ── Rating trend (last 8 weeks sparkline) ──
  const ratingTrend = useMemo(() => {
    const now = new Date()
    const weeks = eachWeekOfInterval(
      { start: subWeeks(startOfWeek(now, { weekStartsOn: 1 }), 7), end: now },
      { weekStartsOn: 1 }
    )
    return weeks.map((ws) => {
      const we = ws.getTime() + 7 * 86_400_000
      const inWeek = orders.filter((o) => {
        const ms = toMs(o.customerRatedAt)
        return ms >= ws.getTime() && ms < we && !!o.customerRating
      })
      const avg = inWeek.length ? inWeek.reduce((s, o) => s + (o.customerRating ?? 0), 0) / inWeek.length : null
      return { label: format(ws, "d MMM"), avg: avg !== null ? parseFloat(avg.toFixed(2)) : null }
    })
  }, [orders])

  // ── Pie chart data ──
  const statusPie = useMemo(() => [
    { name: "Unassigned", value: orders.filter((o) => o.status === ORDER_STATUS.UNASSIGNED).length, color: "#94a3b8" },
    { name: "In Progress", value: orders.filter((o) => [ORDER_STATUS.STARTED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.IN_TRANSIT].includes(o.status as never)).length, color: "#f59e0b" },
    { name: "Delivered", value: orders.filter((o) => o.status === ORDER_STATUS.DELIVERED).length, color: "#22c55e" },
    { name: "Failed/Cancelled", value: orders.filter((o) => [ORDER_STATUS.FAILED, ORDER_STATUS.CANCELLED].includes(o.status as never)).length, color: "#ef4444" },
  ].filter((d) => d.value > 0), [orders])

  // ── Driver productivity today ──
  const driverProductivity = useMemo(() => {
    return drivers
      .filter((d) => d.status !== DRIVER_STATUS.OFFLINE)
      .map((d) => {
        const assigned = todayOrders.filter((o) => o.assignedDriver === d.id).length
        const deliveredToday = todayOrders.filter((o) => o.assignedDriver === d.id && o.status === ORDER_STATUS.DELIVERED).length
        return { id: d.id, name: d.name, status: d.status, rating: d.rating, assigned, deliveredToday }
      })
      .sort((a, b) => b.deliveredToday - a.deliveredToday)
  }, [drivers, todayOrders])

  // ── Top performers today ──
  const topPerformers = driverProductivity.filter((d) => d.deliveredToday > 0).slice(0, 3)

  // ── Recent orders sorted by createdAt ──
  const recentOrders = useMemo(
    () => [...orders].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)).slice(0, 6),
    [orders]
  )

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Overview of your delivery operations</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Live · {format(lastUpdated, "HH:mm:ss")}
            </span>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dispatch">Dispatch</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/orders?new=1">
                <Plus className="size-3.5" />
                New Order
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ── Daily revenue goal ── */}
      {(dailyGoal > 0 || editingGoal) && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="size-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Daily Revenue Goal</p>
            </div>
            {!editingGoal && (
              <button onClick={() => { setGoalInput(dailyGoal.toString()); setEditingGoal(true); setTimeout(() => goalInputRef.current?.focus(), 50) }} className="text-xs text-muted-foreground hover:text-foreground">
                Edit
              </button>
            )}
          </div>
          {editingGoal ? (
            <div className="mt-2 flex items-center gap-2">
              <Input
                ref={goalInputRef}
                className="h-8 w-40 text-sm"
                placeholder="Enter goal amount"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                type="number"
              />
              <Button size="sm" className="h-8 text-xs" onClick={() => {
                const g = parseInt(goalInput) || 0
                setDailyGoal(g)
                try { localStorage.setItem("dashboardDailyGoal", g.toString()) } catch {}
                setEditingGoal(false)
              }}>Save</Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingGoal(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatCurrency(todayRevenue)} earned today</span>
                <span>{Math.min(100, Math.round((todayRevenue / dailyGoal) * 100))}% of {formatCurrency(dailyGoal)}</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.round((todayRevenue / dailyGoal) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
      {!editingGoal && dailyGoal === 0 && (
        <button
          onClick={() => { setGoalInput(""); setEditingGoal(true); setTimeout(() => goalInputRef.current?.focus(), 50) }}
          className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          <Target className="size-3.5" /> Set daily revenue goal
        </button>
      )}

      {/* ── Today snapshot ── */}
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today at a glance</p>
        <div className="flex flex-wrap gap-6 text-sm">
          <span><span className="font-bold text-foreground">{todayOrders.length}</span> <span className="text-muted-foreground">orders</span></span>
          <span><span className="font-bold text-success">{todayDelivered}</span> <span className="text-muted-foreground">delivered</span></span>
          <span><span className="font-bold text-warning">{todayUnassigned}</span> <span className="text-muted-foreground">unassigned</span></span>
          <span><span className="font-bold text-foreground">{formatCurrency(todayRevenue)}</span> <span className="text-muted-foreground">revenue</span></span>
        </div>
      </div>

      {/* ── Overdue alert ── */}
      {overdueOrders.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-warning">
              {overdueOrders.length} order{overdueOrders.length > 1 ? "s" : ""} overdue (&gt;3 hrs in transit)
            </p>
            <p className="text-xs text-muted-foreground">
              {overdueOrders.slice(0, 3).map((o) => `#${o.orderNumber}`).join(", ")}
              {overdueOrders.length > 3 && ` +${overdueOrders.length - 3} more`}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dispatch">View</Link>
          </Button>
        </div>
      )}

      {/* ── Stat cards (row 1) ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total orders */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Package className="size-5 text-primary" />
              </div>
              <DeltaBadge current={todayOrders.length} previous={yesterdayOrders.length} />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{orders.length}</p>
            <p className="text-xs text-muted-foreground">Total Orders</p>
            <p className="mt-1 text-xs text-muted-foreground">Today: <span className="font-medium text-foreground">{todayOrders.length}</span></p>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-success/10">
                <TrendingUp className="size-5 text-success" />
              </div>
              <DeltaBadge current={todayRevenue} previous={yesterdayRevenue} />
            </div>
            <p className="mt-3 text-2xl font-bold text-foreground">{formatCurrency(totalRevenue)}</p>
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="mt-1 text-xs text-muted-foreground">Today: <span className="font-medium text-foreground">{formatCurrency(todayRevenue)}</span></p>
          </CardContent>
        </Card>

        {/* Delivered */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle2 className="size-5 text-success" />
              </div>
              <DeltaBadge current={todayDelivered} previous={yestDelivered} />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{delivered}</p>
            <p className="text-xs text-muted-foreground">Completed Deliveries</p>
            <p className="mt-1 text-xs text-muted-foreground">Today: <span className="font-medium text-foreground">{todayDelivered}</span></p>
          </CardContent>
        </Card>

        {/* Unassigned */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-warning/10">
                <Clock className="size-5 text-warning" />
              </div>
              <DeltaBadge current={todayUnassigned} previous={yestUnassigned} />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{unassigned}</p>
            <p className="text-xs text-muted-foreground">Unassigned Orders</p>
            <p className="mt-1 text-xs text-muted-foreground">Today: <span className="font-medium text-foreground">{todayUnassigned}</span></p>
          </CardContent>
        </Card>
      </div>

      {/* ── Stat cards (row 2) ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Drivers on delivery */}
        <Card>
          <CardContent className="p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-chart-2/10">
              <Truck className="size-5 text-chart-2" />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{onDelivery}</p>
            <p className="text-xs text-muted-foreground">Drivers On Delivery</p>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="text-success font-medium">{available}</span> available · <span className="text-muted-foreground">{offline}</span> offline
            </p>
          </CardContent>
        </Card>

        {/* Avg delivery time */}
        <Card>
          <CardContent className="p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="size-5 text-primary" />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{avgTime > 0 ? `${avgTime}m` : "—"}</p>
            <p className="text-xs text-muted-foreground">Avg Delivery Time</p>
            <p className="mt-1 text-xs text-muted-foreground">Start → delivered</p>
          </CardContent>
        </Card>

        {/* Success rate */}
        <Card>
          <CardContent className="p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-success/10">
              <CircleDot className="size-5 text-success" />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{rate > 0 ? `${rate}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">Delivery Success Rate</p>
            <p className="mt-1 text-xs text-muted-foreground">Delivered ÷ terminal orders</p>
          </CardContent>
        </Card>

        {/* Avg rating */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-yellow-100">
                <Star className="size-5 fill-yellow-400 text-yellow-400" />
              </div>
              {ratingTrend.some((d) => d.avg !== null) && (
                <div className="h-8 w-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ratingTrend}>
                      <Line type="monotone" dataKey="avg" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{avgRating > 0 ? avgRating.toFixed(2) : "—"}</p>
            <p className="text-xs text-muted-foreground">Avg Customer Rating</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {orders.filter((o) => o.customerRating && o.customerRating > 0).length} reviews received
            </p>
          </CardContent>
        </Card>

        {/* Failed / Cancelled today */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                <XCircle className="size-5 text-destructive" />
              </div>
              <DeltaBadge current={failedToday} previous={failedYest} />
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{failedTotal}</p>
            <p className="text-xs text-muted-foreground">Failed / Cancelled</p>
            <p className="mt-1 text-xs text-muted-foreground">Today: <span className="font-medium text-destructive">{failedToday}</span></p>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts row ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Last 7 days bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Orders — Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={last7Days} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Order status donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Orders by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusPie.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No orders yet</p>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={140} height={140}>
                  <PieChart>
                    <Pie
                      data={statusPie}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={65}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {statusPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-1 flex-col gap-1.5">
                  {statusPie.map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-muted-foreground">{s.name}</span>
                      </span>
                      <span className="font-semibold text-foreground">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Hourly heatmap ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="size-4 text-orange-500" />
            Order Volume by Hour of Day
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={hourlyHeatmap} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [v, "Orders"]} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {hourlyHeatmap.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.count === 0 ? "hsl(var(--muted))"
                      : entry.count >= Math.max(...hourlyHeatmap.map((h) => h.count)) * 0.75 ? "#ef4444"
                      : entry.count >= Math.max(...hourlyHeatmap.map((h) => h.count)) * 0.4 ? "#f59e0b"
                      : "hsl(var(--primary))"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Peak hour: {hourlyHeatmap.reduce((a, b) => (b.count > a.count ? b : a), hourlyHeatmap[0]).label}
          </p>
        </CardContent>
      </Card>

      {/* ── Main content ── */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Recent orders */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recent Orders</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs" asChild>
              <Link href="/orders">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                recentOrders.map((order) => {
                  const driver = order.assignedDriver ? driverMap.get(order.assignedDriver) : null
                  return (
                    <div key={order.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">#{order.orderNumber}</span>
                          <StatusBadge status={order.status} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {order.customerName} · {order.address.split(",")[0]}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(order.amount)}</span>
                        <span className="text-xs text-muted-foreground">{driver?.name ?? "Unassigned"}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Driver panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" />
              Driver Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {drivers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No drivers yet.</p>
              ) : (
                driverProductivity.map((d) => {
                  const statusColor =
                    d.status === DRIVER_STATUS.AVAILABLE ? "bg-success"
                    : d.status === DRIVER_STATUS.ON_DELIVERY ? "bg-warning"
                    : "bg-muted-foreground"
                  return (
                    <div key={d.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="relative">
                          <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {d.name.split(" ").map((n) => n[0]).join("")}
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card ${statusColor}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{d.name}</p>
                          <p className="text-xs capitalize text-muted-foreground">{d.status.replace("-", " ")}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 text-xs">
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <Star className="size-3 fill-yellow-400 text-yellow-400" />
                          {d.rating}
                        </span>
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">{d.deliveredToday}</span>/{d.assigned} today
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Top performers ── */}
      {topPerformers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-yellow-500" />
              Top Performers Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {topPerformers.map((d, i) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    i === 0 ? "bg-yellow-100 text-yellow-700"
                    : i === 1 ? "bg-gray-100 text-gray-600"
                    : "bg-orange-100 text-orange-600"
                  }`}>
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-success">{d.deliveredToday}</span> delivered today
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Zap className="size-3 text-yellow-500" />
                    {d.assigned > 0 ? Math.round((d.deliveredToday / d.assigned) * 100) : 0}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Quick actions ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <Link href="/orders?new=1">
                <Plus className="size-3.5" />
                New Order
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dispatch">
                <Truck className="size-3.5" />
                Assign Unassigned ({unassigned})
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/orders">
                <Package className="size-3.5" />
                All Orders
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/drivers">
                <Users className="size-3.5" />
                Manage Drivers
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports">
                <TrendingUp className="size-3.5" />
                View Reports
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reviews">
                <Star className="size-3.5" />
                Reviews
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
