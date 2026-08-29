"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Mail,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth-provider"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { parseFirestoreDate } from "@/lib/order-utils"
import type { NotificationLog, NotificationChannelResult } from "@/lib/data"
import { cn } from "@/lib/utils"

type ChannelKey = "sms" | "whatsapp" | "email"
type StatusFilter = "all" | "sent" | "failed"

/** Rows per page. Small enough that a failure is visible without scrolling. */
const PAGE_SIZE = 25

const CHANNELS: { key: ChannelKey; label: string; icon: typeof Mail }[] = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
]

const EVENTS = [
  { value: "all", label: "All events" },
  { value: "order_accepted", label: "Order accepted" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
]

const eventLabel: Record<string, string> = {
  order_accepted: "Order accepted",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
}

/**
 * Plain-language reading of the reason codes the senders emit, so a failed
 * notification names the thing to change rather than only that it failed.
 */
function explainFailure(reason?: string): string {
  switch (reason) {
    case "missing_twilio_credentials":
      return "Twilio account SID or auth token is not configured — WhatsApp and SMS are abandoned before Twilio is contacted."
    case "missing_twilio_sms_from":
      return "No SMS sender number configured (TWILIO_SMS_FROM)."
    case "missing_twilio_whatsapp_from":
      return "No WhatsApp sender configured (TWILIO_WHATSAPP_FROM or a messaging service SID)."
    case "invalid_sms_to_number":
    case "invalid_whatsapp_to_number":
      return "The customer phone number could not be read as a valid international number."
    case "twilio_whatsapp_error":
      return "Twilio rejected the WhatsApp message. Error 63016 means an approved template is required for this event."
    case "twilio_sms_error":
      return "Twilio rejected the SMS."
    case "missing_resend_api_key":
      return "No email API key configured (RESEND_API_KEY)."
    case "disabled":
      return "This channel is switched off in notification settings."
    default:
      return reason ? `Reported reason: ${reason}` : "No reason was recorded."
  }
}

interface HealthCheck {
  id: string
  label: string
  ok: boolean
  fix?: string
  advisory?: boolean
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const [logs, setLogs] = useState<NotificationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [health, setHealth] = useState<{
    healthy: boolean
    canSendWhatsapp: boolean
    checks: HealthCheck[]
  } | null>(null)

  const [channel, setChannel] = useState<ChannelKey | "all">("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [event, setEvent] = useState("all")
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const authedFetch = useCallback(async (url: string) => {
    const token = await auth.currentUser?.getIdToken()
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  }, [])

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [logsRes, healthRes] = await Promise.all([
        authedFetch("/api/admin/notification-logs?limit=200"),
        authedFetch("/api/admin/notification-health"),
      ])
      const logsJson = await logsRes.json()
      if (!logsRes.ok || !logsJson.ok) throw new Error(logsJson.error ?? "Failed to load logs")
      setLogs(logsJson.logs as NotificationLog[])

      if (healthRes.ok) {
        const h = await healthRes.json()
        if (h.ok) setHealth({ healthy: h.healthy, canSendWhatsapp: h.canSendWhatsapp, checks: h.checks })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notification logs")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [authedFetch])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((l) => {
      if (event !== "all" && l.event !== event) return false

      const channels: ChannelKey[] = channel === "all" ? ["sms", "whatsapp", "email"] : [channel]
      if (status !== "all") {
        // Status is evaluated against the channels currently in view, so
        // "WhatsApp + failed" answers "which WhatsApp messages did not go
        // out" rather than "which rows contain any failure at all".
        const match = channels.some((c) => (status === "sent" ? l[c]?.sent : l[c] && !l[c].sent))
        if (!match) return false
      }

      if (q) {
        const hay = `${l.orderNumber ?? ""} ${l.customerName ?? ""} ${l.customerPhone ?? ""} ${l.customerEmail ?? ""}`
        if (!hay.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [logs, channel, status, event, search])

  // Any filter change re-slices the list, so a page number carried over from
  // the previous filter would land on nothing.
  useEffect(() => {
    setPage(1)
  }, [channel, status, event, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  )

  const stats = useMemo(() => {
    const out: Record<ChannelKey, { sent: number; failed: number }> = {
      whatsapp: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
      email: { sent: 0, failed: 0 },
    }
    for (const l of logs) {
      for (const c of ["whatsapp", "sms", "email"] as ChannelKey[]) {
        const r = l[c]
        if (!r) continue
        if (r.sent) out[c].sent++
        else out[c].failed++
      }
    }
    return out
  }, [logs])

  /** The most frequent failure across the loaded window, to lead with. */
  const topFailure = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of logs) {
      for (const c of ["whatsapp", "sms", "email"] as ChannelKey[]) {
        const r = l[c]
        if (r && !r.sent && r.reason) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1)
      }
    }
    let best: { reason: string; count: number } | null = null
    for (const [reason, count] of counts) {
      if (!best || count > best.count) best = { reason, count }
    }
    return best
  }, [logs])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Notification Logs</h1>
          <p className="text-sm text-muted-foreground">
            Every customer message the system attempted, and why any of them failed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      {/* Configuration health. When a channel stops working entirely the cause
          is almost always here rather than in any individual row, so it leads. */}
      {health && (
        <div
          className={cn(
            "rounded-xl border p-4",
            health.healthy ? "border-border" : "border-amber-500/40 bg-amber-500/5",
          )}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {health.healthy ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="size-4 text-amber-600" />
            )}
            <p className="text-sm font-semibold">
              {health.healthy ? "Delivery configuration is complete" : "Delivery configuration needs attention"}
            </p>
            {!health.canSendWhatsapp && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                WhatsApp cannot send
              </Badge>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {health.checks.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle
                    className={cn("mt-0.5 size-3.5 shrink-0", c.advisory ? "text-amber-500" : "text-destructive")}
                  />
                )}
                <div className="min-w-0">
                  <p className={cn("font-medium", c.ok ? "text-muted-foreground" : "text-foreground")}>
                    {c.label}
                    {!c.ok && c.advisory && <span className="ml-1 font-normal text-amber-600">(optional)</span>}
                  </p>
                  {!c.ok && c.fix && <p className="mt-0.5 leading-snug text-muted-foreground">{c.fix}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-channel totals. Also act as filters. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {CHANNELS.map(({ key, label, icon: Icon }) => {
          const s = stats[key]
          const total = s.sent + s.failed
          const rate = total > 0 ? Math.round((s.sent / total) * 100) : null
          return (
            <button
              key={key}
              type="button"
              onClick={() => setChannel(channel === key ? "all" : key)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                channel === key ? "border-primary bg-primary/5" : "border-border hover:bg-secondary",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{label}</span>
                {rate !== null && (
                  <span
                    className={cn(
                      "ml-auto text-xs font-bold",
                      rate === 100 ? "text-emerald-600" : rate >= 80 ? "text-amber-600" : "text-destructive",
                    )}
                  >
                    {rate}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.sent} sent · {s.failed} failed
              </p>
            </button>
          )
        })}
      </div>

      {topFailure && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              Most common failure ({topFailure.count} of the last {logs.length})
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{explainFailure(topFailure.reason)}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, phone or email"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {EVENTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-border p-0.5">
          {(["all", "sent", "failed"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {paged.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–
        {(currentPage - 1) * PAGE_SIZE + paged.length} of {filtered.length} matching
        {filtered.length !== logs.length && ` (${logs.length} loaded)`}
        {channel !== "all" && ` · ${CHANNELS.find((c) => c.key === channel)?.label} only`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No notifications match these filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paged.map((l) => {
            const isOpen = expanded === l.id
            const failedChannels = (["whatsapp", "sms", "email"] as ChannelKey[]).filter((c) => l[c] && !l[c].sent)
            const when = parseFirestoreDate(l.createdAt)
            return (
              <div key={l.id} className="overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : l.id)}
                  className="flex w-full items-start gap-3 p-3 text-left hover:bg-secondary/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{l.orderNumber}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {eventLabel[l.event] ?? l.event}
                      </Badge>
                      {failedChannels.length === 0 ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600"
                        >
                          All sent
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive"
                        >
                          {failedChannels.length} failed
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {l.customerName || "Customer"} · {l.customerPhone || "no phone"}
                      {when && ` · ${when.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {CHANNELS.map(({ key, icon: Icon, label }) => {
                      const r = l[key]
                      return (
                        <span
                          key={key}
                          title={`${label}: ${r?.sent ? "sent" : "failed"}`}
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full",
                            r?.sent ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/10 text-destructive",
                          )}
                        >
                          <Icon className="size-3" />
                        </span>
                      )
                    })}
                    <ChevronDown
                      className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                    />
                  </div>
                </button>

                {isOpen && (
                  <div className="space-y-2 border-t border-border bg-secondary/30 p-3">
                    {CHANNELS.map(({ key, label }) => {
                      const r = l[key] as NotificationChannelResult | undefined
                      if (!r) return null
                      return (
                        <div key={key} className="text-xs">
                          <div className="flex items-center gap-2">
                            {r.sent ? (
                              <CheckCircle2 className="size-3.5 text-emerald-600" />
                            ) : (
                              <XCircle className="size-3.5 text-destructive" />
                            )}
                            <span className="font-medium">{label}</span>
                            <span className="text-muted-foreground">
                              {r.sent ? "accepted by provider" : "not sent"}
                            </span>
                          </div>
                          {!r.sent && (
                            <p className="ml-5 mt-1 leading-snug text-muted-foreground">{explainFailure(r.reason)}</p>
                          )}
                          {r.detail && (
                            <p className="ml-5 mt-1 break-all font-mono text-[10px] leading-snug text-muted-foreground/80">
                              {String(r.detail).slice(0, 500)}
                            </p>
                          )}
                        </div>
                      )
                    })}
                    <p className="pt-1 text-[10px] text-muted-foreground">
                      Order {l.orderId} · {l.customerEmail || "no email"}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-secondary"
          >
            Previous
          </button>

          {/* A window around the current page rather than every page — with a
              few hundred logs a full list of numbers would wrap several
              lines and bury the controls. */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 1)
            .map((n, idx, arr) => (
              <span key={n} className="flex items-center gap-1">
                {idx > 0 && arr[idx - 1] !== n - 1 && (
                  <span className="px-1 text-xs text-muted-foreground">…</span>
                )}
                <button
                  type="button"
                  onClick={() => setPage(n)}
                  className={cn(
                    "min-w-8 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                    n === currentPage
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-secondary",
                  )}
                >
                  {n}
                </button>
              </span>
            ))}

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-secondary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
