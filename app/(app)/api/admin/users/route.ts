import { NextResponse } from "next/server"
import { adminAuth, adminDb } from "@/lib/server/firebase-admin"
import { verifyManager } from "@/lib/server/auth"
import { checkAdminApiRateLimit } from "@/lib/rate-limit"
import { INVITABLE_ROLES, ROLES, type UserRole } from "@/lib/roles"
import { audit } from "@/lib/audit"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:users")

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL ?? ""
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ""
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? ""

async function sendInviteEmail(opts: {
  to: string
  name: string
  role: UserRole
  resetLink: string
}) {
  if (!RESEND_API_KEY || !FROM_EMAIL) {
    log.warn("Resend not configured — invite email skipped")
    return
  }
  const roleLabel = ROLES[opts.role].label
  const dashboardUrl = `${SITE_ORIGIN}/login`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:32px 16px">
  <img src="${SITE_ORIGIN}/logo.png" alt="Sterling Lams Logistics" style="height:48px;margin-bottom:24px" />
  <h1 style="font-size:22px;margin-bottom:8px">You've been invited!</h1>
  <p style="color:#555">Hi ${opts.name},</p>
  <p style="color:#555">You have been added to the <strong>Sterling Lams Logistics</strong> dashboard as a <strong>${roleLabel}</strong>.</p>
  <p style="color:#555">Click the button below to set your password and get started. This link expires in 1 hour.</p>
  <a href="${opts.resetLink}"
     style="display:inline-block;margin:16px 0;padding:12px 24px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
    Set your password
  </a>
  <p style="color:#888;font-size:13px">After setting your password, sign in at <a href="${dashboardUrl}" style="color:#e91e8c">${dashboardUrl}</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#aaa;font-size:12px">If you did not expect this invitation, you can safely ignore this email.</p>
</body>
</html>`

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Sterling Lams Logistics <${FROM_EMAIL}>`,
      to: opts.to,
      subject: `You've been invited to Sterling Lams Logistics`,
      html,
    }),
  })
}

/** GET /api/admin/users — list all admin team members */
export async function GET(req: Request) {
  const admin = await verifyManager(req)
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Per-user, not per-IP — see checkAdminApiRateLimit.
  const rl = await checkAdminApiRateLimit(admin.uid)
  if (rl) return rl

  try {
    // List all Firebase Auth users that have admin:true custom claim
    // We use listUsers and filter, since there's no index on custom claims.
    // For small teams (<1000) this is fine.
    const allAuthUsers: import("firebase-admin/auth").UserRecord[] = []
    let pageToken: string | undefined
    do {
      const result = await adminAuth.listUsers(1000, pageToken)
      for (const u of result.users) {
        const claims = (u.customClaims ?? {}) as Record<string, unknown>
        if (claims.admin === true) allAuthUsers.push(u)
      }
      pageToken = result.pageToken
    } while (pageToken)

    // Load Firestore metadata for all admin users (for name/role fallback)
    const snap = await adminDb.collection("admins").get()
    const firestoreMeta = new Map(snap.docs.map((d) => [d.id, d.data()]))

    const users = allAuthUsers
      .map((u) => {
        const claims = (u.customClaims ?? {}) as Record<string, unknown>
        const meta = firestoreMeta.get(u.uid) ?? {}
        // Resolve role: explicit claim → Firestore field → legacy admin=true → owner
        const role = (
          (claims.role as UserRole) ??
          (meta.role as UserRole) ??
          (claims.admin === true ? "owner" : "viewer")
        ) as UserRole
        return {
          uid: u.uid,
          email: u.email ?? "",
          name: u.displayName ?? (meta.name as string) ?? "",
          role,
          disabled: u.disabled,
          lastSignInTime: u.metadata.lastSignInTime ?? null,
          creationTime: u.metadata.creationTime ?? null,
        }
      })
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))

    return NextResponse.json({ ok: true, users })
  } catch (error) {
    log.error({ error }, "Failed to list admin users")
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
  }
}

/** POST /api/admin/users — create a new team member and send invite email */
export async function POST(req: Request) {
  const admin = await verifyManager(req)
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Per-user, not per-IP — see checkAdminApiRateLimit.
  const rl = await checkAdminApiRateLimit(admin.uid)
  if (rl) return rl

  let body: { email?: string; name?: string; role?: UserRole }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ""
  const name = body.name?.trim() ?? ""
  const role = body.role as UserRole | undefined

  if (!email || !name || !role) {
    return NextResponse.json({ error: "email, name and role are required" }, { status: 400 })
  }
  if (!INVITABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }

  try {
    const userRecord = await adminAuth.createUser({
      email,
      displayName: name,
      emailVerified: false,
    })

    await adminAuth.setCustomUserClaims(userRecord.uid, { admin: true, role })

    await adminDb.collection("admins").doc(userRecord.uid).set({
      email,
      name,
      role,
      addedBy: admin.uid,
      addedAt: new Date(),
    })

    // Generate a password-reset link so the invitee sets their own password
    const resetLink = await adminAuth.generatePasswordResetLink(email)
    await sendInviteEmail({ to: email, name, role, resetLink }).catch((err) =>
      log.error({ err }, "Failed to send invite email")
    )

    await audit({
      action: "user.invited",
      actor: admin.email ?? admin.uid,
      resourceType: "user",
      resourceId: email,
      details: { target: name, role },
    })

    log.info({ uid: userRecord.uid, email, role }, "Admin user created")
    return NextResponse.json({ ok: true, uid: userRecord.uid })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("email-already-exists")) {
      return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 })
    }
    log.error({ error, email, role }, "Failed to create admin user")
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
  }
}
