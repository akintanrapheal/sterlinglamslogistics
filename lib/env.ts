import { z } from "zod"

/**
 * Server-side environment variables — validated at import time.
 * If any required variable is missing, the app logs a warning (not a hard crash)
 * so that pages that don't need server env vars still work during `next build`.
 */
const serverEnvSchema = z.object({
  // Twilio
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_SMS_FROM: z.string().min(1).optional(),
  TWILIO_WHATSAPP_FROM: z.string().min(1).optional(),
  TWILIO_WHATSAPP_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
  TWILIO_WHATSAPP_CONTENT_SID: z.string().min(1).optional(),
  TWILIO_WHATSAPP_CONTENT_SID_ORDER_ACCEPTED: z.string().min(1).optional(),
  TWILIO_WHATSAPP_CONTENT_SID_OUT_FOR_DELIVERY: z.string().min(1).optional(),
  TWILIO_WHATSAPP_CONTENT_SID_DELIVERED: z.string().min(1).optional(),
  // Resend
  RESEND_API_KEY: z.string().min(1).optional(),
  NOTIFY_FROM_EMAIL: z.string().email().optional(),
  // WooCommerce
  WOOCOMMERCE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Sterlin Glams store (sterlinglams.com) — shared HMAC secret for the new platform's order
  // push (/api/external-orders) and the delivered callback we POST back to the store.
  STORE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STORE_DELIVERED_WEBHOOK_URL: z.string().url().optional(),
  // Upstash (rate limiting)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  // Sentry
  SENTRY_DSN: z.string().url().optional(),
})

/**
 * Client-side (public) environment variables — validated at import time.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_GOOGLE_MAPS_KEY: z.string().optional(),
  NEXT_PUBLIC_HUB_LAT: z.string().optional(),
  NEXT_PUBLIC_HUB_LNG: z.string().optional(),
})

function validateEnv() {
  // Client env
  const clientResult = clientEnvSchema.safeParse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_GOOGLE_MAPS_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY,
    NEXT_PUBLIC_HUB_LAT: process.env.NEXT_PUBLIC_HUB_LAT,
    NEXT_PUBLIC_HUB_LNG: process.env.NEXT_PUBLIC_HUB_LNG,
  })

  if (!clientResult.success) {
    console.warn(
      "[env] Missing or invalid client env vars:",
      clientResult.error.flatten().fieldErrors,
    )
  }

  // Server env (only validate on the server)
  if (typeof window === "undefined") {
    const serverResult = serverEnvSchema.safeParse(process.env)
    if (!serverResult.success) {
      console.warn(
        "[env] Missing or invalid server env vars:",
        serverResult.error.flatten().fieldErrors,
      )
    }
  }
}

// Run validation on import
validateEnv()

export { serverEnvSchema, clientEnvSchema }
