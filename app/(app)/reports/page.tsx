"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ComposedChart,
  Line,
  PieChart,
  Pie,
  Legend,
} from "recharts"
import {
  Package,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  TrendingDown,
  Users,
  CalendarDays,
  Download,
  Timer,
  AlertTriangle,
  Minus,
} from "lucide-react"
import { format, startOfDay, startOfWeek, startOfMonth, subDays, subWeeks, subMonths } from "date-fns"
import { fetchOrders, fetchDrivers, fetchNotificationLogs } from "@/lib/firestore"
import type { Order, Driver, NotificationLog } from "@/lib/data"

type Period = "today" | "week" | "month" | "all" | "custom"

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time",
  custom: "Custom",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

function localDateKey(d: Date): string {
  return format(d, "yyyy-MM-dd")
}

function getPeriodBounds(
  period: Period,
  customRange: { from: Date | undefined; to: Date | undefined }
): { start: Date | null; end: Date | null } {
  const now = new Date()
  if (period === "today") {
    return { start: startOfDay(now), end: null }
  }
  if (period === "week") {
    return { start: startOfWeek(now, { weekStartsOn: 0 }), end: null }
  }
  if (period === "month") {
    return { start: startOfMonth(now), end: null }
  }
  if (period === "custom" && customRange.from) {
    return {
      start: startOfDay(customRange.from),
      end: customRange.to ? new Date(customRange.to.setHours(23, 59, 59, 999)) : null,
    }
  }
  return { start: null, end: null }
}

function getPrevPeriodBounds(period: Period): { start: Date | null; end: Date | null } {
  const now = new Date()
  if (period === "today") {
    const d = subDays(startOfDay(now), 1)
    return { start: d, end: startOfDay(now) }
  }
  if (period === "week") {
    const thisWeekStart = startOfWeek(now, { weekStartsOn: 0 })
    return { start: subWeeks(thisWeekStart, 1), end: thisWeekStart }
  }
  if (period === "month") {
    const thisMonthStart = startOfMonth(now)
    return { start: subMonths(thisMonthStart, 1), end: thisMonthStart }
  }
  return { start: null, end: null }
}

function filterOrdersByBounds(
  orders: Order[],
  start: Date | null,
  end: Date | null
): Order[] {
  if (!start) return orders
  return orders.filter((o) => {
    const d = toDate(o.createdAt)
    if (!d) return false
    if (d < start) return false
    if (end && d >= end) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Sub-helpers
// ---------------------------------------------------------------------------

interface DayRow {
  key: string
  label: string
  orders: number
  delivered: number
  revenue: number
}

function buildDailyBreakdown(orders: Order[], period: "week" | "month" | "custom"): DayRow[] {
  const map = new Map<string, DayRow>()

  if (period === "week") {
    const now = new Date()
    for (let i = 0; i < 7; i++) {
      const d = new Date(now)
      d.setDate(now.getDate() - now.getDay() + i)
      d.setHours(0, 0, 0, 0)
      const key = localDateKey(d)
      map.set(key, {
        key,
        label: format(d, "EEE d MMM"),
        orders: 0,
        delivered: 0,
        revenue: 0,
      })
    }
  }

  for (const order of orders) {
    const d = toDate(order.createdAt)
    if (!d) continue
    const key = localDateKey(d)
    const existing = map.get(key) ?? {
      key,
      label: format(d, "d MMM"),
      orders: 0,
      delivered: 0,
      revenue: 0,
    }
    existing.orders++
    if (order.status === "delivered") {
      existing.delivered++
      existing.revenue += order.amount
    }
    map.set(key, existing)
  }

  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key))
}

interface DriverRow {
  id: string
  name: string
  assigned: number
  delivered: number
  failed: number
  revenue: number
  avgMinutes: number | null
}

function buildDriverStats(orders: Order[], drivers: Driver[]): DriverRow[] {
  const map = new Map<string, DriverRow>()

  for (const driver of drivers) {
    map.set(driver.id, {
      id: driver.id,
      name: driver.name,
      assigned: 0,
      delivered: 0,
      failed: 0,
      revenue: 0,
      avgMinutes: null,
    })
  }

  const deliveryMinutes: Map<string, number[]> = new Map()

  for (const order of orders) {
    if (!order.assignedDriver) continue
    const row = map.get(order.assignedDriver)
    if (!row) continue
    row.assigned++
    if (order.status === "delivered") {
      row.delivered++
      row.revenue += order.amount
      const start = toDate(order.startedAt ?? order.pickedUpAt)
      const end = toDate(order.deliveredAt)
      if (start && end) {
        const mins = (end.getTime() - start.getTime()) / 60000
        if (mins > 0 && mins < 600) {
          const arr = deliveryMinutes.get(order.assignedDriver) ?? []
          arr.push(mins)
          deliveryMinutes.set(order.assignedDriver, arr)
        }
      }
    }
    if (order.status === "failed" || order.status === "cancelled") {
      row.failed++
    }
  }

  for (const [driverId, mins] of deliveryMinutes) {
    const row = map.get(driverId)
    if (row && mins.length) {
      row.avgMinutes = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
    }
  }

  return Array.from(map.values())
    .filter((r) => r.assigned > 0)
    .sort((a, b) => b.delivered - a.delivered)
}

function avgDeliveryTime(orders: Order[]): number | null {
  const times: number[] = []
  for (const order of orders) {
    if (order.status !== "delivered") continue
    const start = toDate(order.startedAt ?? order.pickedUpAt)
    const end = toDate(order.deliveredAt)
    if (start && end) {
      const mins = (end.getTime() - start.getTime()) / 60000
      if (mins > 0 && mins < 600) times.push(mins)
    }
  }
  if (!times.length) return null
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length)
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount)
}

