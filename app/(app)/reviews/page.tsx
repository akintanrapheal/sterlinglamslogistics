"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Star,
  MessageSquare,
  ChevronDown,
  Download,
  Trophy,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Users,
  Reply,
  Bookmark,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts"
import { format, startOfWeek, eachWeekOfInterval, subWeeks } from "date-fns"
import { fetchOrders, fetchDrivers } from "@/lib/firestore"
import { updateOrder } from "@/lib/firestore"
import type { Order, Driver } from "@/lib/data"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate()
  }
  if (typeof value === "number") return new Date(value)
  return null
}

function toMs(value: unknown): number {
  const d = toDate(value)
  return d ? d.getTime() : 0
}

function formatCutoff(filter: DateFilter): number {
  const now = Date.now()
  if (filter === "today") return now - 86_400_000
  if (filter === "week") return now - 604_800_000
  if (filter === "month") return now - 2_592_000_000
  return 0
}

function exportCSV(orders: Order[], driverMap: Map<string, Driver>) {
  const rows = [
    ["Order #", "Customer", "Order Rating", "Driver Rating", "Feedback", "Driver", "Rated At", "Admin Reply"],
    ...orders.map((o) => {
      const driver = o.assignedDriver ? driverMap.get(o.assignedDriver) : null
      const ratedAt = toDate(o.customerRatedAt)
      return [
        o.orderNumber,
        o.customerName,
        o.customerRating ?? "",
        o.driverRating ?? "",
        `"${(o.customerFeedback ?? "").replace(/"/g, '""')}"`,
        driver ? driver.name : "",
        ratedAt ? format(ratedAt, "yyyy-MM-dd HH:mm") : "",
        `"${(o.adminReply ?? "").replace(/"/g, '""')}"`,
      ]
    }),
  ]
  const csv = rows.map((r) => r.join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `sterlinglams-reviews-${format(new Date(), "yyyy-MM-dd")}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StarRow({ rating, max = 5, size = "md" }: { rating: number; max?: number; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "size-3" : "size-4"
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className={`${cls} ${i < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  )
}

function RatingDistribution({
  label,
  average,
  distribution,
}: {
  label: string
  average: number
  distribution: number[]
}) {
  const total = distribution.reduce((a, b) => a + b, 0)
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold">{average.toFixed(2)}</span>
        <StarRow rating={Math.round(average)} />
        <span className="text-xs text-muted-foreground">({total})</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {[5, 4, 3, 2, 1].map((star, idx) => {
          const count = distribution[idx]
          const pct = total ? (count / total) * 100 : 0
          return (
            <div key={star} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-right font-medium">{star}</span>
              <Star className="size-3 fill-yellow-400 text-yellow-400" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-yellow-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-6 text-right text-muted-foreground">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label?: string
}) {
  return (
    <div className="relative">
      {label && <span className="sr-only">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none rounded-lg border border-border bg-card px-3 py-2 pr-8 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateFilter = "all" | "today" | "week" | "month"
type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1"
type SortBy = "newest" | "oldest" | "highest" | "lowest"
type Tab = "all" | "escalation"

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewsPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("all")
  const [dateFilter, setDateFilter] = useState<DateFilter>("all")
  const [orderRatingFilter, setOrderRatingFilter] = useState<RatingFilter>("all")
  const [driverRatingFilter, setDriverRatingFilter] = useState<RatingFilter>("all")
  const [driverFilter, setDriverFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortBy>("newest")

  // Respond dialog
  const [respondOrder, setRespondOrder] = useState<Order | null>(null)
  const [replyText, setReplyText] = useState("")
  const [replySaving, setReplySaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [o, d] = await Promise.all([fetchOrders(), fetchDrivers()])
        setOrders(o)
        setDrivers(d)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const driverMap = useMemo(() => {
    const m = new Map<string, Driver>()
    drivers.forEach((d) => m.set(d.id, d))
    return m
  }, [drivers])

  const reviewedOrders = useMemo(
    () => orders.filter((o) => o.customerRating != null && o.customerRating > 0),
    [orders]
  )

  const deliveredCount = useMemo(
    () => orders.filter((o) => o.status === "delivered").length,
    [orders]
  )

  // â”€â”€ Distribution & averages â”€â”€
  function calcDistribution(list: Order[], field: "customerRating" | "driverRating") {
    const dist = [0, 0, 0, 0, 0]
    list.forEach((o) => {
      const r = o[field]
      if (r && r >= 1 && r <= 5) dist[5 - r]++
    })
    return dist
  }

  function calcAvg(list: Order[], field: "customerRating" | "driverRating") {
    const rated = list.filter((o) => o[field] && o[field]! > 0)
    if (!rated.length) return 0
    return rated.reduce((s, o) => s + (o[field] ?? 0), 0) / rated.length
  }

  const orderDist = calcDistribution(reviewedOrders, "customerRating")
  const driverDist = calcDistribution(reviewedOrders, "driverRating")
  const orderAvg = calcAvg(reviewedOrders, "customerRating")
  const driverAvg = calcAvg(reviewedOrders, "driverRating")

  const escalationCount = useMemo(
    () => reviewedOrders.filter((o) => (o.customerRating ?? 5) <= 2 || (o.driverRating ?? 5) <= 2).length,
    [reviewedOrders]
  )

  // â”€â”€ Driver leaderboard â”€â”€
  const driverLeaderboard = useMemo(() => {
    const map = new Map<string, { name: string; total: number; sum: number; reviews: number }>()
    reviewedOrders.forEach((o) => {
      if (!o.assignedDriver || !o.driverRating) return
      const d = driverMap.get(o.assignedDriver)
      if (!d) return
      const entry = map.get(o.assignedDriver) ?? { name: d.name, total: 0, sum: 0, reviews: 0 }
      entry.sum += o.driverRating
      entry.reviews++
      entry.total = entry.reviews
      map.set(o.assignedDriver, entry)
    })
    return Array.from(map.entries())
      .map(([id, e]) => ({ id, name: e.name, avg: e.sum / e.reviews, reviews: e.reviews }))
      .sort((a, b) => b.avg - a.avg)
  }, [reviewedOrders, driverMap])

  // â”€â”€ Keyword frequency â”€â”€
  const topKeywords = useMemo(() => {
    const stopWords = new Set(["the", "a", "an", "and", "is", "it", "in", "of", "to", "was", "my", "for", "very", "so", "but", "i", "he", "she", "they", "we", "me", "on", "with", "had", "has", "this", "that", "not", "at", "by", "be", "as", "are", "were", "from", "or"])
    const freq = new Map<string, number>()
    reviewedOrders.forEach((o) => {
      if (!o.customerFeedback) return
      o.customerFeedback
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
        .forEach((w) => freq.set(w, (freq.get(w) ?? 0) + 1))
    })
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
  }, [reviewedOrders])

  // â”€â”€ Rating trend (last 8 weeks) â”€â”€
  const trendData = useMemo(() => {
    const now = new Date()
    const weeks = eachWeekOfInterval(
      { start: subWeeks(startOfWeek(now, { weekStartsOn: 1 }), 7), end: now },
      { weekStartsOn: 1 }
    )
    return weeks.map((weekStart) => {
      const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
      const inWeek = reviewedOrders.filter((o) => {
        const ms = toMs(o.customerRatedAt)
        return ms >= weekStart.getTime() && ms < weekEnd.getTime()
      })
      const avg = inWeek.length ? inWeek.reduce((s, o) => s + (o.customerRating ?? 0), 0) / inWeek.length : null
      return {
        label: format(weekStart, "d MMM"),
        avg: avg !== null ? parseFloat(avg.toFixed(2)) : null,
        count: inWeek.length,
      }
    })
  }, [reviewedOrders])

  // â”€â”€ Filter & sort â”€â”€
  const filtered = useMemo(() => {
    let list = [...reviewedOrders]

    if (tab === "escalation") {
      list = list.filter((o) => (o.customerRating ?? 5) <= 2 || (o.driverRating ?? 5) <= 2)
    }

    if (dateFilter !== "all") {
      const cutoff = formatCutoff(dateFilter)
      list = list.filter((o) => toMs(o.customerRatedAt) >= cutoff)
    }

    if (driverFilter !== "all") {
      list = list.filter((o) => o.assignedDriver === driverFilter)
    }

    if (orderRatingFilter !== "all") {
      const r = Number(orderRatingFilter)
      list = list.filter((o) => o.customerRating === r)
    }

    if (driverRatingFilter !== "all") {
      const r = Number(driverRatingFilter)
      list = list.filter((o) => o.driverRating === r)
    }

    list.sort((a, b) => {
      if (sortBy === "newest") return toMs(b.customerRatedAt) - toMs(a.customerRatedAt)
      if (sortBy === "oldest") return toMs(a.customerRatedAt) - toMs(b.customerRatedAt)
      if (sortBy === "highest") return (b.customerRating ?? 0) - (a.customerRating ?? 0)
      return (a.customerRating ?? 0) - (b.customerRating ?? 0)
    })

    return list
  }, [reviewedOrders, tab, dateFilter, driverFilter, orderRatingFilter, driverRatingFilter, sortBy])

  // ─ Respond dialog ─
  const openRespond = (order: Order) => {
    setRespondOrder(order)
    setReplyText(order.adminReply ?? "")
  }

  // Unread tracking
  useEffect(() => {
    try { localStorage.setItem("lastReviewsVisit", Date.now().toString()) } catch {}
  }, [])

  useEffect(() => {
    if (reviewedOrders.length > 0) {
      const latest = reviewedOrders.reduce((max, o) => Math.max(max, toMs(o.customerRatedAt)), 0)
      try { localStorage.setItem("latestReviewTs", latest.toString()) } catch {}
    }
  }, [reviewedOrders])

  // Featured toggle
  const handleToggleFeatured = useCallback(async (order: Order) => {
    const featured = !order.featured
    try {
      await updateOrder(order.id, { featured } as Partial<Order>)
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, featured } : o))
    } catch {
      // ignore
    }
  }, [])

  const saveReply = useCallback(async () => {
    if (!respondOrder || !replyText.trim()) return
    setReplySaving(true)
    try {
      await updateOrder(respondOrder.id, { adminReply: replyText.trim(), adminRepliedAt: new Date() })
      setOrders((prev) =>
        prev.map((o) =>
          o.id === respondOrder.id ? { ...o, adminReply: replyText.trim(), adminRepliedAt: new Date() } : o
        )
      )
      setRespondOrder(null)
    } finally {
      setReplySaving(false)
    }
  }, [respondOrder, replyText])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const driverOptions = [
    { value: "all", label: "All drivers" },
    ...drivers
      .filter((d) => reviewedOrders.some((o) => o.assignedDriver === d.id))
      .map((d) => ({ value: d.id, label: d.name })),
  ]

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Reviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">Customer feedback and driver ratings</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 self-start text-xs"
          onClick={() => exportCSV(filtered, driverMap)}
        >
          <Download className="size-3.5" />
          Export CSV
        </Button>
      </div>

      {/* â”€â”€ Summary stats â”€â”€ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-yellow-100">
              <Star className="size-5 fill-yellow-400 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Order Rating</p>
              <p className="text-2xl font-bold">{orderAvg.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Driver Rating</p>
              <p className="text-2xl font-bold">{driverAvg.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-success/10">
              <CheckCircle2 className="size-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Reviews Received</p>
              <p className="text-2xl font-bold">
                {reviewedOrders.length}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ {deliveredCount}</span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
              <AlertTriangle className="size-5 text-destructive" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Needs Attention</p>
              <p className="text-2xl font-bold text-destructive">{escalationCount}</p>
            </div>
          </CardContent>
        </Card>
        {/* Response rate card */}
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Reply className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Response Rate</p>
              <p className="text-2xl font-bold">
                {reviewedOrders.length > 0
                  ? `${Math.round((reviewedOrders.filter((o) => o.adminReply).length / reviewedOrders.length) * 100)}%`
                  : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">{reviewedOrders.filter((o) => o.adminReply).length}/{reviewedOrders.length} replied</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* â”€â”€ Rating distributions â”€â”€ */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <RatingDistribution label="Order rating" average={orderAvg} distribution={orderDist} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <RatingDistribution label="Driver rating" average={driverAvg} distribution={driverDist} />
          </CardContent>
        </Card>
      </div>

      {/* â”€â”€ Rating trend chart â”€â”€ */}
      {trendData.some((d) => d.avg !== null) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-muted-foreground" />
              Rating Trend (Last 8 Weeks)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[1, 5]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={24} />
                <Tooltip
                  formatter={(value: number, _: string, props: { payload?: { count?: number } }) => [
                    `${value} â˜… (${props.payload?.count ?? 0} reviews)`,
                    "Avg Rating",
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Driver leaderboard â”€â”€ */}
      {driverLeaderboard.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-yellow-500" />
              Driver Rating Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Rank</th>
                    <th className="pb-2 text-left font-medium">Driver</th>
                    <th className="pb-2 text-center font-medium">Reviews</th>
                    <th className="pb-2 text-center font-medium">Avg Rating</th>
                    <th className="pb-2 text-left font-medium">Badge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {driverLeaderboard.map((row, i) => {
                    const badge =
                      row.avg >= 4.5 ? { label: "Top Performer", cls: "text-yellow-700 bg-yellow-100" }
                      : row.avg >= 3.5 ? { label: "Good", cls: "text-success bg-success/10" }
                      : row.avg >= 2.5 ? { label: "Average", cls: "text-warning bg-warning/10" }
                      : { label: "Needs Improvement", cls: "text-destructive bg-destructive/10" }
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-muted/40">
                        <td className="py-2.5 pr-4">
                          <span className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                            i === 0 ? "bg-yellow-100 text-yellow-700"
                            : i === 1 ? "bg-gray-100 text-gray-600"
                            : i === 2 ? "bg-orange-100 text-orange-600"
                            : "bg-muted text-muted-foreground"
                          }`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-foreground">{row.name}</td>
                        <td className="py-2.5 text-center text-muted-foreground">{row.reviews}</td>
                        <td className="py-2.5 text-center">
                          <span className="flex items-center justify-center gap-1">
                            <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
                            <span className="font-medium">{row.avg.toFixed(2)}</span>
                          </span>
                        </td>
                        <td className="py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
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

      {/* â”€â”€ Keyword frequency â”€â”€ */}
      {topKeywords.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Common Feedback Keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={topKeywords.map(([word, count]) => ({ word, count }))} layout="vertical" margin={{ left: 4, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="word" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Tabs â”€â”€ */}
      <div className="flex gap-2 border-b border-border">
        {(["all", "escalation"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "all" ? "All reviews" : "Escalations"}
            {t === "escalation" && escalationCount > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                {escalationCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* â”€â”€ Filters â”€â”€ */}
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="Date range"
          value={dateFilter}
          onChange={setDateFilter}
          options={[
            { value: "all", label: "All Time" },
            { value: "today", label: "Today" },
            { value: "week", label: "This Week" },
            { value: "month", label: "This Month" },
          ]}
        />
        <FilterSelect
          label="Filter by driver"
          value={driverFilter}
          onChange={setDriverFilter}
          options={driverOptions}
        />
        <FilterSelect
          label="Order rating"
          value={orderRatingFilter}
          onChange={setOrderRatingFilter}
          options={[
            { value: "all", label: "Order rating" },
            { value: "5", label: "5 Stars" },
            { value: "4", label: "4 Stars" },
            { value: "3", label: "3 Stars" },
            { value: "2", label: "2 Stars" },
            { value: "1", label: "1 Star" },
          ]}
        />
        <FilterSelect
          label="Driver rating"
          value={driverRatingFilter}
          onChange={setDriverRatingFilter}
          options={[
            { value: "all", label: "Driver rating" },
            { value: "5", label: "5 Stars" },
            { value: "4", label: "4 Stars" },
            { value: "3", label: "3 Stars" },
            { value: "2", label: "2 Stars" },
            { value: "1", label: "1 Star" },
          ]}
        />
        <FilterSelect
          label="Sort by"
          value={sortBy}
          onChange={setSortBy}
          options={[
            { value: "newest", label: "Sort: Newest" },
            { value: "oldest", label: "Sort: Oldest" },
            { value: "highest", label: "Sort: Highest" },
            { value: "lowest", label: "Sort: Lowest" },
          ]}
        />
        <span className="self-center text-xs text-muted-foreground">
          {filtered.length} review{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* â”€â”€ Review list â”€â”€ */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <MessageSquare className="size-10" />
            <p className="text-sm">No reviews match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const driver = order.assignedDriver ? driverMap.get(order.assignedDriver) : null
            const ratedDate = (() => {
              const d = toDate(order.customerRatedAt)
              return d ? format(d, "d MMM yyyy") : ""
            })()
            const isLow = (order.customerRating ?? 5) <= 2
            const rating = order.customerRating ?? 0
            const sentiment = rating >= 4 ? { label: "Positive", cls: "bg-green-100 text-green-700" } : rating === 3 ? { label: "Neutral", cls: "bg-amber-100 text-amber-700" } : { label: "Negative", cls: "bg-red-100 text-red-700" }

            return (
              <Card key={order.id} className={isLow ? "border-destructive/40" : ""}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    {/* Left */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isLow ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                          {order.customerName?.charAt(0)?.toUpperCase() ?? "?"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{order.customerName}</p>
                          <p className="text-xs text-muted-foreground">{ratedDate}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sentiment.cls}`}>{sentiment.label}</span>
                        {isLow && (
                          <span className="ml-auto flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive sm:ml-0">
                            <AlertTriangle className="size-3" /> Low rating
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Order: <span className="font-medium text-foreground">#{order.orderNumber}</span></span>
                        {driver && <span>Driver: <span className="font-medium text-foreground">{driver.name}</span></span>}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="flex items-center gap-1">
                          Order <StarRow rating={order.customerRating ?? 0} size="sm" />
                        </span>
                        {order.driverRating != null && order.driverRating > 0 && (
                          <span className="flex items-center gap-1">
                            Driver <StarRow rating={order.driverRating} size="sm" />
                          </span>
                        )}
                      </div>

                      {order.customerFeedback && (
                        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground">
                          &ldquo;{order.customerFeedback}&rdquo;
                        </p>
                      )}

                      {/* Admin reply */}
                      {order.adminReply && (
                        <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                          <Reply className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          <div>
                            <p className="text-xs font-medium text-primary">Admin reply</p>
                            <p className="text-xs text-foreground">{order.adminReply}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right ─ respond button + featured */}
                    <div className="flex shrink-0 items-start gap-1 self-start">
                      <button
                        onClick={() => handleToggleFeatured(order)}
                        className={`flex size-8 items-center justify-center rounded ${order.featured ? "text-amber-400" : "text-muted-foreground hover:text-amber-400"}`}
                        aria-label={order.featured ? "Unfeature review" : "Feature review"}
                      >
                        <Bookmark className="size-4" style={{ fill: order.featured ? "currentColor" : "none" }} />
                      </button>
                      <Button
                        variant={order.adminReply ? "outline" : "default"}
                        size="sm"
                        className="text-xs"
                        onClick={() => openRespond(order)}
                      >
                        <Reply className="size-3.5" />
                        {order.adminReply ? "Edit reply" : "Respond"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* â”€â”€ Respond dialog â”€â”€ */}
      <Dialog open={!!respondOrder} onOpenChange={(open) => !open && setRespondOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reply to {respondOrder?.customerName}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {respondOrder?.customerFeedback && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                &ldquo;{respondOrder.customerFeedback}&rdquo;
              </div>
            )}
            {/* Quick templates */}
            <div className="flex flex-wrap gap-1.5">
              {["Thank you for your feedback! 🙏", "Sorry for the delay. We'll do better!", "Glad you had a great experience! 😊", "We appreciate your review and will improve!"].map((tmpl) => (
                <button key={tmpl} onClick={() => setReplyText(tmpl)} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground">
                  {tmpl.slice(0, 30)}…
                </button>
              ))}
            </div>
            <Textarea
              placeholder="Type your reply to this customer..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRespondOrder(null)}>Cancel</Button>
            <Button onClick={saveReply} disabled={replySaving || !replyText.trim()}>
              {replySaving ? "Saving..." : "Save reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

