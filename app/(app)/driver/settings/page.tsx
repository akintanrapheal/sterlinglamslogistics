"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ChevronRight,
  HelpCircle,
  Info,
  Lock,
  Navigation,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  User,
} from "lucide-react"

const settingsGroups = [
  {
    items: [
      { label: "Profile", href: "/driver/settings/profile", icon: User },
      { label: "Delivery Preference", href: "/driver/settings/delivery-preference", icon: SlidersHorizontal },
      { label: "Navigation", href: "/driver/settings/navigations", icon: Navigation },
      { label: "Permissions", href: "/driver/settings/permissions", icon: ShieldCheck },
      { label: "Display", href: "/driver/settings/display", icon: Sun },
    ],
  },
  {
    items: [
      { label: "Help and Feedback", href: "/driver/settings/help-feedback", icon: HelpCircle },
      { label: "Privacy", href: "/driver/settings/privacy", icon: Lock },
      { label: "About", href: "/driver/settings/about", icon: Info },
    ],
  },
]

export default function DriverSettingsPage() {
  const router = useRouter()

  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-background py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg p-1.5 hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Settings</h1>
      </div>

      <div className="space-y-6">
        {settingsGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-1">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl px-3 py-3.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                <item.icon className="h-5 w-5 text-muted-foreground" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
            {groupIdx < settingsGroups.length - 1 && (
              <div className="mx-3 border-b" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
