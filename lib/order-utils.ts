import { formatCurrency } from "@/lib/data"

function esc(text: string): string {
  const el = document.createElement("span")
  el.textContent = text
  return el.innerHTML
}

/**
 * Coerce the several shapes a Firestore date arrives in into a Date.
 *
 * The shapes matter because they come from different paths:
 *
 *   { seconds }            client SDK Timestamp, JSON-serialised
 *   { _seconds }           ADMIN SDK Timestamp, JSON-serialised — the admin
 *                          Timestamp keeps its fields private, so JSON.stringify
 *                          emits _seconds/_nanoseconds with underscores. Every
 *                          /api/driver/* route uses adminDb, so this is the
 *                          shape the driver app actually receives, and missing
 *                          it made deliveredAt parse as null: the Today and
 *                          Yesterday tabs were always empty and "All" sorted
 *                          arbitrarily because every key fell back to 0.
 *   "2026-08-22T…"         ISO string — what any Date becomes once it has been
 *                          through JSON, including via the offline order cache.
 *   1755848820000          epoch milliseconds (or seconds, disambiguated below)
 *   { toDate() }           a live Timestamp instance
 */
export function parseFirestoreDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === "number") {
    // Anything below this is implausible as milliseconds (it would be 1970),
    // so treat it as seconds instead.
    const ms = value < 1e11 ? value * 1000 : value
    const parsed = new Date(ms)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === "object") {
    const obj = value as {
      toDate?: () => Date
      seconds?: number
      _seconds?: number
    }
    if (typeof obj.toDate === "function") {
      try {
        const d = obj.toDate()
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
      } catch {
        return null
      }
    }
    const seconds = typeof obj.seconds === "number" ? obj.seconds : obj._seconds
    if (typeof seconds === "number") return new Date(seconds * 1000)
  }

  return null
}

export function formatOrderTime(value: unknown) {
  const date = parseFirestoreDate(value)
  if (!date) return "--"
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function formatDistance(distanceKm: unknown) {
  if (typeof distanceKm !== "number" || Number.isNaN(distanceKm)) return "--"
  return `${distanceKm.toFixed(2)} km`
}

export function formatTimeAmPm(time: string | undefined | null): string {
  if (!time) return "N/A"
  const parts = time.split(":")
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return time
  const period = h >= 12 ? "p.m." : "a.m."
  const hour12 = h % 12 || 12
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`
}

export function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

export function handlePrintOrder(order: { orderNumber: string; customerName: string; phone: string; address: string; amount: number; status: string; assignedDriver: string | null; deliveryInstruction?: string; items?: Array<{ name: string; price?: number; qty?: number }> }, getDriverDisplayName: (id: string | null) => string) {
  const w = window.open("", "_blank")
  if (!w) return
  const items = (order.items ?? []).map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty ?? 1}</td><td>${formatCurrency(i.price ?? 0)}</td></tr>`).join("")
  w.document.write(`<html><head><title>Order ${esc(order.orderNumber)}</title><style>body{font-family:system-ui,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}</style></head><body>
    <h1>Order #${esc(order.orderNumber)}</h1>
    <p><b>Customer:</b> ${esc(order.customerName)}</p>
    <p><b>Phone:</b> ${esc(order.phone)}</p>
    <p><b>Address:</b> ${esc(order.address)}</p>
    <p><b>Amount:</b> ${formatCurrency(order.amount)}</p>
    <p><b>Status:</b> ${esc(order.status)}</p>
    <p><b>Driver:</b> ${order.assignedDriver ? esc(getDriverDisplayName(order.assignedDriver)) : "Unassigned"}</p>
    ${order.deliveryInstruction ? `<p><b>Instructions:</b> ${esc(order.deliveryInstruction)}</p>` : ""}
    <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>${items}</tbody></table>
  </body></html>`)
  w.document.close()
  w.print()
}

export function handlePrintLabel(order: { orderNumber: string; customerName: string; phone: string; address: string }) {
  const w = window.open("", "_blank")
  if (!w) return
  w.document.write(`<html><head><title>Label ${esc(order.orderNumber)}</title><style>body{font-family:monospace;padding:16px;font-size:14px}h2{margin:0 0 8px}p{margin:4px 0}.barcode{font-family:'Libre Barcode 128',monospace;font-size:48px;margin-top:12px}</style><link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet"></head><body>
    <h2>#${esc(order.orderNumber)}</h2>
    <p><b>${esc(order.customerName)}</b></p>
    <p>${esc(order.phone)}</p>
    <p>${esc(order.address)}</p>
    <div class="barcode">${esc(order.orderNumber)}</div>
  </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 500)
}
