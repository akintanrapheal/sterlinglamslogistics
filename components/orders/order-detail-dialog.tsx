"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Download, MoreHorizontal, Printer, Trash2, Clock } from "lucide-react"
import { formatCurrency } from "@/lib/data"
import type { Order } from "@/lib/data"
import { format } from "date-fns"
import { formatOrderTime, formatTimeAmPm } from "@/lib/order-utils"
import { ORDER_STATUS_LABELS } from "@/lib/constants"

interface OrderDetailDialogProps {
  order: Order | null
  onClose: () => void
  onDelete: (orderId: string) => void
  getDriverDisplayName: (driverId: string | null) => string
}

function timestampToMs(ts: unknown): number | null {
  if (!ts) return null
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === "number") return ts
  if (typeof ts === "object" && ts !== null && "seconds" in ts)
    return (ts as { seconds: number }).seconds * 1000
  if (typeof ts === "string") {
    const d = new Date(ts)
    return isNaN(d.getTime()) ? null : d.getTime()
  }
  return null
}

function calcDuration(from: unknown, to: unknown): string {
  const fromMs = timestampToMs(from)
  const toMs = timestampToMs(to)
  if (!fromMs || !toMs) return "N/A"
  const diffMins = Math.round((toMs - fromMs) / 60000)
  if (diffMins < 1) return "< 1 min"
  if (diffMins < 60) return `${diffMins} mins`
  const hrs = Math.floor(diffMins / 60)
  const rem = diffMins % 60
  return rem > 0 ? `${hrs} hour${hrs > 1 ? "s" : ""} ${rem} mins` : `${hrs} hour${hrs > 1 ? "s" : ""}`
}

