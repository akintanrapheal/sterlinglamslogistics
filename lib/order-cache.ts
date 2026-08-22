"use client"

import type { Order } from "@/lib/data"

/**
 * Last-known order list, persisted so the driver app is usable without signal.
 *
 * Only the session was ever persisted. The order list lived in memory and was
 * rebuilt by fetching /api/driver/orders on startup, so launching the app in a
 * dead zone — or after Android killed it in the background mid-round — left
 * `orders` empty and the dashboard showing "No active orders". The driver
 * could not see their own deliveries, addresses or phone numbers until signal
 * came back, which is exactly when they needed them.
 *
 * The write queues (delivery-queue, status-queue) already survive a restart,
 * so this closes the remaining gap: what the driver still has to deliver.
 *
 * Scoped per driver id so a shared handset never shows one driver another's
 * round, and stamped so genuinely stale data can be recognised.
 */

const KEY_PREFIX = "driverOrdersCache:"

/** Orders older than this are ignored — a round from last week is noise. */
const MAX_AGE_MS = 48 * 60 * 60 * 1000

interface CachedOrders {
  savedAt: number
  orders: Order[]
}

function keyFor(driverId: string): string {
  return `${KEY_PREFIX}${driverId}`
}

export function saveCachedOrders(driverId: string, orders: Order[]): void {
  if (!driverId) return
  try {
    const payload: CachedOrders = { savedAt: Date.now(), orders }
    localStorage.setItem(keyFor(driverId), JSON.stringify(payload))
  } catch {
    // Quota exceeded or storage disabled. Proof-of-delivery photos in the
    // write queue matter far more than this cache, so drop it rather than
    // letting a failure here surface — the app simply refetches when online.
  }
}

export function loadCachedOrders(driverId: string): Order[] {
  if (!driverId) return []
  try {
    const raw = localStorage.getItem(keyFor(driverId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as CachedOrders
    if (!parsed || !Array.isArray(parsed.orders)) return []
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(driverId))
      return []
    }
    return parsed.orders
  } catch {
    return []
  }
}

export function clearCachedOrders(driverId: string): void {
  try {
    localStorage.removeItem(keyFor(driverId))
  } catch {
    // ignore
  }
}
