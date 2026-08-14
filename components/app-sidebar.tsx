"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  Send,
  Package,
  Users,
  Route,
  Star,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  Bell,
  BellOff,
  HelpCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useRef, useEffect } from "react"
import { useAuth } from "@/components/auth-provider"
import { ThemeToggle } from "@/components/theme-provider"
import { useOrderAlert } from "@/components/order-alert-provider"
import { canAccessRoute, ROLES, type UserRole } from "@/lib/roles"

const navItems = [
  { label: "Dispatch", href: "/dispatch", icon: Send },
  { label: "Orders",   href: "/orders",   icon: Package },
  { label: "Drivers",  href: "/drivers",  icon: Users },
  { label: "Routes",   href: "/routes",   icon: Route },
  { label: "Reviews",  href: "/reviews",  icon: Star },
  { label: "Reports",  href: "/reports",  icon: BarChart3 },
]

export function AppSidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const { user, role, logout } = useAuth()
  const { muted, toggleMute } = useOrderAlert()
  const [unreadReviews, setUnreadReviews] = useState(false)

  useEffect(() => {
    try {
      const lastVisit = parseInt(localStorage.getItem("lastReviewsVisit") ?? "0")
      const latest = parseInt(localStorage.getItem("latestReviewTs") ?? "0")
      setUnreadReviews(latest > lastVisit)
    } catch { setUnreadReviews(false) }
  }, [pathname])

  // Filter nav items to only those the current role can access
  const visibleNav = navItems.filter((item) => canAccessRoute(role, item.href))
  const canSeeSettings = canAccessRoute(role, "/settings")

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    if (profileOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [profileOpen])

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 items-center gap-4 px-4 lg:px-6">
        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden p-2.5 -ml-2.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        {/* Logo */}
        <Link href="/dashboard" className="shrink-0">
          <Image
            src="/placeholder-logo.png"
            alt="Sterlinglams"
            width={80}
            height={80}
            className="rounded-lg"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          {visibleNav.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href))

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="relative">
                  {item.label}
                  {item.href === "/reviews" && unreadReviews && (
                    <span className="absolute -right-2 -top-1 size-2 rounded-full bg-orange-500" />
                  )}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleMute}
            className={cn(
              "rounded-md p-3 transition-colors",
              muted
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground hover:text-primary"
            )}
            aria-label={muted ? "Unmute notifications" : "Mute notifications"}
            title={muted ? "Notifications muted — click to unmute" : "Notifications on — click to mute"}
          >
            {muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          </button>
          <button
            className="rounded-md p-3 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Help"
            title="Help"
          >
            <HelpCircle className="size-4" />
          </button>
          <ThemeToggle />
          {/* User avatar with dropdown */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex size-11 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white"
              aria-label="Account menu"
            >
              {user?.email ? user.email[0].toUpperCase() : "A"}
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full z-[9999] mt-1 w-56 rounded-md border bg-popover p-1 shadow-lg">
                <p className="truncate px-3 py-1.5 text-xs text-muted-foreground">
                  {user?.email ?? "Account"}
                </p>
                {role && (
                  <p className="px-3 pb-1.5 text-xs font-medium text-primary">
                    {ROLES[role as UserRole]?.label ?? role}
                  </p>
                )}
                {canSeeSettings && (
                  <Link
                    href="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                  >
                    <Settings className="size-3.5" />
                    Settings
                  </Link>
                )}
                <button
                  onClick={() => { setProfileOpen(false); logout() }}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm text-destructive hover:bg-accent"
                >
                  <LogOut className="size-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav className="border-t bg-background px-4 py-3 lg:hidden">
          <div className="flex flex-wrap gap-2">
            {visibleNav.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href))

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              )
            })}
            {canSeeSettings && (
              <Link
                href="/settings"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/settings")
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Settings className="size-4" />
                Settings
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  )
}

