"use client"

import { useEffect, useState, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Loader2, Trash2, UserPlus, Shield, User, MoreHorizontal,
  KeyRound, UserCog, UserX, UserCheck, RefreshCw, Activity,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { ROLES, INVITABLE_ROLES, type UserRole } from "@/lib/roles"
import { useAuth } from "@/components/auth-provider"
import { auth } from "@/lib/firebase"

interface TeamUser {
  uid: string
  email: string
  name: string
  role: UserRole
  disabled: boolean
  lastSignInTime: string | null
  creationTime: string | null
}

interface ActivityEntry {
  id: string
  action: string
  actor: string | null
  resourceType: string | null
  resourceId: string | null
  details: Record<string, unknown> | null
  timestamp: string | null
}

/** Turn a raw audit entry into a readable sentence. */
function describeActivity(e: ActivityEntry): string {
  const d = e.details ?? {}
  const target = (d.target as string) || e.resourceId || "a user"
  const role = d.role ? (ROLES[d.role as UserRole]?.label ?? d.role) : ""
  switch (e.action) {
    case "user.invited":
      return `Invited ${target}${role ? ` as ${role}` : ""}`
    case "user.role_changed":
      return `Changed ${target}'s role${role ? ` to ${role}` : ""}`
    case "user.password_reset":
      return `Sent a password reset to ${target}`
    case "user.disabled":
      return `Disabled ${target}'s account`
    case "user.enabled":
      return `Enabled ${target}'s account`
    case "user.deleted":
      return `Removed ${target} from the team`
    case "order.created":
      return `Created order ${e.resourceId ?? ""}`.trim()
    case "order.updated":
      return `Updated order ${e.resourceId ?? ""}`.trim()
    case "order.deleted":
      return `Deleted order ${e.resourceId ?? ""}`.trim()
    case "order.assigned":
      return `Assigned order ${e.resourceId ?? ""}`.trim()
    case "order.status_changed":
      return `Changed status of order ${e.resourceId ?? ""}`.trim()
    case "driver.created":
      return `Added driver ${e.resourceId ?? ""}`.trim()
    case "driver.updated":
      return `Updated driver ${e.resourceId ?? ""}`.trim()
    case "driver.deleted":
      return `Removed driver ${e.resourceId ?? ""}`.trim()
    case "driver.password_changed":
      return `Changed a driver's password`
    case "driver.status_changed":
      return `Changed a driver's status`
    case "settings.updated":
      return d.section ? `Updated ${d.section} settings` : `Updated settings`
    case "admin.login":
      return `Signed in`
    case "admin.clean_orders":
      return `Cleaned up orders`
    case "audit.pruned":
      return `Pruned ${(d.count as number) ?? 0} old activity log ${
        (d.count as number) === 1 ? "entry" : "entries"
      }`
    default:
      return e.action
  }
}

function RoleBadge({ role }: { role: UserRole }) {
  const def = ROLES[role] ?? ROLES.viewer
  return <Badge variant={def.badge}>{def.label}</Badge>
}

function formatDateTime(iso: string | null) {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

async function apiFetch(url: string, opts?: RequestInit) {
  const token = await auth?.currentUser?.getIdToken()
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  })
}