function buildStats(orders: Order[], drivers: Driver[], avgMins: number | null) {
  return [
    {
      title: "Total Orders",
      value: orders.length,
      icon: Package,
      color: "text-primary",
      bgColor: "bg-primary/10",
      format: "number",
    },
    {
      title: "Delivered",
      value: orders.filter((o) => o.status === "delivered").length,
      icon: CheckCircle2,
      color: "text-success",
      bgColor: "bg-success/10",
      format: "number",
    },
    {
      title: "Unassigned",
      value: orders.filter((o) => o.status === "unassigned").length,
      icon: Clock,
      color: "text-warning",
      bgColor: "bg-warning/10",
      format: "number",
    },
    {
      title: "Failed / Cancelled",
      value: orders.filter((o) => o.status === "failed" || o.status === "cancelled").length,
      icon: XCircle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      format: "number",
    },
    {
      title: "In Transit",
      value: orders.filter((o) => o.status === "in-transit").length,
      icon: TrendingUp,
      color: "text-chart-2",
      bgColor: "bg-chart-2/10",
      format: "number",
    },
    {
      title: "Avg Delivery Time",
      value: avgMins ?? 0,
      display: avgMins !== null ? formatMinutes(avgMins) : "N/A",
      icon: Timer,
      color: "text-chart-1",
      bgColor: "bg-chart-1/10",
      format: "time",
    },
    {
      title: "Active Drivers",
      value: drivers.filter((d) => d.status === "available" || d.status === "on-delivery").length,
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
      format: "number",
    },
    {
      title: "Total Drivers",
      value: drivers.length,
      icon: Users,
      color: "text-muted-foreground",
      bgColor: "bg-muted/50",
      format: "number",
    },
  ]
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

function exportCSV(orders: Order[], period: string) {
  const rows = [
    ["Order #", "Customer", "Phone", "Address", "Status", "Amount (NGN)", "Driver", "Created At", "Delivered At"],
    ...orders.map((o) => {
      const created = toDate(o.createdAt)
      const delivered = toDate(o.deliveredAt)
      return [
        o.orderNumber,
        o.customerName,
        o.phone,
        `"${o.address.replace(/"/g, '""')}"`,
        o.status,
        o.amount,
        o.assignedDriver ?? "",
        created ? format(created, "yyyy-MM-dd HH:mm") : "",
        delivered ? format(delivered, "yyyy-MM-dd HH:mm") : "",
      ]
    }),
  ]
  const csv = rows.map((r) => r.join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `sterlinglams-report-${period}-${format(new Date(), "yyyy-MM-dd")}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Comparison badge
// ---------------------------------------------------------------------------

function DeltaBadge({ current, prev, format: fmt }: { current: number; prev: number; format?: "percent" | "currency" }) {
  if (prev === 0 && current === 0) return <span className="text-xs text-muted-foreground">—</span>
  const delta = current - prev
  const pct = prev === 0 ? 100 : Math.round((delta / prev) * 100)
  const up = delta >= 0
  const label = fmt === "currency"
    ? `${up ? "+" : ""}${formatCurrency(delta)}`
    : `${up ? "+" : ""}${pct}%`
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${up ? "text-success" : "text-destructive"}`}>
      {delta === 0 ? <Minus className="size-3" /> : up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {label} vs prev
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [period, setPeriod] = useState<Period>("all")
  const [customRange, setCustomRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined })
  const [calendarOpen, setCalendarOpen] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const [orderData, driverData, logData] = await Promise.all([
          fetchOrders(),
          fetchDrivers(),
          fetchNotificationLogs(20),
        ])
        setAllOrders(orderData)
        setDrivers(driverData)
        setNotificationLogs(logData)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [])

  const { start, end } = useMemo(() => getPeriodBounds(period, customRange), [period, customRange])
  const { start: prevStart, end: prevEnd } = useMemo(() => getPrevPeriodBounds(period), [period])

  const filteredOrders = useMemo(() => filterOrdersByBounds(allOrders, start, end), [allOrders, start, end])
  const prevOrders = useMemo(() => filterOrdersByBounds(allOrders, prevStart, prevEnd), [allOrders, prevStart, prevEnd])

  const deliveredOrders = useMemo(() => filteredOrders.filter((o) => o.status === "delivered"), [filteredOrders])
  const prevDelivered = useMemo(() => prevOrders.filter((o) => o.status === "delivered"), [prevOrders])

  const totalRevenue = useMemo(() => deliveredOrders.reduce((s, o) => s + o.amount, 0), [deliveredOrders])
  const prevRevenue = useMemo(() => prevDelivered.reduce((s, o) => s + o.amount, 0), [prevDelivered])

  const deliveryRate = filteredOrders.length
    ? Math.round((deliveredOrders.length / filteredOrders.length) * 100)
    : 0

  const avgMins = useMemo(() => avgDeliveryTime(filteredOrders), [filteredOrders])
  const stats = useMemo(() => buildStats(filteredOrders, drivers, avgMins), [filteredOrders, drivers, avgMins])
  const driverStats = useMemo(() => buildDriverStats(filteredOrders, drivers), [filteredOrders, drivers])

  const chartData = useMemo(() => {
    if (period === "today" || period === "all") return []
    const rows = buildDailyBreakdown(filteredOrders, period === "custom" ? "custom" : period)
    return rows.map((r) => ({ name: r.label, revenue: r.revenue, orders: r.orders, delivered: r.delivered }))
  }, [filteredOrders, period])

  const handleExport = useCallback(() => {
    exportCSV(filteredOrders, period === "custom"
      ? `${customRange.from ? format(customRange.from, "yyyy-MM-dd") : "custom"}`
      : period)
  }, [filteredOrders, period, customRange])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const formatLogTime = (value: unknown) => {
    const d = toDate(value)
    if (!d) return "-"
    return format(d, "d MMM yyyy, h:mm a")
  }

  const eventLabel: Record<NotificationLog["event"], string> = {
    order_accepted: "Accepted",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
  }

  const channelBadge = (sent: boolean) =>
    sent ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground border-border"

  const statusStyle = (status: string) => {
    if (status === "delivered") return "bg-success/10 text-success"
    if (status === "in-transit") return "bg-chart-2/10 text-chart-2"
    if (status === "failed" || status === "cancelled") return "bg-destructive/10 text-destructive"
    return "bg-warning/10 text-warning"
  }

  const showComparison = period !== "all" && period !== "custom"
  const showBreakdown = period === "week" || period === "month" || period === "custom"

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivery statistics and performance overview
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period tabs */}
          <div className="flex rounded-lg border border-border bg-muted/40 p-1 gap-1">
            {(["today", "week", "month", "all"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Custom date range */}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`h-9 gap-1.5 text-xs ${period === "custom" ? "border-primary text-primary" : ""}`}
              >
                <CalendarDays className="size-3.5" />
                {period === "custom" && customRange.from
                  ? customRange.to
                    ? `${format(customRange.from, "d MMM")} – ${format(customRange.to, "d MMM")}`
                    : format(customRange.from, "d MMM")
                  : "Custom"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={{ from: customRange.from, to: customRange.to }}
                onSelect={(range) => {
                  setCustomRange({ from: range?.from, to: range?.to })
                  if (range?.from) setPeriod("custom")
                  if (range?.from && range?.to) setCalendarOpen(false)
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {/* Export CSV */}
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={handleExport}>
            <Download className="size-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <div className={`flex size-9 items-center justify-center rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`size-[18px] ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <span className="text-3xl font-bold text-foreground">
                {"display" in stat ? stat.display : stat.value}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Delivery rate + Revenue (with comparison) ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Delivery Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <span className="text-4xl font-bold text-success">{deliveryRate}%</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-success transition-all" style={{ width: `${deliveryRate}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {deliveredOrders.length} of {filteredOrders.length} orders delivered
                {period !== "all" && ` — ${PERIOD_LABELS[period].toLowerCase()}`}
              </p>
              {showComparison && (
                <DeltaBadge current={deliveredOrders.length} prev={prevDelivered.length} />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue from Delivered</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <span className="text-4xl font-bold text-foreground">{formatCurrency(totalRevenue)}</span>
              <p className="text-xs text-muted-foreground">
                Collected from delivered orders
                {period !== "all" && ` — ${PERIOD_LABELS[period].toLowerCase()}`}
              </p>
              {showComparison && (
                <DeltaBadge current={totalRevenue} prev={prevRevenue} format="currency" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Revenue Bar Chart with moving average ── */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData.map((entry, i, arr) => {
                const window = arr.slice(Math.max(0, i - 2), i + 1)
                const avg = window.length ? window.reduce((s, e) => s + (e.revenue ?? 0), 0) / window.length : null
                return { ...entry, movingAvg: avg !== null ? parseFloat(avg.toFixed(0)) : null }
              })} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₦${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} width={48} />
                <Tooltip formatter={(value: number, name: string) => [formatCurrency(value), name === "movingAvg" ? "Moving Avg" : "Revenue"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.revenue > 0 ? "hsl(var(--chart-1))" : "hsl(var(--muted))"} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="movingAvg" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} strokeDasharray="4 2" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── TODAY — order list ── */}
      {period === "today" && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <CalendarDays className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Today&apos;s Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders created today.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Order #</th>
                      <th className="pb-2 text-left font-medium">Customer</th>
                      <th className="pb-2 text-center font-medium">Status</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="transition-colors hover:bg-muted/40">
                        <td className="py-2.5 pr-4 font-mono text-xs font-medium text-foreground">
                          #{order.orderNumber}
                        </td>
                        <td className="py-2.5 pr-4 text-foreground">{order.customerName}</td>
                        <td className="py-2.5 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle(order.status)}`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-medium text-foreground">
                          {formatCurrency(order.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── WEEK / MONTH / CUSTOM — day-by-day breakdown ── */}
      {showBreakdown && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <CalendarDays className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">
              {period === "week"
                ? "Day-by-Day Breakdown (This Week)"
                : period === "month"
                ? "Daily Breakdown (This Month)"
                : "Breakdown by Day"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders in this period.</p>
            ) : (() => {
              const rows = buildDailyBreakdown(filteredOrders, period === "custom" ? "custom" : period)
              const totalDelivered = rows.reduce((s, r) => s + r.delivered, 0)
              const totalRev = rows.reduce((s, r) => s + r.revenue, 0)
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="pb-2 text-left font-medium">Date</th>
                        <th className="pb-2 text-center font-medium">Orders</th>
                        <th className="pb-2 text-center font-medium">Delivered</th>
                        <th className="pb-2 text-center font-medium">Rate</th>
                        <th className="pb-2 text-right font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => {
                        const rate = row.orders ? Math.round((row.delivered / row.orders) * 100) : 0
                        const rateColor =
                          row.orders === 0 ? "text-muted-foreground"
                          : rate >= 80 ? "text-success"
                          : rate >= 50 ? "text-warning"
                          : "text-destructive"
                        return (
                          <tr key={row.key} className="transition-colors hover:bg-muted/40">
                            <td className="py-2.5 pr-4 font-medium text-foreground">{row.label}</td>
                            <td className="py-2.5 text-center text-foreground">{row.orders}</td>
                            <td className="py-2.5 text-center text-success">{row.delivered}</td>
                            <td className="py-2.5 text-center">
                              <span className={`text-xs font-medium ${rateColor}`}>
                                {row.orders === 0 ? "—" : `${rate}%`}
                              </span>
                            </td>
                            <td className="py-2.5 text-right font-medium text-foreground">
                              {row.revenue > 0 ? formatCurrency(row.revenue) : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-semibold text-foreground">
                        <td className="pt-3 pr-4 text-sm">Total</td>
                        <td className="pt-3 text-center">{filteredOrders.length}</td>
                        <td className="pt-3 text-center text-success">{totalDelivered}</td>
                        <td className="pt-3 text-center text-xs font-medium">{deliveryRate}%</td>
                        <td className="pt-3 text-right">{formatCurrency(totalRev)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}

      {/* ── Driver Performance ── */}
      {driverStats.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Driver Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Driver</th>
                    <th className="pb-2 text-center font-medium">Assigned</th>
                    <th className="pb-2 text-center font-medium">Delivered</th>
                    <th className="pb-2 text-center font-medium">Failed</th>
                    <th className="pb-2 text-center font-medium">Rate</th>
                    <th className="pb-2 text-center font-medium">Avg Time</th>
                    <th className="pb-2 text-center font-medium">Est. Earnings</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {driverStats.map((row, i) => {
                    const rate = row.assigned ? Math.round((row.delivered / row.assigned) * 100) : 0
                    const rateColor =
                      rate >= 80 ? "text-success"
                      : rate >= 50 ? "text-warning"
                      : "text-destructive"
                    let earningsRate = 0
                    try { earningsRate = parseFloat(localStorage.getItem("earningsPerKmRate") ?? "0") || 0 } catch {}
                    const driverOrdersForEarnings = filteredOrders.filter((o) => o.assignedDriver === row.id && o.status === "delivered" && (o.distanceKm ?? 0) > 0)
                    const totalKm = driverOrdersForEarnings.reduce((s, o) => s + (o.distanceKm ?? 0), 0)
                    const earnings = totalKm * earningsRate
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-muted/40">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              i === 0 ? "bg-yellow-100 text-yellow-700"
                              : i === 1 ? "bg-gray-100 text-gray-600"
                              : i === 2 ? "bg-orange-100 text-orange-600"
                              : "bg-muted text-muted-foreground"
                            }`}>
                              {i + 1}
                            </span>
                            <span className="font-medium text-foreground">{row.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-center text-foreground">{row.assigned}</td>
                        <td className="py-2.5 text-center text-success">{row.delivered}</td>
                        <td className="py-2.5 text-center">
                          {row.failed > 0 ? (
                            <span className="flex items-center justify-center gap-1 text-destructive">
                              <AlertTriangle className="size-3" />{row.failed}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-2.5 text-center">
                          <span className={`text-xs font-medium ${rateColor}`}>{rate}%</span>
                        </td>
                        <td className="py-2.5 text-center text-xs text-muted-foreground">
                          {row.avgMinutes !== null ? formatMinutes(row.avgMinutes) : "—"}
                        </td>
                        <td className="py-2.5 text-center text-xs text-muted-foreground">
                          {earnings > 0 ? formatCurrency(earnings) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="py-2.5 text-right font-medium text-foreground">
                          {row.revenue > 0 ? formatCurrency(row.revenue) : "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── New analytics charts ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Revenue by payment method */}
        {filteredOrders.length > 0 && (() => {
          const methodMap = new Map<string, number>()
          filteredOrders.filter((o) => o.status === "delivered" && o.paymentMethod).forEach((o) => {
            const method = o.paymentMethod ?? "Unknown"
            methodMap.set(method, (methodMap.get(method) ?? 0) + o.amount)
          })
          const data = Array.from(methodMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
          if (!data.length) return null
          const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"]
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Revenue by Payment Method</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={3}>
                      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )
        })()}

        {/* Peak hours bar chart */}
        {filteredOrders.length > 0 && (() => {
          const counts = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, count: 0 }))
          filteredOrders.forEach((o) => {
            const d = toDate(o.createdAt)
            if (d) counts[d.getHours()].count++
          })
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Peak Order Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={counts} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={2} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {counts.map((e, i) => {
                        const max = Math.max(...counts.map((c) => c.count))
                        return <Cell key={i} fill={e.count >= max * 0.75 ? "#ef4444" : e.count >= max * 0.4 ? "#f59e0b" : "hsl(var(--chart-2))"} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )
        })()}

        {/* Delivery time distribution */}
        {filteredOrders.filter((o) => o.status === "delivered").length > 0 && (() => {
          const buckets = [
            { label: "<30m", count: 0 },
            { label: "30-60m", count: 0 },
            { label: "1-2h", count: 0 },
            { label: ">2h", count: 0 },
          ]
          filteredOrders.filter((o) => o.status === "delivered").forEach((o) => {
            const start = toDate(o.startedAt ?? o.pickedUpAt)
            const end = toDate(o.deliveredAt)
            if (!start || !end) return
            const mins = (end.getTime() - start.getTime()) / 60000
            if (mins < 0 || mins > 1440) return
            if (mins < 30) buckets[0].count++
            else if (mins < 60) buckets[1].count++
            else if (mins < 120) buckets[2].count++
            else buckets[3].count++
          })
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Delivery Time Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={buckets} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [v, "Orders"]} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-3))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )
        })()}

        {/* Customer retention */}
        {filteredOrders.length > 0 && (() => {
          const phoneCounts = new Map<string, number>()
          filteredOrders.filter((o) => o.phone).forEach((o) => {
            phoneCounts.set(o.phone, (phoneCounts.get(o.phone) ?? 0) + 1)
          })
          const total = phoneCounts.size
          const returning = [...phoneCounts.values()].filter((c) => c >= 2).length
          const rate = total > 0 ? Math.round((returning / total) * 100) : 0
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Customer Retention</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-6">
                <p className="text-5xl font-bold text-foreground">{rate}%</p>
                <p className="text-sm text-muted-foreground">of customers placed 2+ orders</p>
                <p className="text-xs text-muted-foreground">{returning} returning out of {total} unique customers</p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${rate}%` }} />
                </div>
              </CardContent>
            </Card>
          )
        })()}
      </div>

      {/* ── Failed / Cancelled breakdown ── */}
      {filteredOrders.filter((o) => o.status === "failed" || o.status === "cancelled").length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" />
              Failed &amp; Cancelled Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Order #</th>
                    <th className="pb-2 text-left font-medium">Customer</th>
                    <th className="pb-2 text-center font-medium">Status</th>
                    <th className="pb-2 text-left font-medium">Driver</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredOrders
                    .filter((o) => o.status === "failed" || o.status === "cancelled")
                    .map((order) => {
                      const driver = drivers.find((d) => d.id === order.assignedDriver)
                      return (
                        <tr key={order.id} className="transition-colors hover:bg-muted/40">
                          <td className="py-2.5 pr-4 font-mono text-xs font-medium text-foreground">
                            #{order.orderNumber}
                          </td>
                          <td className="py-2.5 pr-4 text-foreground">{order.customerName}</td>
                          <td className="py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle(order.status)}`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {driver ? driver.name : "Unassigned"}
                          </td>
                          <td className="py-2.5 text-right font-medium text-foreground">
                            {formatCurrency(order.amount)}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Notification logs ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Notification Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {notificationLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notification logs yet.</p>
          ) : (
            <div className="space-y-3">
              {notificationLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {log.orderNumber} • {eventLabel[log.event]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.customerName || "Customer"} ({log.customerPhone || "No phone"})
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatLogTime(log.createdAt)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline" className={channelBadge(log.sms.sent)}>
                      SMS: {log.sms.sent ? "Sent" : "Skipped/Failed"}
                    </Badge>
                    <Badge variant="outline" className={channelBadge(log.whatsapp.sent)}>
                      WhatsApp: {log.whatsapp.sent ? "Sent" : "Skipped/Failed"}
                    </Badge>
                    <Badge variant="outline" className={channelBadge(log.email.sent)}>
                      Email: {log.email.sent ? "Sent" : "Skipped/Failed"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
