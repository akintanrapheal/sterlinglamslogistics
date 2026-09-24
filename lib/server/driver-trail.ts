import { adminDb } from "./firebase-admin"
import { createLogger } from "@/lib/logger"

const log = createLogger("driver-trail")

/**
 * Stored location history for a driver, so dispatch can review where a driver
 * went rather than only where they are now.
 *
 * Nothing recorded history before this: adminUpdateDriverLocation overwrites a
 * single lastLocation on the driver doc and a single mirror in
 * driverLocations, so every ping replaced the previous one. History therefore
 * begins when this ships — earlier days cannot be reconstructed.
 *
 * Points live in a per-driver, per-day document rather than one document per
 * point. A driver pinging through an eight-hour shift would otherwise create
 * thousands of documents a day, and reading a day back would cost a read per
 * point. One document per driver-day means a day's trail is a single read and
 * a bounded number of writes, which matters here: this project has already
 * had an outage caused by Firestore read volume.
 */

/** Points are appended to `driverTrails/{driverId}_{YYYY-MM-DD}`. */
const COLLECTION = "driverTrails"

/**
 * Hard cap on points per day.
 *
 * Firestore documents are limited to 1 MiB. At roughly 40 bytes per point
 * that is tens of thousands, so 5,000 is far below the structural limit — it
 * exists to bound cost and render time, not to avoid overflow. At the client's
 * trail cadence this is several days of continuous driving.
 */
const MAX_POINTS_PER_DAY = 5000

export interface TrailPoint {
  /** Latitude. */
  lat: number
  /** Longitude. */
  lng: number
  /** Epoch milliseconds. Stored as a number so the whole day is one JSON blob. */
  t: number
  /** Metres per second, when the device reported it. */
  s?: number
}

export interface DriverTrailDay {
  driverId: string
  /** Local date key, YYYY-MM-DD. */
  date: string
  points: TrailPoint[]
  updatedAt: Date
}

/** Document id for a driver's trail on a given day. */
export function trailDocId(driverId: string, date: string): string {
  return `${driverId}_${date}`
}

/**
 * Date key in Lagos time.
 *
 * Deliberately not UTC: a shift ending at 00:30 local would otherwise be split
 * across two documents and appear on the wrong day in the UI. Nigeria observes
 * no daylight saving, so a fixed +1 offset is correct year-round.
 */
export function lagosDateKey(d: Date = new Date()): string {
  const lagos = new Date(d.getTime() + 60 * 60 * 1000)
  return lagos.toISOString().slice(0, 10)
}

/**
 * Append one point to today's trail for a driver.
 *
 * Best-effort: a failure here must never fail the location update itself,
 * since the live position matters more to dispatch than the history does.
 */
export async function appendTrailPoint(
  driverId: string,
  point: TrailPoint,
): Promise<void> {
  const date = lagosDateKey(new Date(point.t))
  const ref = adminDb.collection(COLLECTION).doc(trailDocId(driverId, date))

  try {
    await adminDb.runTransaction(async (txn) => {
      const snap = await txn.get(ref)
      const existing = (snap.exists ? (snap.data()?.points as TrailPoint[]) : null) ?? []

      if (existing.length >= MAX_POINTS_PER_DAY) return

      txn.set(
        ref,
        {
          driverId,
          date,
          points: [...existing, point],
          updatedAt: new Date(),
        },
        { merge: true },
      )
    })
  } catch (err) {
    log.warn({ err, driverId, date }, "Failed to append trail point")
  }
}

/**
 * Append many points at once, grouped into the days they belong to.
 *
 * A backlog uploaded after a device was offline can span midnight, so points
 * are bucketed by their own timestamp rather than all filed under today —
 * otherwise a night drive home would appear on the following morning.
 *
 * One transaction per day touched, rather than per point: a few hundred
 * points would otherwise be a few hundred read-modify-write cycles on the
 * same document, which is both slow and needlessly expensive.
 */
export async function appendTrailPoints(driverId: string, points: TrailPoint[]): Promise<void> {
  if (points.length === 0) return

  const byDay = new Map<string, TrailPoint[]>()
  for (const p of points) {
    const key = lagosDateKey(new Date(p.t))
    const bucket = byDay.get(key)
    if (bucket) bucket.push(p)
    else byDay.set(key, [p])
  }

  for (const [date, dayPoints] of byDay) {
    const ref = adminDb.collection(COLLECTION).doc(trailDocId(driverId, date))
    try {
      await adminDb.runTransaction(async (txn) => {
        const snap = await txn.get(ref)
        const existing = (snap.exists ? (snap.data()?.points as TrailPoint[]) : null) ?? []

        // Drop points already stored. A client that uploads a batch, loses
        // the connection before recording success, then retries would
        // otherwise duplicate them and double the day's distance.
        const seen = new Set(existing.map((e) => `${e.t}`))
        const fresh = dayPoints.filter((p) => !seen.has(`${p.t}`))
        if (fresh.length === 0) return

        const merged = [...existing, ...fresh]
          .sort((a, b) => a.t - b.t)
          .slice(-MAX_POINTS_PER_DAY)

        txn.set(ref, { driverId, date, points: merged, updatedAt: new Date() }, { merge: true })
      })
    } catch (err) {
      log.warn({ err, driverId, date, count: dayPoints.length }, "Failed to append trail batch")
    }
  }
}

/** Read one driver's trail for one day. Returns [] when nothing was recorded. */
export async function readTrail(driverId: string, date: string): Promise<TrailPoint[]> {
  try {
    const snap = await adminDb.collection(COLLECTION).doc(trailDocId(driverId, date)).get()
    if (!snap.exists) return []
    const points = (snap.data()?.points as TrailPoint[]) ?? []
    // Defensive: the UI assumes chronological order for distance and stop
    // detection, and out-of-order points would produce nonsense distances.
    return [...points].sort((a, b) => a.t - b.t)
  } catch (err) {
    log.error({ err, driverId, date }, "Failed to read trail")
    return []
  }
}
