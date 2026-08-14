import { adminDb } from "./firebase-admin"
import { hashPassword, isHashed } from "@/lib/password"
import { ORDER_STATUS } from "@/lib/constants"
import { geocodeAddress, haversineDistanceKm, getHubCoordinates, getGeocodeHealth } from "@/lib/geocode"
import { getServerMapsKey } from "./maps-key"
import type { Order, Driver } from "@/lib/data"

async function calculateDistanceKm(
  address: string
): Promise<{ distanceKm?: number; lat?: number; lng?: number }> {
  const destination = await geocodeAddress(address, { apiKey: await getServerMapsKey() })
  if (!destination) return {}
  const distanceKm = haversineDistanceKm(getHubCoordinates(), destination)
  return { distanceKm, lat: destination.lat, lng: destination.lng }
}

// ── Document normalization ────────────────────────────────────────────────────

function toDate(val: unknown): Date | undefined {
  if (!val) return undefined
  if (val instanceof Date) return val
  if (typeof (val as { toDate?: unknown }).toDate === "function")
    return (val as { toDate: () => Date }).toDate()
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d
  }
  return undefined
}

function normalizeOrderStatus(status: unknown): Order["status"] {
  if (status === "pending") return ORDER_STATUS.UNASSIGNED
  if (status === "assigned") return ORDER_STATUS.STARTED
  if (status === ORDER_STATUS.STARTED) return ORDER_STATUS.STARTED
  if (status === ORDER_STATUS.PICKED_UP) return ORDER_STATUS.PICKED_UP
  if (status === ORDER_STATUS.IN_TRANSIT) return ORDER_STATUS.IN_TRANSIT
  if (status === ORDER_STATUS.DELIVERED) return ORDER_STATUS.DELIVERED
  if (status === ORDER_STATUS.FAILED) return ORDER_STATUS.FAILED
  if (status === ORDER_STATUS.CANCELLED) return ORDER_STATUS.CANCELLED
  return ORDER_STATUS.UNASSIGNED
}

function normalizeOrderDoc(id: string, data: Record<string, unknown>): Order {
  return {
    ...(data as Omit<Order, "id" | "status">),
    id,
    status: normalizeOrderStatus(data.status),
    createdAt: toDate(data.createdAt),
    startedAt: toDate(data.startedAt),
    completedAt: toDate(data.completedAt),
  } as Order
}

// ── Orders ────────────────────────────────────────────────────────────────────

export async function adminFetchOrder(orderId: string): Promise<Order | null> {
  const snap = await adminDb.collection("orders").doc(orderId).get()
  if (!snap.exists) return null
  return normalizeOrderDoc(snap.id, snap.data() as Record<string, unknown>)
}

export async function adminFetchOrderByTracking(tracking: string): Promise<Order | null> {
  const token = tracking.trim()
  if (!token) return null
  const snap = await adminDb
    .collection("orders")
    .where("orderNumber", "==", token)
    .get()
  if (!snap.empty) {
    // Sort in memory — most recently created order wins (no composite index needed)
    const toMs = (v: unknown): number => {
      if (!v) return 0
      if (typeof v === "object" && v !== null && "seconds" in v) return (v as { seconds: number }).seconds * 1000
      return new Date(v as string | number).getTime()
    }
    const sorted = snap.docs.slice().sort((a, b) => toMs(b.data().createdAt) - toMs(a.data().createdAt))
    const d = sorted[0]
    return normalizeOrderDoc(d.id, d.data() as Record<string, unknown>)
  }
  return adminFetchOrder(token)
}

export async function adminUpdateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
  let geoUpdate: { distanceKm?: number; lat?: number; lng?: number } = {}
  if (typeof updates.address === "string" && updates.address.trim()) {
    geoUpdate = await calculateDistanceKm(updates.address)
  }
  await adminDb.collection("orders").doc(orderId).update({
    ...updates,
    ...geoUpdate,
    updatedAt: new Date(),
  })
}

export async function adminCreateOrderWithId(
  orderId: string,
  order: Omit<Order, "id">
): Promise<string> {
  const geo = await calculateDistanceKm(order.address)
  await adminDb.collection("orders").doc(orderId).set({
    ...order,
    ...geo,
    createdAt: new Date(),
  })
  return orderId
}

export async function adminOrderExists(orderNumber: string): Promise<boolean> {
  const stripped = orderNumber.replace(/^WC-/i, "")
  const snap = await adminDb
    .collection("orders")
    .where("orderNumber", "in", [stripped, `WC-${stripped}`])
    .get()
  return !snap.empty
}

// ── Drivers ───────────────────────────────────────────────────────────────────

export async function adminFetchDriverById(driverId: string): Promise<Driver | null> {
  const snap = await adminDb.collection("drivers").doc(driverId).get()
  if (!snap.exists) return null
  return { id: snap.id, ...snap.data() } as Driver
}

export async function adminCreateDriver(driver: Omit<Driver, "id">): Promise<string> {
  const driverData = { ...driver }
  if (driverData.password) driverData.password = await hashPassword(driverData.password)
  // New drivers start offline — they become "available" only when they go online in the app
  driverData.status = "offline"
  // Pre-compute normalized phone for fast indexed login lookups
  const rawPhone = String(driverData.phone ?? "")
  const digits = rawPhone.replace(/\D/g, "")
  let phoneNormalized: string | null = null
  if (digits.length === 10) phoneNormalized = digits
  else if (digits.length === 11 && digits.startsWith("0")) phoneNormalized = digits.slice(1)
  else if (digits.length >= 13 && digits.startsWith("234")) phoneNormalized = digits.slice(-10)
  else if (digits.length > 10) phoneNormalized = digits.slice(-10)

  const ref = await adminDb.collection("drivers").add({
    ...driverData,
    ...(phoneNormalized ? { phoneNormalized } : {}),
    createdAt: new Date(),
  })
  return ref.id
}

