// Utility: Remove 'WC-' prefix from all orderNumbers in Firestore
export async function cleanOrderNumbersWC() {
  const q = query(ordersCollection, where("orderNumber", ">=", "WC-"), where("orderNumber", "<", "WC.`"))
  const snapshot = await getDocs(q)
  let updated = 0
  for (const docSnap of snapshot.docs) {
    const orderNumber = docSnap.data().orderNumber
    if (typeof orderNumber === "string" && orderNumber.startsWith("WC-")) {
      const newOrderNumber = orderNumber.replace(/^WC-/, "")
      await updateDoc(docSnap.ref, { orderNumber: newOrderNumber })
      updated++
    }
  }
  return updated
}

// Utility: Remove duplicate orders that share the same orderNumber (keeps the oldest)
export async function removeDuplicateOrders() {
  const snapshot = await getDocs(ordersCollection)
  const orderMap = new Map<string, { id: string; createdAt: unknown }[]>()

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    const orderNumber = data.orderNumber as string
    if (!orderNumber) continue
    if (!orderMap.has(orderNumber)) orderMap.set(orderNumber, [])
    orderMap.get(orderNumber)!.push({ id: docSnap.id, createdAt: data.createdAt })
  }

  let deleted = 0
  for (const [, docs] of orderMap) {
    if (docs.length <= 1) continue
    // Sort by createdAt ascending – keep the first (oldest), delete the rest
    docs.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt as string).getTime() : 0
      const db2 = b.createdAt ? new Date(b.createdAt as string).getTime() : 0
      return da - db2
    })
    for (let i = 1; i < docs.length; i++) {
      await deleteDoc(doc(db, "orders", docs[i].id))
      deleted++
    }
  }
  return deleted
}

// Utility: Backfill lat/lng (and distanceKm) for orders missing coordinates
export async function backfillOrderCoords() {
  const snapshot = await getDocs(ordersCollection)
  const hub = getHubCoordinates()
  let updated = 0
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    if (typeof data.lat === "number" && typeof data.lng === "number") continue
    const address = data.address as string
    if (!address?.trim()) continue
    const coords = await geocodeAddress(address.trim())
    if (coords) {
      // Write distanceKm alongside so the two can never drift apart.
      await updateDoc(docSnap.ref, {
        lat: coords.lat,
        lng: coords.lng,
        distanceKm: haversineDistanceKm(hub, coords),
      })
      updated++
    }
  }
  return updated
}

import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  limit as firestoreLimit,
  startAfter,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { db } from "./firebase"
import { geocodeAddress, haversineDistanceKm, getHubCoordinates } from "./geocode"
import type { Order, Driver, NotificationLog } from "./data"
import { hashPassword, verifyPassword, isHashed } from "./password"
import { ORDER_STATUS, DRIVER_STATUS } from "./constants"

async function calculateDistanceKm(address: string): Promise<{ distanceKm?: number; lat?: number; lng?: number }> {
  const destination = await geocodeAddress(address)
  if (!destination) return {}
  const distanceKm = haversineDistanceKm(getHubCoordinates(), destination)
  return { distanceKm, lat: destination.lat, lng: destination.lng }
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

function toDate(val: unknown): Date | undefined {
  if (!val) return undefined
  if (val instanceof Date) return val
  if (typeof (val as { toDate?: unknown }).toDate === "function") return (val as { toDate: () => Date }).toDate()
  if (typeof val === "string" || typeof val === "number") { const d = new Date(val); if (!Number.isNaN(d.getTime())) return d }
  return undefined
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

// Orders Collection
export const ordersCollection = collection(db, "orders")
export const driversCollection = collection(db, "drivers")
export const notificationLogsCollection = collection(db, "notificationLogs")

// Fetch all orders
export async function fetchOrders(): Promise<Order[]> {
  try {
    const q = query(ordersCollection, orderBy("createdAt", "desc"))
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => normalizeOrderDoc(doc.id, doc.data() as Record<string, unknown>))
  } catch (error) {
    console.error("Error fetching orders:", error)
    return []
  }
}

// Fetch all drivers
export async function fetchDrivers(): Promise<Driver[]> {
  try {
    const snapshot = await getDocs(driversCollection)
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Driver))
  } catch (error) {
    console.error("Error fetching drivers:", error)
    return []
  }
}