export function UsersSettingsPanel() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [inviteName, setInviteName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<UserRole>("dispatcher")

  // Manage dialog state
  const [managingUser, setManagingUser] = useState<TeamUser | null>(null)
  const [showManage, setShowManage] = useState(false)
  const [newRole, setNewRole] = useState<UserRole>("dispatcher")
  const [actionLoading, setActionLoading] = useState(false)

  // Activity log
  const [logs, setLogs] = useState<ActivityEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logActor, setLogActor] = useState<string>("all")

  const loadActivity = useCallback(async () => {
    setLogsLoading(true)
    try {
      const res = await apiFetch("/api/admin/activity?limit=200")
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setLogs(data.entries ?? [])
    } catch {
      // Non-fatal: the activity panel just shows empty.
    } finally {
      setLogsLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/users")
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setUsers(data.users ?? [])
    } catch {
      toast({ title: "Error", description: "Could not load team members.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
    loadActivity()
  }, [loadUsers, loadActivity])

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase()
    const name = inviteName.trim()
    if (!email || !name) {
      toast({ title: "Missing fields", description: "Name and email are required.", variant: "destructive" })
      return
    }
    setInviting(true)
    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, name, role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Failed to invite", description: data.error ?? "Unknown error", variant: "destructive" })
        return
      }
      toast({ title: "Invited!", description: `${name} will receive an email to set their password.` })
      setShowInvite(false)
      setInviteName("")
      setInviteEmail("")
      setInviteRole("dispatcher")
      loadUsers()
      loadActivity()
    } catch {
      toast({ title: "Error", description: "Failed to send invite.", variant: "destructive" })
    } finally {
      setInviting(false)
    }
  }

  function openManage(user: TeamUser) {
    setManagingUser(user)
    setNewRole(user.role)
    setShowManage(true)
  }

  async function handleUpdateRole() {
    if (!managingUser) return
    setActionLoading(true)
    try {
      const res = await apiFetch(`/api/admin/users/${managingUser.uid}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_role",
          role: newRole,
          targetName: managingUser.name,
          targetEmail: managingUser.email,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast({ title: "Error", description: d.error, variant: "destructive" })
        return
      }
      toast({ title: "Role updated", description: `${managingUser.name}'s role is now ${ROLES[newRole].label}.` })
      setShowManage(false)
      loadUsers()
      loadActivity()
    } catch {
      toast({ title: "Error", description: "Failed to update role.", variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleResetPassword(user: TeamUser) {
    setActionLoading(true)
    try {
      const res = await apiFetch(`/api/admin/users/${user.uid}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "reset_password",
          targetName: user.name,
          targetEmail: user.email,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast({ title: "Error", description: d.error, variant: "destructive" })
        return
      }
      toast({ title: "Password reset sent", description: `A reset email has been sent to ${user.email}.` })
      loadActivity()
    } catch {
      toast({ title: "Error", description: "Failed to send reset email.", variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleToggleDisabled(user: TeamUser) {
    setActionLoading(true)
    try {
      const res = await apiFetch(`/api/admin/users/${user.uid}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "toggle_disabled",
          targetName: user.name,
          targetEmail: user.email,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast({ title: "Error", description: d.error, variant: "destructive" })
        return
      }
      const action = user.disabled ? "enabled" : "disabled"
      toast({ title: `Account ${action}`, description: `${user.name}'s account has been ${action}.` })
      loadUsers()
      loadActivity()
    } catch {
      toast({ title: "Error", description: "Failed to update account status.", variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete(user: TeamUser) {
    if (!confirm(`Remove ${user.name} from the team? This cannot be undone.`)) return
    setActionLoading(true)
    try {
      const res = await apiFetch(
        `/api/admin/users/${user.uid}?target=${encodeURIComponent(user.name || user.email)}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const d = await res.json()
        toast({ title: "Error", description: d.error, variant: "destructive" })
        return
      }
      toast({ title: "User removed", description: `${user.name} has been removed from the team.` })
      setShowManage(false)
      loadUsers()
      loadActivity()
    } catch {
      toast({ title: "Error", description: "Failed to remove user.", variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Users &amp; team</h2>
          <p className="text-sm text-muted-foreground">
            Manage dashboard access. Invited users receive an email to set their password.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadUsers} disabled={loading} title="Refresh">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setShowInvite(true)} size="sm">
            <UserPlus className="mr-2 size-4" />
            Invite user
          </Button>
        </div>
      </div>

      {/* Role legend */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Available roles</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(Object.entries(ROLES) as [UserRole, typeof ROLES[UserRole]][]).map(([key, def]) => (
            <div key={key} className="flex items-start gap-2">
              <Badge variant={def.badge} className="mt-0.5 shrink-0">{def.label}</Badge>
              <p className="text-xs text-muted-foreground">{def.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* User list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No team members added yet. Invite someone to get started.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {users.map((user) => (
            <li
              key={user.uid}
              className={`flex items-center gap-4 px-4 py-3 ${user.disabled ? "opacity-60" : ""}`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                {user.role === "owner" ? (
                  <Shield className="size-4 text-muted-foreground" />
                ) : (
                  <User className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  {user.disabled && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>
                  )}
                  {user.uid === currentUser?.uid && (
                    <Badge variant="outline" className="text-xs">You</Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                <p className="text-xs text-muted-foreground">
                  Last sign-in: {formatDateTime(user.lastSignInTime)}
                </p>
              </div>
              <RoleBadge role={user.role} />
              {user.uid !== currentUser?.uid && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">Manage {user.name}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openManage(user)}>
                      <UserCog className="mr-2 size-4" />
                      Change role
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleResetPassword(user)}>
                      <KeyRound className="mr-2 size-4" />
                      Send password reset
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleToggleDisabled(user)}>
                      {user.disabled ? (
                        <><UserCheck className="mr-2 size-4" />Enable account</>
                      ) : (
                        <><UserX className="mr-2 size-4" />Disable account</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDelete(user)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Remove from team
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Activity log */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <h3 className="text-base font-semibold">Activity log</h3>
          </div>
          <div className="flex items-center gap-2">
            <Select value={logActor} onValueChange={setLogActor}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.uid} value={u.email}>
                    {u.name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={loadActivity}
              disabled={logsLoading}
              title="Refresh activity"
            >
              <RefreshCw className={`size-4 ${logsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {logsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (() => {
          const filtered =
            logActor === "all" ? logs : logs.filter((l) => l.actor === logActor)
          if (filtered.length === 0) {
            return (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No activity recorded yet.
              </div>
            )
          }
          const nameByEmail = new Map(users.map((u) => [u.email, u.name]))
          return (
            <ul className="divide-y rounded-lg border">
              {filtered.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {(entry.actor && nameByEmail.get(entry.actor)) || entry.actor || "Unknown"}
                      </span>{" "}
                      <span className="text-muted-foreground">{describeActivity(entry)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(entry.timestamp)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )
        })()}
      </div>

      {/* Invite dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
            <DialogDescription>
              They will receive an email with a link to set their own password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="invite-name">Full name</Label>
              <Input
                id="invite-name"
                placeholder="Jane Doe"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="jane@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div>
                        <p className="font-medium">{ROLES[role].label}</p>
                        <p className="text-xs text-muted-foreground">{ROLES[role].description}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UserPlus className="mr-2 size-4" />}
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change role dialog */}
      <Dialog open={showManage} onOpenChange={setShowManage}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role — {managingUser?.name}</DialogTitle>
            <DialogDescription>
              Select a new role for this team member. Changes take effect on their next sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    <div>
                      <p className="font-medium">{ROLES[role].label}</p>
                      <p className="text-xs text-muted-foreground">{ROLES[role].description}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManage(false)}>Cancel</Button>
            <Button onClick={handleUpdateRole} disabled={actionLoading || newRole === managingUser?.role}>
              {actionLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Update role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
