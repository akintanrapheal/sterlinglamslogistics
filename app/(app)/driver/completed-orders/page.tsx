"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Package } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { parseFirestoreDate } from "@/lib/order-utils"
import { formatCurrency } from "@/lib/data"
import { useDriver } from "@/components/driver-context"
import { cn } from "@/lib/utils"

function isToday(date: unknown): boolean {
  const d = parseFirestoreDate(date)
  if (!d) return false
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

function isYesterday(date: unknown): boolean {
  const d = parseFirestoreDate(date)
  if (!d) return false
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return d.toDateString() === yesterday.toDateString()
}

type Tab = "today" | "yesterday" | "all"

export default function DriverCompletedOrdersPage() {
  const router = useRouter()
  const { session, orders: allOrders, refreshOrders, loadingOrders } = useDriver()
  const [tab, setTab] = useState<Tab>("today")

  // Derived from the list the context already holds, so the screen paints on
  // the first frame. It used to refetch /api/driver/orders in full and sit on
  // a spinner just to filter for delivered — data already in memory, fetched
  // again on every visit to this tab.
  const orders = useMemo(
    () =>
      allOrders
        .filter((order) => order.status === "delivered")
        .sort((a, b) => {
          const aTime = parseFirestoreDate(a.deliveredAt)?.getTime() ?? 0
          const bTime = parseFirestoreDate(b.deliveredAt)?.getTime() ?? 0
          return bTime - aTime
        }),
    [allOrders],
  )

  // Revalidate in the background. Deliberately not awaited and not tied to a
  // spinner: whatever is already on screen stays put while it runs.
  useEffect(() => {
    if (session) void refreshOrders()
    // Once per mount — refreshOrders is stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Only block on the very first load, when there is genuinely nothing to show.
  const loading = loadingOrders && allOrders.length === 0

  const todayOrders = orders.filter((o) => isToday(o.deliveredAt))
  const yesterdayOrders = orders.filter((o) => isYesterday(o.deliveredAt))
  const displayedOrders = tab === "today" ? todayOrders : tab === "yesterday" ? yesterdayOrders : orders

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "today", label: "Today", count: todayOrders.length },
    { key: "yesterday", label: "Yesterday", count: yesterdayOrders.length },
    { key: "all", label: "All", count: orders.length },
  ]

  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-background py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg p-1.5 hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Completed Orders</h1>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex rounded-xl border bg-muted/50 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Orders list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : displayedOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Package className="mb-3 h-16 w-16 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No completed orders</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedOrders.map((order) => {
            const deliveredAt = parseFirestoreDate(order.deliveredAt)
            return (
              <div key={order.id} className="rounded-xl border bg-card p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{order.orderNumber}</p>
                    <p className="text-sm text-muted-foreground">{order.customerName}</p>
                  </div>
                  <Badge variant="outline" className="bg-success/15 text-success border-success/20">
                    Delivered
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{order.address}</p>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-sm font-medium">{formatCurrency(order.amount)}</p>
                  {deliveredAt && (
                    <p className="text-xs text-muted-foreground">
                      {deliveredAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
