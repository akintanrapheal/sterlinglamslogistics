import { NextResponse } from "next/server"
import { adminAuth, adminDb } from "@/lib/server/firebase-admin"
import { verifyManager } from "@/lib/server/auth"
import { checkAdminApiRateLimit } from "@/lib/rate-limit"
import { INVITABLE_ROLES, ROLES, type UserRole } from "@/lib/roles"
import { audit } from "@/lib/audit"
import { createLogger } from "@/lib/logger"

const log = createLogger("api:admin:users:[uid]")

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL ?? ""
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ""
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? ""

async function sendPasswordResetEmail(to: string, name: string, resetLink: string) {
  if (!RESEND_API_KEY || !FROM_EMAIL) return

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:32px 16px">
  <h1 style="font-size:22px;margin-bottom:8px">Password reset</h1>
  <p style="color:#555">Hi ${name},</p>
  <p style="color:#555">An admin has requested a password reset for your <strong>Sterling Lams Logistics</strong> account.</p>
  <p style="color:#555">Click the button below to choose a new password. This link expires in 1 hour.</p>
  <a href="${resetLink}"
     style="display:inline-block;margin:16px 0;padding:12px 24px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
    Reset password
  </a>
  <p style="color:#888;font-size:13px">Sign in at <a href="${SITE_ORIGIN}/login" style="color:#e91e8c">${SITE_ORIGIN}/login</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#aaa;font-size:12px">If you did not request this, you can safely ignore this email.</p>
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
      to,
      subject: "Reset your Sterling Lams Logistics password",
      html,
    }),
  })
}

type Params = { params: Promise<{ uid: string }> }

/**
 * PATCH /api/admin/users/[uid]
 * Supported actions:
 *   { action: "update_role", role: UserRole }
 *   { action: "reset_password" }
 *   { action: "update_name", name: string }
 *   { action: "toggle_disabled" }
 */
export async function PATCH(req: Request, { params }: Params) {
  const admin = await verifyManager(req)
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Per-user, not per-IP — see checkAdminApiRateLimit.
  const rl = await checkAdminApiRateLimit(admin.uid)
  if (rl) return rl

  const { uid } = await params
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 })

  let body: { action?: string; role?: UserRole; name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const userRecord = await adminAuth.getUser(uid)
    const metaSnap = await adminDb.collection("admins").doc(uid).get()
    const meta = metaSnap.data() ?? {}
    const userName = userRecord.displayName ?? (meta.name as string) ?? "Team member"

    if (body.action === "update_role") {
      const role = body.role as UserRole
      if (!role || !INVITABLE_ROLES.includes(role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 })
      }
      await adminAuth.setCustomUserClaims(uid, { admin: true, role })
      await adminDb.collection("admins").doc(uid).set({ role }, { merge: true })
      await audit({
        action: "user.role_changed",
        actor: admin.email ?? admin.uid,
        resourceType: "user",
        resourceId: uid,
        details: { target: userName, role },
      })
      log.info({ uid, role }, "User role updated")
      return NextResponse.json({ ok: true })
    }

    if (body.action === "reset_password") {
      if (!userRecord.email) {
        return NextResponse.json({ error: "User has no email" }, { status: 400 })
      }
      const resetLink = await adminAuth.generatePasswordResetLink(userRecord.email)
      await sendPasswordResetEmail(userRecord.email, userName, resetLink).catch((err) =>
        log.error({ err }, "Failed to send password reset email")
      )
      await audit({
        action: "user.password_reset",
        actor: admin.email ?? admin.uid,
        resourceType: "user",
        resourceId: uid,
        details: { target: userName },
      })
      log.info({ uid }, "Password reset email sent")
      return NextResponse.json({ ok: true })
    }

    if (body.action === "update_name") {
      const name = body.name?.trim() ?? ""
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })
      await adminAuth.updateUser(uid, { displayName: name })
      await adminDb.collection("admins").doc(uid).set({ name }, { merge: true })
      return NextResponse.json({ ok: true })
    }

    if (body.action === "toggle_disabled") {
      const newDisabled = !userRecord.disabled
      await adminAuth.updateUser(uid, { disabled: newDisabled })
      await audit({
        action: newDisabled ? "user.disabled" : "user.enabled",
        actor: admin.email ?? admin.uid,
        resourceType: "user",
        resourceId: uid,
        details: { target: userName },
      })
      return NextResponse.json({ ok: true, disabled: newDisabled })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("user-not-found")) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    log.error({ error, uid }, "User PATCH failed")
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
  }
}

/** DELETE /api/admin/users/[uid] — remove user from Firebase Auth + Firestore */
export async function DELETE(req: Request, { params }: Params) {
  const admin = await verifyManager(req)
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Per-user, not per-IP — see checkAdminApiRateLimit.
  const rl = await checkAdminApiRateLimit(admin.uid)
  if (rl) return rl

  const { uid } = await params
  if (!uid) return NextResponse.json({ error: "uid is required" }, { status: 400 })

  // Prevent self-deletion
  if (uid === admin.uid) {
    return NextResponse.json({ error: "You cannot remove your own account" }, { status: 400 })
  }

  const target = new URL(req.url).searchParams.get("target") || uid

  try {
    await adminAuth.deleteUser(uid)
    await adminDb.collection("admins").doc(uid).delete()
    await audit({
      action: "user.deleted",
      actor: admin.email ?? admin.uid,
      resourceType: "user",
      resourceId: uid,
      details: { target },
    })
    log.info({ uid, deletedBy: admin.uid }, "Admin user deleted")
    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("user-not-found")) {
      // Might already be deleted — clean up Firestore anyway
      await adminDb.collection("admins").doc(uid).delete().catch(() => {})
      return NextResponse.json({ ok: true })
    }
    log.error({ error, uid }, "Failed to delete admin user")
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 })
  }
}