// Fetch single order
export async function fetchOrder(orderId: string): Promise<Order | null> {
  try {
    const docRef = doc(db, "orders", orderId)
    const snapshot = await getDoc(docRef)
    if (!snapshot.exists()) return null
    return normalizeOrderDoc(snapshot.id, snapshot.data() as Record<string, unknown>)
  } catch (error) {
    console.error("Error fetching order:", error)
    return null
  }
}

// Fetch order by tracking token (order number first, then doc id fallback)
export async function fetchOrderByTracking(tracking: string): Promise<Order | null> {
  const token = tracking.trim()
  if (!token) return null

  try {
    const byOrderNumber = query(ordersCollection, where("orderNumber", "==", token))
    const snapshot = await getDocs(byOrderNumber)
    if (!snapshot.empty) {
      const docRef = snapshot.docs[0]
      return normalizeOrderDoc(docRef.id, docRef.data() as Record<string, unknown>)
    }
  } catch (error) {
    console.error("Error fetching order by order number:", error)
  }

  // fallback to document id
  return fetchOrder(token)
}

// Fetch single driver
export async function fetchDriverById(driverId: string): Promise<Driver | null> {
  try {
    const docRef = doc(db, "drivers", driverId)
    const snapshot = await getDoc(docRef)
    if (!snapshot.exists()) return null
    return {
      id: snapshot.id,
      ...snapshot.data(),
    } as Driver
  } catch (error) {
    console.error("Error fetching driver:", error)
    return null
  }
}

// Create new order
export async function createOrder(order: Omit<Order, "id">) {
  try {
    const geo = await calculateDistanceKm(order.address)
    const docRef = await addDoc(ordersCollection, {
      ...order,
      ...geo,
      createdAt: new Date(),
    })
    return docRef.id
  } catch (error) {
    console.error("Error creating order:", error)
    throw error
  }
}

// Create new order with deterministic document ID (for idempotent imports)
export async function createOrderWithId(orderId: string, order: Omit<Order, "id">) {
  try {
    const geo = await calculateDistanceKm(order.address)
    const docRef = doc(db, "orders", orderId)
    await setDoc(docRef, {
      ...order,
      ...geo,
      createdAt: new Date(),
    })
    return docRef.id
  } catch (error) {
    console.error("Error creating order with id:", error)
    throw error
  }
}

// Update order
export async function updateOrder(orderId: string, updates: Partial<Order>) {
  try {
    const docRef = doc(db, "orders", orderId)
    let geoUpdate: { distanceKm?: number; lat?: number; lng?: number } = {}
    if (typeof updates.address === "string" && updates.address.trim()) {
      geoUpdate = await calculateDistanceKm(updates.address)
    }
    await updateDoc(docRef, {
      ...updates,
      ...geoUpdate,
      updatedAt: new Date(),
    })
  } catch (error) {
    console.error("Error updating order:", error)
    throw error
  }
}

// Delete order
export async function deleteOrder(orderId: string) {
  try {
    await deleteDoc(doc(db, "orders", orderId))
  } catch (error) {
    console.error("Error deleting order:", error)
    throw error
  }
}

// Fetch orders by status
export async function fetchOrdersByStatus(status: string): Promise<Order[]> {
  try {
    const q = query(
      ordersCollection,
      where("status", "==", status),
      orderBy("createdAt", "desc")
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => normalizeOrderDoc(doc.id, doc.data() as Record<string, unknown>))
  } catch (error) {
    console.error("Error fetching orders by status:", error)
    return []
  }
}

// Fetch drivers by status
export async function fetchDriversByStatus(status: string): Promise<Driver[]> {
  try {
    const q = query(driversCollection, where("status", "==", status))
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Driver))
  } catch (error) {
    console.error("Error fetching drivers by status:", error)
    return []
  }
}

// Create new driver
export async function createDriver(driver: Omit<Driver, "id">) {
  try {
    const driverData = { ...driver }
    // Hash password before storing
    if (driverData.password) {
      driverData.password = await hashPassword(driverData.password)
    }
    const docRef = await addDoc(driversCollection, {
      ...driverData,
      createdAt: new Date(),
    })
    return docRef.id
  } catch (error) {
    console.error("Error creating driver:", error)
    throw error
  }
}

