// Re-export types from constants for backwards compatibility
import type { OrderStatus, DriverStatus } from "./constants"
export type { OrderStatus, DriverStatus } from "./constants"

export interface OrderItem {
  name: string
  qty?: number
  price?: number
  meta?: string
}

export interface Order {
  id: string
  orderNumber: string
  customerName: string
  phone: string
  customerEmail?: string | null
  address: string
  amount: number
  status: OrderStatus
  assignedDriver: string | null
  items?: OrderItem[]

  // Pick-up From
  pickupName?: string
  pickupPhone?: string
  pickupAddress?: string
  pickupTime?: string

  // Deliver to scheduling
  deliveryDate?: string
  deliveryTime?: string

  // Order Details (optional)
  subtotal?: number
  taxRate?: number
  tax?: number
  deliveryFees?: number
  deliveryTips?: number
  discount?: number
  deliveryInstruction?: string
  paymentMethod?: string
  proofOfDelivery?: string
  proofOfPickup?: string
  deliveryNote?: string
  // Set by driver at delivery
  photoData?: string        // base64 JPEG delivery photo
  signatureData?: string    // base64 SVG customer signature
  signerName?: string       // name of person who signed at delivery
  deliveryLat?: number      // GPS latitude at moment of delivery
  deliveryLng?: number      // GPS longitude at moment of delivery

  customerRating?: number
  driverRating?: number
  customerFeedback?: string
  customerRatedAt?: unknown
  adminReply?: string
  adminRepliedAt?: unknown
  featured?: boolean
  distanceKm?: number
  urgent?: boolean
  adminNote?: string
  deliveryAttempts?: number
  lat?: number
  lng?: number
  routeOrder?: number
  createdAt?: unknown
  startedAt?: unknown
  pickedUpAt?: unknown
  inTransitAt?: unknown
  deliveredAt?: unknown
}

export interface Driver {
  id: string
  name: string
  phone: string
  email?: string
  area?: string
  vehicle: string
  model?: string
  plate?: string
  status: DriverStatus
  rating: number
  note?: string
  password?: string
  lastLocation?: { lat: number; lng: number }
  locationUpdatedAt?: unknown
  lastPingAt?: unknown
  lastPingError?: string | null
}

export interface NotificationChannelResult {
  sent: boolean
  reason?: string
  detail?: string
}

export interface NotificationLog {
  id: string
  event: "order_accepted" | "out_for_delivery" | "delivered"
  orderId: string
  orderNumber: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string | null
  sms: NotificationChannelResult
  whatsapp: NotificationChannelResult
  email: NotificationChannelResult
  createdAt?: unknown
}

/**
 * What the logistics business actually earns on an order.
 *
 * `amount` is the full order value — merchandise plus fees — which belongs to
 * the store, not to us. Reporting it as revenue overstates earnings by the
 * entire basket value, so a 16,950 order with a 2,000 delivery fee read as
 * 16,950 of logistics income.
 *
 * Tips are included because they are paid to the courier for the delivery
 * itself. Orders predating these fields contribute 0 rather than falling back
 * to `amount`, which would silently reintroduce the same overstatement.
 */
export function logisticsRevenue(order: Pick<Order, "deliveryFees" | "deliveryTips">): number {
  return (order.deliveryFees ?? 0) + (order.deliveryTips ?? 0)
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount)
}
