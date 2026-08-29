import { NextResponse } from "next/server"
import { verifyAdmin } from "@/lib/server/auth"
import { checkRateLimit, getRateLimitIdentifier } from "@/lib/rate-limit"

/**
 * Which notification senders are configured, and what that means.
 *
 * Admin-gated, unlike the public /api/health/notifications it replaces for UI
 * purposes. That one exists to diagnose an outage from outside when the admin
 * itself may be down; this one backs a settings panel, so it can require a
 * session and is free to be more explicit about what to fix.
 *
 * Still reports presence only — never a value. A SID or auth token must not be
 * retrievable from an endpoint regardless of who is asking.
 */
export const dynamic = "force-dynamic"

const set = (v?: string) => Boolean(v && v.trim())

interface Check {
  id: string
  label: string
  ok: boolean
  /** Shown when the check fails: what to change, in the admin's terms. */
  fix?: string
  /** Failing this doesn't stop messages going out, it just degrades them. */
  advisory?: boolean
}

export async function GET(req: Request) {
  const rl = await checkRateLimit(getRateLimitIdentifier(req))
  if (rl) return rl

  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const accountSid = set(process.env.TWILIO_ACCOUNT_SID)
  const authToken = set(process.env.TWILIO_AUTH_TOKEN)
  const waFrom = set(process.env.TWILIO_WHATSAPP_FROM)
  const waMsgSid = set(process.env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID)
  const waSender = waFrom || waMsgSid
  const tplFallback = set(process.env.TWILIO_WHATSAPP_CONTENT_SID)
  const tplAccepted = set(process.env.TWILIO_WHATSAPP_CONTENT_SID_ORDER_ACCEPTED)
  const tplOut = set(process.env.TWILIO_WHATSAPP_CONTENT_SID_OUT_FOR_DELIVERY)
  const tplDelivered = set(process.env.TWILIO_WHATSAPP_CONTENT_SID_DELIVERED)

  const checks: Check[] = [
    {
      id: "twilio_credentials",
      label: "Twilio account credentials",
      ok: accountSid && authToken,
      fix: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Without both, WhatsApp and SMS are abandoned before Twilio is contacted at all — only email will send.",
    },
    {
      id: "whatsapp_sender",
      label: "WhatsApp sender",
      ok: waSender,
      fix: "Set TWILIO_WHATSAPP_MESSAGING_SERVICE_SID (preferred) or TWILIO_WHATSAPP_FROM.",
    },
    {
      id: "whatsapp_template_out_for_delivery",
      label: "Template — out for delivery",
      ok: tplOut || tplFallback,
      fix: "Set TWILIO_WHATSAPP_CONTENT_SID_OUT_FOR_DELIVERY. WhatsApp refuses free-form business-initiated messages outside a 24-hour window, so without an approved template this fails with error 63016.",
    },
    {
      id: "whatsapp_template_order_accepted",
      label: "Template — order accepted",
      ok: tplAccepted,
      advisory: true,
      fix: tplFallback
        ? "Falls back to the generic template, so it sends but with the wrong wording for this event. Set TWILIO_WHATSAPP_CONTENT_SID_ORDER_ACCEPTED for a dedicated one."
        : "Set TWILIO_WHATSAPP_CONTENT_SID_ORDER_ACCEPTED, or a fallback TWILIO_WHATSAPP_CONTENT_SID.",
    },
    {
      id: "whatsapp_template_delivered",
      label: "Template — delivered",
      ok: tplDelivered,
      advisory: true,
      fix: tplFallback
        ? "Falls back to the generic template, so it sends but with the wrong wording for this event. Set TWILIO_WHATSAPP_CONTENT_SID_DELIVERED for a dedicated one."
        : "Set TWILIO_WHATSAPP_CONTENT_SID_DELIVERED, or a fallback TWILIO_WHATSAPP_CONTENT_SID.",
    },
    {
      id: "sms_sender",
      label: "SMS sender",
      ok: set(process.env.TWILIO_SMS_FROM),
      advisory: true,
      fix: "Set TWILIO_SMS_FROM to send SMS as well as WhatsApp. Leave unset if SMS is intentionally off.",
    },
    {
      id: "email",
      label: "Email sender",
      ok: set(process.env.RESEND_API_KEY) && set(process.env.NOTIFY_FROM_EMAIL),
      fix: "Set RESEND_API_KEY and NOTIFY_FROM_EMAIL.",
    },
  ]

  // Blocking failures only — advisories degrade quality, not delivery.
  const blocking = checks.filter((c) => !c.ok && !c.advisory)

  return NextResponse.json({
    ok: true,
    healthy: blocking.length === 0,
    canSendWhatsapp: accountSid && authToken && waSender && (tplOut || tplFallback),
    checks,
  })
}
