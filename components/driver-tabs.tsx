"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ShoppingBag, MapPin, MessageCircle, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"

// 4-tab layout mirroring the driver-app native shell. "Waiting" was
// removed at the user's request; "Completed" and "Settings" are reached
// from the drawer instead of the tab bar.
const tabs = [
  { label: "Orders",      href: "/driver/dashboard",   icon: ShoppingBag },
  { label: "Map",         href: "/driver/map",         icon: MapPin },
  { label: "Messages",    href: "/driver/messages",    icon: MessageCircle },
  { label: "Performance", href: "/driver/performance", icon: BarChart3 },
]

interface DriverTabsProps {
  /** Optional unread-message count for the Messages badge. Wire this up
   * once a /api/driver/messages/unread endpoint exists; until then the
   * dot is just hidden. */
  unreadMessages?: number
}

export function DriverTabs({ unreadMessages = 0 }: DriverTabsProps) {
  const pathname = usePathname()

  // Hide on login + delivery-confirmation pages (same as driver-app)
  if (pathname === "/driver" || pathname === "/driver/delivery" || pathname.startsWith("/driver/delivery/")) {
    return null
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-4 px-1 pb-1 pt-2">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          const showBadge = tab.label === "Messages" && unreadMessages > 0
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold transition-colors",
                active ? "text-green-600 dark:text-green-400" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="relative">
                <tab.icon
                  className={cn("h-6 w-6", active && "text-green-600 dark:text-green-400")}
                  strokeWidth={active ? 2.5 : 2}
                />
                {showBadge && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
