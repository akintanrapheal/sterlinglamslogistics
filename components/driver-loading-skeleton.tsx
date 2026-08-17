/**
 * Reusable skeleton placeholder for /driver/* routes. Next.js shows the
 * matching loading.tsx instantly when a route transition starts, so the
 * driver sees this shimmer instead of a blank screen while the actual
 * page chunk loads. All skeletons are pure CSS — no JS work involved.
 */
export function DriverListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      <div className="sticky top-0 z-40 flex items-center justify-between bg-background py-3">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-8" />
      </div>
      <div className="space-y-3 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="mb-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="mb-4 h-3 w-3/4 animate-pulse rounded bg-muted/70" />
            <div className="h-11 w-full animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DriverDetailSkeleton() {
  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      <div className="flex items-center gap-2 py-3">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3 pt-2">
        <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted/70" />
        <div className="my-4 h-px bg-border" />
        <div className="h-24 w-full animate-pulse rounded-xl bg-muted/60" />
        <div className="my-4 h-px bg-border" />
        <div className="h-32 w-full animate-pulse rounded-xl bg-muted/60" />
      </div>
    </div>
  )
}

export function DriverMapSkeleton() {
  return (
    <div className="relative h-screen w-full bg-muted">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-muted to-muted/80" />
      <div className="absolute left-4 top-4 flex h-10 w-10 animate-pulse items-center justify-center rounded-lg bg-background/80 shadow" />
    </div>
  )
}
