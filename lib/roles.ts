export const ROLES = {
  owner: {
    label: "Owner",
    description: "Full access including user management and billing",
    badge: "default" as const,
  },
  admin: {
    label: "Admin",
    description: "Full operational access — orders, drivers, dispatch, and settings",
    badge: "secondary" as const,
  },
  dispatcher: {
    label: "Dispatcher",
    description: "Assign and manage orders, assign drivers, and update order statuses",
    badge: "outline" as const,
  },
  operations_manager: {
    label: "Operations Manager",
    description: "Manage orders, routes, and drivers; view all reports",
    badge: "outline" as const,
  },
  accountant: {
    label: "Accountant",
    description: "View financial reports and order summaries — no operational changes",
    badge: "outline" as const,
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to the dashboard",
    badge: "outline" as const,
  },
} as const

export type UserRole = keyof typeof ROLES

export const ALL_ROLES = Object.keys(ROLES) as UserRole[]

/** Roles that can be assigned when inviting a new team member (owners are set manually). */
export const INVITABLE_ROLES: UserRole[] = [
  "admin",
  "dispatcher",
  "operations_manager",
  "accountant",
  "viewer",
]

/**
 * Route-level access control.
 * Key = pathname prefix, value = roles allowed.
 * The check uses startsWith so "/orders" covers "/orders/123" etc.
 */
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/dashboard":  ["owner", "admin", "dispatcher", "operations_manager", "accountant", "viewer"],
  "/dispatch":   ["owner", "admin", "dispatcher", "operations_manager"],
  "/orders":     ["owner", "admin", "dispatcher", "operations_manager", "accountant", "viewer"],
  "/drivers":    ["owner", "admin", "dispatcher", "operations_manager"],
  "/routes":     ["owner", "admin", "dispatcher", "operations_manager"],
  "/reviews":    ["owner", "admin", "dispatcher", "operations_manager", "accountant", "viewer"],
  "/reports":    ["owner", "admin", "operations_manager", "accountant", "viewer"],
  // Notification logs expose customer phone numbers and email addresses, and
  // the delivery config panel names which credentials are unset — so this is
  // scoped to the same audience as notification settings rather than to
  // everyone who can read reports.
  "/notifications": ["owner", "admin", "operations_manager"],
  "/settings":   ["owner", "admin"],
}

/**
 * Settings tab-level access control.
 * Only the tabs listed here are visible to a given role.
 */
export const SETTINGS_TAB_PERMISSIONS: Record<string, UserRole[]> = {
  business:      ["owner", "admin"],
  brand:         ["owner", "admin"],
  dispatch:      ["owner", "admin"],
  driver:        ["owner", "admin"],
  notification:  ["owner", "admin"],
  route:         ["owner", "admin"],
  location:      ["owner", "admin"],
  users:         ["owner", "admin"],  // Owner and admin can manage team members
}

/** The first route a role can access — used for redirecting after login. */
export const ROLE_HOME: Record<UserRole, string> = {
  owner:             "/dashboard",
  admin:             "/dashboard",
  dispatcher:        "/dispatch",
  operations_manager:"/orders",
  accountant:        "/reports",
  viewer:            "/orders",
}

/** Returns true if the given role can access the given pathname. */
export function canAccessRoute(role: UserRole | null | undefined, pathname: string): boolean {
  if (!role) return false
  for (const [prefix, allowed] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return (allowed as UserRole[]).includes(role)
    }
  }
  // Any unlisted route (e.g. /track/) is public — handled by RootShell separately
  return true
}

/** Returns true if the given role can see the given settings tab key. */
export function canAccessSettingsTab(role: UserRole | null | undefined, tab: string): boolean {
  if (!role) return false
  const allowed = SETTINGS_TAB_PERMISSIONS[tab]
  if (!allowed) return true
  return (allowed as UserRole[]).includes(role)
}
