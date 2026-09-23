"use client"

/**
 * Local buffer for location history points.
 *
 * Trail points used to be POSTed the moment they were recorded, so anything
 * captured without a network connection was simply lost. That is the case
 * that matters most: drivers take company vehicles home through areas with
 * patchy coverage, and a trail with the journey home missing is exactly the
 * part nobody can reconstruct afterwards.
 *
 * Points are buffered on the device and uploaded in batches whenever a
 * connection is available. Unlike the delivery queue, an individual point is
 * not worth much on its own — so this is allowed to drop the oldest entries
 * under pressure rather than grow without bound.
 */

const KEY = "driverTrailQueue"

/**
 * Maximum buffered points.
 *
 * At the recording thresholds this is roughly a day and a half of continuous
 * driving. Beyond that the oldest are dropped: a device that has been offline
 * for days has already lost the detail, and filling localStorage would risk
 * the delivery queue, which holds proof of delivery and is irreplaceable.
 */
const MAX_QUEUED = 3000

export interface QueuedTrailPoint {
  lat: number
  lng: number
  t: number
  s?: number
}

function read(): QueuedTrailPoint[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedTrailPoint[]) : []
  } catch {
    return []
  }
}

function write(points: QueuedTrailPoint[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(points))
  } catch {
    // Storage full or disabled. Losing history is acceptable; failing the
    // caller is not, since this runs inside the live location path.
  }
}

export function enqueueTrailPoint(point: QueuedTrailPoint): void {
  const points = read()
  points.push(point)
  // Drop from the front so the most recent movement always survives.
  write(points.length > MAX_QUEUED ? points.slice(points.length - MAX_QUEUED) : points)
}

export function queuedTrailCount(): number {
  return read().length
}

/**
 * Hand the buffered points to `upload`, clearing only those it accepted.
 *
 * Points recorded while the upload was in flight are preserved: the queue is
 * re-read afterwards and only the uploaded prefix is removed, rather than the
 * whole key being cleared.
 */
export async function flushTrailQueue(
  upload: (points: QueuedTrailPoint[]) => Promise<boolean>,
  batchSize = 200,
): Promise<number> {
  let uploaded = 0

  for (;;) {
    const points = read()
    if (points.length === 0) break

    const batch = points.slice(0, batchSize)
    const ok = await upload(batch)
    if (!ok) break

    // Re-read rather than reusing `points`: the live location path may have
    // appended while this batch was uploading.
    const current = read()
    write(current.slice(batch.length))
    uploaded += batch.length

    if (batch.length < batchSize) break
  }

  return uploaded
}