export async function adminUpdateDriver(
  driverId: string,
  updates: Partial<Driver>
): Promise<void> {
  const updatesData = { ...updates }
  if (updatesData.password && !isHashed(updatesData.password)) {
    updatesData.password = await hashPassword(updatesData.password)
  }
  await adminDb.collection("drivers").doc(driverId).update({ ...updatesData, updatedAt: new Date() })
}

export async function adminDeleteDriver(driverId: string): Promise<void> {
  await adminDb.collection("drivers").doc(driverId).delete()
}

export async function adminUpdateDriverLocation(
  driverId: string,
  lat: number,
  lng: number
): Promise<void> {
  const now = new Date()
  await Promise.all([
    adminDb.collection("drivers").doc(driverId).update({
      lastLocation: { lat, lng },
      locationUpdatedAt: now,
    }),
    // Mirror to public driverLocations collection so the customer tracking
    // page can subscribe via Firestore real-time without reading driver docs
    // (which contain sensitive fields like password hashes).
    adminDb.collection("driverLocations").doc(driverId).set({
      lat,
      lng,
      updatedAt: now,
    }),
  ])
}

export async function adminRecordDriverPing(
  driverId: string,
  lat: unknown,
  lng: unknown,
  error: string | null
): Promise<void> {
  const update: Record<string, unknown> = { lastPingAt: new Date() }
  if (error) update.lastPingError = `${error} (lat=${lat},lng=${lng})`
  else update.lastPingError = null
  await adminDb.collection("drivers").doc(driverId).update(update).catch(() => null)
}

// ── Route optimization ────────────────────────────────────────────────────────

export async function adminSaveOptimizedRouteOrder(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      adminDb
        .collection("orders")
        .doc(id)
        .update({ routeOrder: i })
        .catch(() => null)
    )
  )
}

// ── Ratings ───────────────────────────────────────────────────────────────────

export async function adminRecalculateDriverRating(driverId: string): Promise<number> {
  const snap = await adminDb
    .collection("orders")
    .where("assignedDriver", "==", driverId)
    .where("driverRating", ">", 0)
    .get()
  if (snap.empty) return 0
  let sum = 0
  for (const d of snap.docs) sum += (d.data().driverRating as number) ?? 0
  const rounded = Math.round((sum / snap.size) * 10) / 10
  await adminUpdateDriver(driverId, { rating: rounded })
  return rounded
}

// ── Bulk admin utilities ──────────────────────────────────────────────────────

export async function adminCleanOrderNumbersWC(): Promise<number> {
  const snap = await adminDb
    .collection("orders")
    .where("orderNumber", ">=", "WC-")
    .where("orderNumber", "<", "WC.`")
    .get()
  let updated = 0
  for (const d of snap.docs) {
    const orderNumber = d.data().orderNumber
    if (typeof orderNumber === "string" && orderNumber.startsWith("WC-")) {
      await d.ref.update({ orderNumber: orderNumber.replace(/^WC-/, "") })
      updated++
    }
  }
  return updated
}

export async function adminRemoveDuplicateOrders(): Promise<number> {
  const snap = await adminDb.collection("orders").get()
  const orderMap = new Map<string, { id: string; createdAt: unknown }[]>()
  for (const d of snap.docs) {
    const data = d.data()
    const orderNumber = data.orderNumber as string
    if (!orderNumber) continue
    if (!orderMap.has(orderNumber)) orderMap.set(orderNumber, [])
    orderMap.get(orderNumber)!.push({ id: d.id, createdAt: data.createdAt })
  }
  let deleted = 0
  for (const [, docs] of orderMap) {
    if (docs.length <= 1) continue
    docs.sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0))
    for (let i = 1; i < docs.length; i++) {
      await adminDb.collection("orders").doc(docs[i].id).delete()
      deleted++
    }
  }
  return deleted
}

export type BackfillCoordsResult = {
  updated: number
  /** Orders that still have no coordinates because neither provider placed them. */
  failed: number
  /** Set when Google geocoding is misconfigured — `updated` will be near zero. */
  geocoderError: string | null
}

export async function adminBackfillOrderCoords(): Promise<BackfillCoordsResult> {
  const snap = await adminDb.collection("orders").get()
  const hub = getHubCoordinates()
  const apiKey = await getServerMapsKey()
  let updated = 0
  let failed = 0

  for (const d of snap.docs) {
    const data = d.data()
    const hasCoords = typeof data.lat === "number" && typeof data.lng === "number"
    const hasDistance = typeof data.distanceKm === "number" && !Number.isNaN(data.distanceKm)
    if (hasCoords && hasDistance) continue

    const address = data.address as string
    if (!address?.trim()) continue

    // Reuse stored coords when only distanceKm is missing — no API call needed.
    const coords = hasCoords
      ? { lat: data.lat as number, lng: data.lng as number }
      : await geocodeAddress(address.trim(), { apiKey })

    if (!coords) {
      failed++
      continue
    }

    // Write lat/lng *and* distanceKm together so the map and the distance
    // column can never drift apart again.
    await d.ref.update({
      lat: coords.lat,
      lng: coords.lng,
      distanceKm: haversineDistanceKm(hub, coords),
    })
    updated++
  }

  const health = getGeocodeHealth()
  return {
    updated,
    failed,
    geocoderError: health.lastError
      ? `${health.lastError.status}: ${health.lastError.message}`
      : null,
  }
}
