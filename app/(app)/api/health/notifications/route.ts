import { NextResponse } from "next/server"

/**
 * Reports which notification senders are configured.
 *
 * WhatsApp failing while email succeeds has several possible causes that are
 * indistinguishable without seeing the deployment's environment: no sender
 * configured, no approved template for the event, or Twilio rejecting the
 * send. Reading them off the hosting dashboard is slow and easy to get wrong
 * when more than one deployment exists.
 *
 * Deliberately reports presence only — never a value. A SID or auth token
 * must not be retrievable from an endpoint, and the answer to "is it set?"
 * is what actually unblocks the diagnosis.
 */
export const dynamic = "force-dynamic"

const set = (v?: string) => Boolean(v && v.trim())

export async function GET() {
  const whatsappSender =
    set(process.env.TWILIO_WHATSAPP_FROM) ||
    set(process.env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID)

  // WhatsApp refuses free-form business-initiated messages outside the 24h
  // customer-service window, so without a template SID the "on the way"
  // notification can only ever fail with error 63016 — regardless of whether
  // the sender itself is set up correctly.
  const outForDeliveryTemplate =
    set(process.env.TWILIO_WHATSAPP_CONTENT_SID_OUT_FOR_DELIVERY) ||
    set(process.env.TWILIO_WHATSAPP_CONTENT_SID)

  return NextResponse.json({
    twilio: {
      accountSid: set(process.env.TWILIO_ACCOUNT_SID),
      authToken: set(process.env.TWILIO_AUTH_TOKEN),
      smsFrom: set(process.env.TWILIO_SMS_FROM),
      whatsappFrom: set(process.env.TWILIO_WHATSAPP_FROM),
      whatsappMessagingServiceSid: set(process.env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID),
      whatsappSenderConfigured: whatsappSender,
    },
    whatsappTemplates: {
      fallback: set(process.env.TWILIO_WHATSAPP_CONTENT_SID),
      orderAccepted: set(process.env.TWILIO_WHATSAPP_CONTENT_SID_ORDER_ACCEPTED),
      outForDelivery: set(process.env.TWILIO_WHATSAPP_CONTENT_SID_OUT_FOR_DELIVERY),
      delivered: set(process.env.TWILIO_WHATSAPP_CONTENT_SID_DELIVERED),
    },
    email: {
      resendApiKey: set(process.env.RESEND_API_KEY),
      fromAddress: set(process.env.NOTIFY_FROM_EMAIL),
    },
    // The single most useful line: whether "Mark as on the way" can send a
    // WhatsApp message at all with the current configuration.
    canSendOutForDeliveryWhatsapp:
      set(process.env.TWILIO_ACCOUNT_SID) &&
      set(process.env.TWILIO_AUTH_TOKEN) &&
      whatsappSender &&
      outForDeliveryTemplate,
  })
}
