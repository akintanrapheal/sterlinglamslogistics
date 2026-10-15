// Netlify Scheduled Function — replaces the Vercel cron in vercel.json.
// Runs daily at 03:00 UTC and calls the existing prune endpoint, authenticating with CRON_SECRET
// exactly as Vercel Cron did (GET + "Authorization: Bearer $CRON_SECRET"). The endpoint deletes
// audit logs / driver trails past their retention window.
import type { Config } from "@netlify/functions"

export default async () => {
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? ""
  const secret = process.env.CRON_SECRET
  if (!base || !secret) {
    return new Response("Missing URL or CRON_SECRET env", { status: 500 })
  }

  const res = await fetch(`${base}/api/admin/prune-audit-logs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body = await res.text()
  return new Response(`prune-audit-logs -> ${res.status}: ${body.slice(0, 500)}`, {
    status: res.ok ? 200 : 502,
  })
}

export const config: Config = {
  schedule: "0 3 * * *",
}