// Update driver
export async function updateDriver(driverId: string, updates: Partial<Driver>) {
  try {
    const docRef = doc(db, "drivers", driverId)
    const updatesData = { ...updates }
    // Hash password if being updated and not already hashed
    if (updatesData.password && !isHashed(updatesData.password)) {
      updatesData.password = await hashPassword(updatesData.password)
    }
    await updateDoc(docRef, {
      ...updatesData,
      updatedAt: new Date(),
    })
  } catch (error) {
    console.error("Error updating driver:", error)
    throw error
  }
}

// Delete driver
export async function deleteDriver(driverId: string) {
  try {
    await deleteDoc(doc(db, "drivers", driverId))
  } catch (error) {
    console.error("Error deleting driver:", error)
    throw error
  }
}

// Fetch orders assigned to a specific driver
export async function fetchOrdersByDriver(driverId: string): Promise<Order[]> {
  try {
    const q = query(
      ordersCollection,
      where("assignedDriver", "==", driverId)
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((d) => normalizeOrderDoc(d.id, d.data() as Record<string, unknown>))
  } catch (error) {
    console.error("Error fetching driver orders:", error)
    return []
  }
}

// Save optimized route order index for each order
export async function saveOptimizedRouteOrder(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    try {
      await updateDoc(doc(db, "orders", orderedIds[i]), { routeOrder: i })
    } catch {
      // non-critical: best effort
    }
  }
}

// Recalculate a driver's average rating using a targeted query instead of fetching all orders
export async function recalculateDriverRating(driverId: string): Promise<number> {
  try {
    // Only fetch orders that have a driverRating > 0, avoiding N+1
    const q = query(
      ordersCollection,
      where("assignedDriver", "==", driverId),
      where("driverRating", ">", 0)
    )
    const snapshot = await getDocs(q)
    if (snapshot.empty) return 0
    let sum = 0
    for (const d of snapshot.docs) {
      sum += (d.data().driverRating as number) ?? 0
    }
    const avg = sum / snapshot.size
    const rounded = Math.round(avg * 10) / 10
    await updateDriver(driverId, { rating: rounded })
    return rounded
  } catch (error) {
    console.error("Error recalculating driver rating:", error)
    return 0
  }
}

function normalizeDriverPhoneForMatch(value: string): string | null {
  const digits = value.replace(/\D/g, "")
  if (!digits) return null

  // Accept common Nigerian formats:
  // +2348045678901, 2348045678901, 08045678901, 8045678901
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1)
  if (digits.length >= 13 && digits.startsWith("234")) return digits.slice(-10)
  if (digits.length > 10) return digits.slice(-10)

  return null
}

// Authenticate driver by phone + password (supports bcrypt and legacy plaintext)
export async function authenticateDriver(phone: string, password: string): Promise<Driver | null> {
  try {
    const normalizedInput = normalizeDriverPhoneForMatch(phone)
    if (!normalizedInput) return null

    const snapshot = await getDocs(driversCollection)
    for (const driverDoc of snapshot.docs) {
      const data = driverDoc.data() as Driver
      const normalizedStored = normalizeDriverPhoneForMatch(String(data.phone ?? ""))
      if (normalizedStored !== normalizedInput) continue

      const storedPassword = data.password ?? ""
      const matches = await verifyPassword(password, storedPassword)
      if (!matches) continue

      // Auto-migrate: if the password was stored in plaintext, re-hash it
      if (!isHashed(storedPassword)) {
        try {
          const hashed = await hashPassword(password)
          await updateDoc(doc(db, "drivers", driverDoc.id), { password: hashed })
        } catch {
          // Non-critical — migration will retry next login
        }
      }

      return { ...data, id: driverDoc.id } as Driver
    }

    return null
  } catch (error) {
    console.error("Error authenticating driver:", error)
    return null
  }
}

// Update driver GPS location
export async function updateDriverLocation(driverId: string, lat: number, lng: number) {
  try {
    const docRef = doc(db, "drivers", driverId)
    await updateDoc(docRef, {
      lastLocation: { lat, lng },
      locationUpdatedAt: new Date(),
    })
  } catch (error) {
    console.error("Error updating driver location:", error)
    throw error
  }
}

// Fetch notification logs with proper Firestore limit
export async function fetchNotificationLogs(count = 20): Promise<NotificationLog[]> {
  try {
    const q = query(notificationLogsCollection, orderBy("createdAt", "desc"), firestoreLimit(count))
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as NotificationLog))
  } catch (error) {
    console.error("Error fetching notification logs:", error)
    return []
  }
}

