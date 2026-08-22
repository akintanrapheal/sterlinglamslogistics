"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Menu, ChevronDown, Star, CheckCircle2, Truck, Banknote, ThumbsUp } from "lucide-react"
import { useDriver } from "@/components/driver-context"
import { driverFetch } from "@/lib/driver-client"
import { parseFirestoreDate } from "@/lib/order-utils"
import type { Order } from "@/lib/data"
import { formatCurrency } from "@/lib/data"
import { cn } from "@/lib/utils"

const filterOptions = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "last_100", label: "Last 100 orders" },
]

function getDateRange(filter: string): { start: Date; end: Date } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (filter) {
    case "today":
      return { start: today, end: now }
    case "yesterday": {
      const yStart = new Date(today)
      yStart.setDate(yStart.getDate() - 1)
      return { start: yStart, end: today }
    }
    case "this_week": {
      const day = today.getDay()
      const wStart = new Date(today)
      wStart.setDate(wStart.getDate() - day)
      return { start: wStart, end: now }
    }
    case "last_week": {
      const day = today.getDay()
      const thisWeekStart = new Date(today)
      thisWeekStart.setDate(thisWeekStart.getDate() - day)
      const lastWeekStart = new Date(thisWeekStart)
      lastWeekStart.setDate(lastWeekStart.getDate() - 7)
      return { start: lastWeekStart, end: thisWeekStart }
    }
    case "this_month": {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: mStart, end: now }
    }
    case "last_month": {
      const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: lmStart, end: lmEnd }
    }
    default:
      return null // last_100
  }
}

export default function DriverPerformancePage() {
  const router = useRouter()
  const { session, driver, loadingSession, setDrawerOpen, orders: allOrders, refreshOrders, loadingOrders } = useDriver()
  const [filter, setFilter] = useState("this_week")
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    if (!loadingSession && !session) {
      router.replace("/driver")
    }
  }, [loadingSession, session, router])

  // Read the shared order list rather than pulling /api/driver/orders again.
  // This screen refetched the driver's entire order history on every visit and
  // held a spinner over the whole page while it did, even though the context
  // had already loaded exactly that list. Revalidate in the background so the
  // stats stay current without blanking the screen.
  useEffect(() => {
    if (session) void refreshOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Spinner only when there is genuinely nothing cached to render.
  const loading = loadingOrders && allOrders.length === 0

  // Compute stats based on filter
  const filteredOrders = (() => {
    if (filter === "last_100") {
      return allOrders
        .filter((o) => o.status === "delivered")
        .sort((a, b) => (parseFirestoreDate(b.deliveredAt)?.getTime() ?? 0) - (parseFirestoreDate(a.deliveredAt)?.getTime() ?? 0))
        .slice(0, 100)
    }

    const range = getDateRange(filter)
    if (!range) return allOrders

    return allOrders.filter((o) => {
      const ts = parseFirestoreDate(o.createdAt)?.getTime() ?? 0
      return ts >= range.start.getTime() && ts < range.end.getTime()
    })
  })()

  const deliveredOrders = filteredOrders.filter((o) => o.status === "delivered")
  const completedCount = deliveredOrders.length
  const earnings = deliveredOrders.reduce((sum, o) => sum + (o.amount ?? 0), 0)

  // Derive real stats only — no guesses or random values
  const rating = driver?.rating ?? 0
  const ratedOrders = deliveredOrders.filter((o) => typeof o.driverRating === "number" && (o.driverRating as number) > 0)
  const avgDriverRating = ratedOrders.length > 0
    ? ratedOrders.reduce((s, o) => s + (o.driverRating as number), 0) / ratedOrders.length
    : null
  const failedOrCancelled = filteredOrders.filter((o) => o.status === "failed" || o.status === "cancelled").length
  const totalClosed = completedCount + failedOrCancelled
  const successRate = totalClosed > 0 ? Math.round((completedCount / totalClosed) * 100) : 100

  const filterLabel = filterOptions.find((o) => o.value === filter)?.label ?? filter

  const stats = [
    {
      label: "Customer Rating",
      value: rating > 0 ? rating.toFixed(1) : "—",
      icon: Star,
      iconColor: "text-yellow-500",
      bgColor: "bg-yellow-50",
    },
    {
      label: "Avg Driver Rating",
      value: avgDriverRating !== null ? avgDriverRating.toFixed(1) : "—",
      icon: ThumbsUp,
      iconColor: "text-blue-500",
      bgColor: "bg-blue-50",
    },
    {
      label: "Success Rate",
      value: `${successRate}%`,
      icon: CheckCircle2,
      iconColor: "text-green-500",
      bgColor: "bg-green-50",
    },
    {
      label: "Completed Deliveries",
      value: completedCount.toString(),
      icon: Truck,
      iconColor: "text-purple-500",
      bgColor: "bg-purple-50",
    },
    {
      label: "Earnings",
      value: formatCurrency(earnings),
      icon: Banknote,
      iconColor: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      label: "Failed / Cancelled",
      value: failedOrCancelled.toString(),
      icon: Truck,
      iconColor: "text-red-500",
      bgColor: "bg-red-50",
    },
  ]

  if (loadingSession || !session) return null

  return (
    <div className="mx-auto max-w-md px-4 pb-8">
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
          <h1 className="text-lg font-bold">Performance</h1>
        </div>
      </div>

      {/* Filter dropdown */}
      <div className="relative mb-5">
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium"
        >
          {filterLabel}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>

        {showDropdown && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowDropdown(false)} />
            <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border bg-background py-1 shadow-xl">
              {filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setFilter(opt.value)
                    setShowDropdown(false)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-muted",
                    filter === opt.value && "font-semibold"
                  )}
                >
                  <span>{opt.label}</span>
                  {filter === opt.value && (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border bg-card p-4"
          >
            <div className={cn("mb-2 flex h-10 w-10 items-center justify-center rounded-xl", stat.bgColor)}>
              <stat.icon className={cn("h-5 w-5", stat.iconColor)} />
            </div>
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