export function OrderDetailDialog({ order, onClose, onDelete, getDriverDisplayName }: OrderDetailDialogProps) {
  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-[700px] max-h-[90vh] overflow-y-auto">
        {order && (
          <>
            <DialogHeader>
              <div className="flex justify-between items-start w-full">
                <div>
                  <DialogTitle className="text-xl font-bold">
                    Order #: {order.orderNumber}
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    Status: {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent sideOffset={4} align="end">
                    <DropdownMenuItem onSelect={() => window.print()}>
                      <Download className="mr-2 h-4 w-4" />
                      Download PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print order
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(order.id)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <DialogDescription className="sr-only">Order details</DialogDescription>
            </DialogHeader>

            {/* Deliver to / Pick-up From */}
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="rounded-md border p-3 space-y-1">
                <p className="font-semibold text-sm">Deliver to</p>
                <p className="text-sm font-medium">{order.customerName}</p>
                <p className="text-sm text-muted-foreground">{order.address}</p>
                <p className="text-sm text-muted-foreground">{order.phone}</p>
                {order.customerEmail && (
                  <p className="text-sm text-muted-foreground">{order.customerEmail}</p>
                )}
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="font-semibold text-sm">Pick-up From</p>
                <p className="text-sm font-medium">{order.pickupName || "Sterlin Glams"}</p>
                <p className="text-sm text-muted-foreground">{order.pickupAddress || "Sterlin Glams – Ikota Ajah Lagos"}</p>
                <p className="text-sm text-muted-foreground">{order.pickupPhone || "+2349160009893"}</p>
              </div>
            </div>

            {/* Order items */}
            <div className="rounded-md border p-3 space-y-3">
              <p className="font-semibold text-sm">Order</p>
              {(order.items ?? []).length > 0 ? (order.items ?? []).map((item, idx) => (
                <div key={idx}>
                  <div className="flex justify-between items-start">
                    <p className="text-sm">
                      <span className="text-muted-foreground mr-2">{item.qty ?? 1}</span>
                      x {item.name}
                    </p>
                    <p className="text-sm font-medium whitespace-nowrap ml-4">
                      {formatCurrency((item.price ?? 0) * (item.qty ?? 1))}
                    </p>
                  </div>
                  {item.meta && (
                    <p className="text-xs text-muted-foreground ml-8 whitespace-pre-line">{item.meta}</p>
                  )}
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No items</p>
              )}
              <div className="border-t pt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{order.tax ? formatCurrency(order.tax) : "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery Fees</span>
                  <span>{order.deliveryFees ? formatCurrency(order.deliveryFees) : "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery Tips</span>
                  <span>{order.deliveryTips ? formatCurrency(order.deliveryTips) : "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span>{order.discount ? formatCurrency(order.discount) : "N/A"}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(order.amount)}</span>
                </div>
              </div>
            </div>

            {/* Delivery Details */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-semibold text-sm">Delivery Details</p>
              <div className="grid grid-cols-2 gap-x-4 text-sm">
                <p>
                  <span className="text-muted-foreground">Order Placement Time: </span>
                  {formatOrderTime(order.createdAt)}
                </p>
                <p>
                  <span className="text-muted-foreground">Driver: </span>
                  {getDriverDisplayName(order.assignedDriver)}
                </p>
              </div>
              <p className="text-sm">
                <span className="text-muted-foreground">Requested Pickup Time: </span>
                {formatTimeAmPm(order.pickupTime)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Requested Delivery Time: </span>
                {order.deliveryDate
                  ? `${new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(order.deliveryDate + "T12:00:00"))}${order.deliveryTime ? " " + formatTimeAmPm(order.deliveryTime) : ""}`
                  : "N/A"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Order Accept Time: </span>
                {formatOrderTime(order.startedAt) === "--" ? "N/A" : formatOrderTime(order.startedAt)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Order Pickup Time: </span>
                {formatOrderTime(order.pickedUpAt) === "--" ? "N/A" : formatOrderTime(order.pickedUpAt)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Order Delivery Time: </span>
                {formatOrderTime(order.inTransitAt) === "--" ? "N/A" : formatOrderTime(order.inTransitAt)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Order Completion Time: </span>
                {order.deliveredAt
                  ? calcDuration(order.createdAt, order.deliveredAt)
                  : formatOrderTime(order.deliveredAt) === "--" ? "N/A" : formatOrderTime(order.deliveredAt)}
              </p>
              {order.deliveryInstruction && (
                <div className="border-t pt-2 text-sm">
                  <span className="text-muted-foreground">Delivery Instruction: </span>
                  {order.deliveryInstruction}
                </div>
              )}
              {order.signatureData && (
                <div className="border-t pt-2 text-sm">
                  <span className="text-muted-foreground">Dropoff Instructions: </span>
                  Signed by: {order.signerName || getDriverDisplayName(order.assignedDriver)}
                </div>
              )}
            </div>

            {/* Payment / Proof of Delivery / Proof of Pickup */}
            <div className="rounded-md border p-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                {/* Payment */}
                <div className="space-y-1">
                  <p className="font-semibold">Payment Details</p>
                  <p>
                    <span className="text-muted-foreground">Payment Method: </span>
                    {order.paymentMethod || "N/A"}
                  </p>
                </div>

                {/* Proof of Delivery — signature first, fallback to photo */}
                <div className="space-y-1">
                  <p className="font-semibold">Proof of Delivery</p>
                  {order.signatureData ? (
                    <img
                      src={order.signatureData}
                      alt="Customer signature"
                      className="h-20 w-full object-contain border rounded bg-white"
                    />
                  ) : order.photoData ? (
                    <img
                      src={order.photoData}
                      alt="Delivery photo"
                      className="h-20 w-full object-cover rounded"
                    />
                  ) : order.proofOfDelivery ? (
                    <img
                      src={order.proofOfDelivery}
                      alt="Proof of delivery"
                      className="h-20 w-full object-cover rounded"
                    />
                  ) : (
                    <p className="text-orange-500 text-xs font-medium">No Proof of Delivery Taken</p>
                  )}
                </div>

                {/* Proof of Pickup */}
                <div className="space-y-1">
                  <p className="font-semibold">Proof of Pickup</p>
                  {order.proofOfPickup ? (
                    <img
                      src={order.proofOfPickup}
                      alt="Proof of pickup"
                      className="h-20 w-full object-cover rounded"
                    />
                  ) : (
                    <p className="text-orange-500 text-xs font-medium">No Proof of Pickup Taken</p>
                  )}
                </div>
              </div>

              {/* Delivery note */}
              <div className="border-t mt-3 pt-2 text-sm">
                <span className="text-muted-foreground">Delivery Note: </span>
                {order.deliveryNote || "N/A"}
              </div>

              {/* GPS delivery location */}
              {order.deliveryLat != null && order.deliveryLng != null && (
                <div className="mt-1 text-sm">
                  <a
                    href={`https://www.google.com/maps?q=${order.deliveryLat},${order.deliveryLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-800"
                  >
                    Delivery Location ({order.deliveryLat.toFixed(7)}, {order.deliveryLng.toFixed(7)})
                  </a>
                </div>
              )}
            </div>

            {/* ── Order timeline ── */}
            {(() => {
              const events: { label: string; ts: unknown }[] = [
                { label: "Order placed", ts: order.createdAt },
                { label: "Driver assigned", ts: order.startedAt },
                { label: "Picked up", ts: order.pickedUpAt },
                { label: "In transit", ts: order.inTransitAt },
                { label: "Delivered", ts: order.deliveredAt },
              ].filter((e) => {
                if (!e.ts) return false
                const ms = timestampToMs(e.ts)
                return ms !== null && ms > 0
              })
              if (events.length === 0) return null
              return (
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Clock className="size-4 text-muted-foreground" />
                    <p className="text-sm font-semibold">Order Timeline</p>
                  </div>
                  <ol className="relative ml-2 space-y-3 border-l border-border">
                    {events.map((evt, i) => {
                      const ms = timestampToMs(evt.ts)
                      return (
                        <li key={i} className="ml-4">
                          <span className="absolute -left-1.5 mt-0.5 flex size-3 items-center justify-center rounded-full bg-primary ring-2 ring-background" />
                          <p className="text-xs font-medium text-foreground">{evt.label}</p>
                          <p className="text-[11px] text-muted-foreground">{ms ? format(new Date(ms), "d MMM yyyy, HH:mm") : ""}</p>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