// Paginated fetch orders
export async function fetchOrdersPaginated(
  pageSize = 50,
  lastDoc?: QueryDocumentSnapshot
): Promise<{ orders: Order[]; lastDoc: QueryDocumentSnapshot | null }> {
  try {
    let q = lastDoc
      ? query(ordersCollection, orderBy("createdAt", "desc"), startAfter(lastDoc), firestoreLimit(pageSize))
      : query(ordersCollection, orderBy("createdAt", "desc"), firestoreLimit(pageSize))
    const snapshot = await getDocs(q)
    const orders = snapshot.docs.map((doc) => normalizeOrderDoc(doc.id, doc.data() as Record<string, unknown>))
    const last = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null
    return { orders, lastDoc: last }
  } catch (error) {
    console.error("Error fetching paginated orders:", error)
    return { orders: [], lastDoc: null }
  }
}

export function subscribeOrdersRealtime(onData: (orders: Order[]) => void) {
  const q = query(ordersCollection, orderBy("createdAt", "desc"))
  return onSnapshot(
    q,
    (snapshot) => {
      const orders = snapshot.docs.map((doc) =>
        normalizeOrderDoc(doc.id, doc.data() as Record<string, unknown>)
      )
      onData(orders)
    },
    (error) => {
      console.error("Error subscribing to orders:", error)
      onData([])
    }
  )
}

export function subscribeDriversRealtime(onData: (drivers: Driver[]) => void) {
  return onSnapshot(
    driversCollection,
    (snapshot) => {
      const drivers = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as Driver))
      onData(drivers)
    },
    (error) => {
      console.error("Error subscribing to drivers:", error)
      onData([])
    }
  )
}

export function subscribeOrderByTrackingRealtime(
  tracking: string,
  onData: (order: Order | null) => void
) {
  const token = tracking.trim()
  if (!token) {
    onData(null)
    return () => undefined
  }

  let fallbackUnsubscribe: (() => void) | null = null
  let fallbackActive = false
  const byOrderNumber = query(
    ordersCollection,
    where("orderNumber", "==", token)
  )

  const orderNumberUnsubscribe = onSnapshot(
    byOrderNumber,
    (snapshot) => {
      if (!snapshot.empty) {
        if (fallbackUnsubscribe) {
          fallbackUnsubscribe()
          fallbackUnsubscribe = null
          fallbackActive = false
        }
        // Sort in memory — most recently created order wins (no composite index needed)
        const sorted = snapshot.docs.slice().sort((a, b) => {
          const toMs = (v: unknown): number => {
            if (!v) return 0
            if (typeof v === "object" && "seconds" in (v as object)) return (v as { seconds: number }).seconds * 1000
            return new Date(v as string | number).getTime()
          }
          return toMs(b.data().createdAt) - toMs(a.data().createdAt)
        })
        const docRef = sorted[0]
        onData(normalizeOrderDoc(docRef.id, docRef.data() as Record<string, unknown>))
        return
      }

      if (!fallbackActive) {
        fallbackActive = true
        fallbackUnsubscribe = onSnapshot(
          doc(db, "orders", token),
          (docSnapshot) => {
            if (!docSnapshot.exists()) {
              onData(null)
              return
            }
            onData(normalizeOrderDoc(docSnapshot.id, docSnapshot.data() as Record<string, unknown>))
          },
          (error) => {
            console.error("Error subscribing to fallback tracking doc:", error)
            onData(null)
          }
        )
      }
    },
    (error) => {
      console.error("Error subscribing to order by tracking:", error)
      onData(null)
    }
  )

  return () => {
    orderNumberUnsubscribe()
    if (fallbackUnsubscribe) fallbackUnsubscribe()
  }
}

export function subscribeDriverRealtime(
  driverId: string,
  onData: (driver: Driver | null) => void
) {
  const id = driverId.trim()
  if (!id) {
    onData(null)
    return () => undefined
  }

  return onSnapshot(
    doc(db, "drivers", id),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null)
        return
      }
      onData({
        id: snapshot.id,
        ...snapshot.data(),
      } as Driver)
    },
    (error) => {
      console.error("Error subscribing to driver:", error)
      onData(null)
    }
  )
}