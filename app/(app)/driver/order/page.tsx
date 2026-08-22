"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Navigation,
  Phone,
  Clock,
  Loader2,
  Star,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { driverFetch } from "@/lib/driver-client"
import { parseFirestoreDate } from "@/lib/order-utils"
import { formatCurrency } from "@/lib/data"
import type { Order } from "@/lib/data"
import { useDriver } from "@/components/driver-context"
import { buildNavUrl, getNavApp } from "@/lib/nav"
import { HUB_NAME, HUB_ADDRESS, HUB_PHONE } from "@/lib/hub"

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function formatEta(ms: number): string {
  if (ms <= 0) return "Arriving now"
  const mins = Math.ceil(ms / 60000)
  if (mins < 60) return `~${mins} min`
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`
}

function formatDate(date: unknown): string {
  const d = parseFirestoreDate(date)
  if (!d) return ""
  return d.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function OrderDetailPage() {
  // Read the id from ?id=… (works in both the dynamic /order/[id] web
  // route and the static-export driver-mobile-2 build where dynamic
  // segments can't be pre-rendered).
  const searchParams = useSearchParams()
  const orderId = searchParams.get("id") ?? ""
  const router = useRouter()
  const { liveGps, driver, orders } = useDriver()
  // Seed from the list the dashboard already loaded, so tapping an order
  // renders its details immediately instead of showing a spinner while
  // refetching a record the app is holding in memory.
  const cached = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId])
  const [order, setOrder] = useState<Order | null>(cached)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    // Still fetch: the detail endpoint can carry fields the list omits, and
    // the record may have changed. But only block on it when there was no
    // cached copy to show in the meantime.
    let cancelled = false
    driverFetch(`/api/driver/orders/${encodeURIComponent(orderId)}`, {})
      .then((r) => r.json())
      .then((d: { ok: boolean; order?: Order }) => {
        if (cancelled) return
        // Keep the cached record if the refresh comes back empty, rather than
        // replacing a usable screen with "Order not found".
        if (d.order) setOrder(d.order)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orderId])

  // A later context refresh (poll, pull-to-refresh) should flow through too.
  useEffect(() => {
    if (cached) setOrder((prev) => prev ?? cached)
  }, [cached])

  // ETA: distance from driver GPS to order coordinates ÷ 25 km/h (avg Lagos speed)
  const etaMs = useMemo(() => {
    const activeStatuses = ["started", "picked-up", "in-transit"]
    if (!order || !activeStatuses.includes(order.status)) return null
    const driverPos = liveGps ?? driver?.lastLocation ?? null
    if (!driverPos) return null
    const dest =
      typeof order.lat === "number" && typeof order.lng === "number"
        ? { lat: order.lat, lng: order.lng }
        : null
    if (!dest) return null
    const distKm = haversineKm(driverPos, dest)
    return (distKm / 25) * 3600 * 1000
  }, [order, liveGps, driver?.lastLocation])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground">Order not found</p>
        <button
          type="button"
          onClick={() => router.push("/driver/dashboard")}
          className="rounded-xl bg-green-600 px-6 py-2 text-sm font-semibold text-white"
        >
          Go Back
        </button>
      </div>
    )
  }

  const statusLabel =
    order.status === "started"
      ? "Started"
      : order.status === "picked-up"
        ? "Picked Up"
        : order.status === "in-transit"
          ? "In Transit"
          : order.status === "delivered"
            ? "Delivered"
            : order.status

  const itemsTotal = order.items?.reduce((sum, item) => {
    const qty = item.qty ?? 1
    const price = item.price ?? 0
    return sum + qty * price
  }, 0) ?? 0

  const paymentLabel = (order.paymentMethod ?? "Online").toUpperCase()
  const pickupTimestamp = order.startedAt ?? order.createdAt
  const deliveryTimestamp = order.deliveredAt ?? order.inTransitAt ?? order.startedAt ?? order.createdAt

  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg p-1.5 hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-center text-base font-bold">Order Details</h1>
        <div className="w-9" />
      </div>

      {/* Payment type */}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {paymentLabel}
      </p>

      {/* Order # + status + nav */}
      <div className="mt-2 flex items-start justify-between">
        <div>
          <p className="text-sm text-foreground">
            Order #: <span className="font-bold">{order.orderNumber}</span>
          </p>
          <p className="mt-0.5 text-sm text-foreground">({formatCurrency(order.amount)})</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge variant="outline" className="bg-gray-800 text-white border-gray-800 text-xs">
            {statusLabel}
          </Badge>
          <button
            type="button"
            onClick={() => window.open(buildNavUrl(order.address, getNavApp()), "_blank", "noopener")}
            className="rounded-lg p-1 hover:bg-muted"
            title="Navigate"
          >
            <Navigation className="h-5 w-5 text-foreground" />
          </button>
        </div>
      </div>

      {/* Placement time */}
      {!!order.createdAt && (
        <p className="mt-2 text-sm text-muted-foreground">
          Placement time: {formatDate(order.createdAt)}
        </p>
      )}

      {/* ETA (only while active) */}
      {etaMs !== null && (
        <div className="mt-2 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">ETA:</span>
          <span className="text-sm font-semibold text-green-600">{formatEta(etaMs)}</span>
        </div>
      )}

      <div className="my-4 h-px bg-border" />

      {/* Timeline — pickup + delivery */}
      <div className="space-y-1">
        {/* Pick up */}
        <div className="flex gap-4">
          <div className="flex w-4 flex-col items-center">
            <div className="mt-1 h-3 w-3 rounded-full bg-gray-400" />
            <div className="my-1 w-0.5 flex-1 bg-border" />
          </div>
          <div className="flex-1 pb-5">
            <p className="text-sm text-muted-foreground">
              Pick up&nbsp;&nbsp;<span className="font-bold text-foreground">{formatDate(pickupTimestamp)}</span>
            </p>
            <p className="mt-1 text-base font-bold">{HUB_NAME}</p>
            <p className="text-sm text-muted-foreground">{HUB_ADDRESS}</p>
            <a
              href={`tel:${HUB_PHONE}`}
              className="mt-1 inline-block text-sm font-medium text-teal-600"
            >
              {HUB_PHONE}
            </a>
          </div>
        </div>

        {/* Delivery */}
        <div className="flex gap-4">
          <div className="flex w-4 flex-col items-center">
            <div className="mt-1 h-3 w-3 rounded-full bg-gray-400" />
          </div>
          <div className="flex-1 pb-1">
            <p className="text-sm text-muted-foreground">
              Delivery&nbsp;&nbsp;<span className="font-bold text-foreground">{formatDate(deliveryTimestamp)}</span>
            </p>
            <p className="mt-1 text-base font-bold">{order.customerName}</p>
            <p className="text-sm text-muted-foreground">{order.address}</p>
            {order.phone && (
              <a
                href={`tel:${order.phone}`}
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-teal-600"
              >
                <Phone className="h-3.5 w-3.5" />
                {order.phone}
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="my-4 h-px bg-border" />

      {/* Customer note (only when present) */}
      {order.deliveryInstruction && (
        <>
          <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Customer Note
          </h3>
          <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-foreground">
            {order.deliveryInstruction}
          </div>
          <div className="my-4 h-px bg-border" />
        </>
      )}

      {/* Order Items */}
      {order.items && order.items.length > 0 && (
        <>
          <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Order Items
          </h3>
          <div className="space-y-2">
            {order.items.map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 py-1.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-400 text-xs font-bold text-white">
                  {item.qty ?? 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-foreground">{item.name}</p>
                </div>
                {item.price != null && (
                  <span className="text-sm font-semibold">{formatCurrency(item.price)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Items Total */}
          <div className="mt-2 flex justify-between border-t pt-3 text-sm font-bold">
            <span>Items Total:</span>
            <span>{formatCurrency(itemsTotal || order.amount)}</span>
          </div>

          <div className="my-4 h-px bg-border" />

          {/* Financial breakdown */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-foreground">Tax:</span>
              <span>{formatCurrency(order.tax ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-foreground">Delivery Fee:</span>
              <span>{formatCurrency(order.deliveryFees ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-foreground">Delivery Tips:</span>
              <span>{formatCurrency(order.deliveryTips ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-red-500">Discount:</span>
              <span>{formatCurrency(order.discount ?? 0)}</span>
            </div>
          </div>

          {/* Grand total */}
          <div className="my-2 flex justify-between border-y py-4">
            <span className="text-base font-bold">Total</span>
            <span className="text-base font-bold">{formatCurrency(order.amount)}</span>
          </div>
        </>
      )}

      {/* Customer Rating */}
      {order.status === "delivered" && (order.customerRating || order.driverRating) && (
        <div className="mb-4 rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Customer Rating
          </h3>
          {order.driverRating != null && order.driverRating > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-sm font-medium text-foreground">Driver rating</p>
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-5 w-5 ${
                      i < order.driverRating!
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground/30"
                    }`}
                  />
                ))}
                <span className="ml-2 text-sm font-semibold text-foreground">{order.driverRating}/5</span>
              </div>
            </div>
          )}
          {order.customerRating != null && order.customerRating > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-sm font-medium text-foreground">Order rating</p>
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-5 w-5 ${
                      i < order.customerRating!
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground/30"
                    }`}
                  />
                ))}
                <span className="ml-2 text-sm font-semibold text-foreground">{order.customerRating}/5</span>
              </div>
            </div>
          )}
          {order.customerFeedback && (
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Feedback</p>
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground italic">
                &ldquo;{order.customerFeedback}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}

      {order.status === "delivered" && !order.customerRating && !order.driverRating && (
        <div className="mb-4 rounded-xl border border-dashed bg-card p-4 text-center">
          <Star className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No customer rating yet</p>
        </div>
      )}
    </div>
  )
}
