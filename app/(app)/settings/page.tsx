"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Building2, Paintbrush, Settings2, Truck, Users, Bell, Route, MapPin, Plug } from "lucide-react"
import { BusinessSettingsPanel } from "@/components/settings/business-settings"
import { NotificationSettingsPanel } from "@/components/settings/notification-settings"
import { DriverSettingsPanel } from "@/components/settings/driver-settings"
import { DispatchSettingsPanel } from "@/components/settings/dispatch-settings"
import { RouteSettingsPanel } from "@/components/settings/route-settings"
import { UsersSettingsPanel } from "@/components/settings/users-settings"
import { LocationSettingsPanel } from "@/components/settings/location-settings"
import { BrandSettingsPanel } from "@/components/settings/brand-settings"
import { IntegrationsSettingsPanel } from "@/components/settings/integrations-settings"
import { useAuth } from "@/components/auth-provider"
import { canAccessSettingsTab } from "@/lib/roles"

const settingsNav = [
  { key: "business",     label: "Business settings",      icon: Building2 },
  { key: "brand",        label: "Brand customization",     icon: Paintbrush },
  { key: "dispatch",     label: "Dispatch settings",       icon: Settings2 },
  { key: "driver",       label: "Driver settings",         icon: Truck },
  { key: "notification", label: "Customer notification",   icon: Bell },
  { key: "route",        label: "Route planning",          icon: Route },
  { key: "users",        label: "Users",                   icon: Users },
  { key: "location",     label: "Location",                icon: MapPin },
  { key: "integrations", label: "Integrations",            icon: Plug },
]

export default function SettingsPage() {
  const { role } = useAuth()
  const visibleNav = settingsNav.filter((item) => canAccessSettingsTab(role, item.key))
  const [activeTab, setActiveTab] = useState(visibleNav[0]?.key ?? "business")

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your business settings and preferences
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Settings sidebar */}
        <nav className="w-full shrink-0 lg:w-56">
          <ul className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
            {visibleNav.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.key}>
                  <button
                    onClick={() => setActiveTab(item.key)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap",
                      activeTab === item.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Settings content */}
        <div className="flex-1 min-w-0">
          {activeTab === "business"     && <BusinessSettingsPanel />}
          {activeTab === "notification" && <NotificationSettingsPanel />}
          {activeTab === "driver"       && <DriverSettingsPanel />}
          {activeTab === "dispatch"     && <DispatchSettingsPanel />}
          {activeTab === "route"        && <RouteSettingsPanel />}
          {activeTab === "users"        && <UsersSettingsPanel />}
          {activeTab === "location"     && <LocationSettingsPanel />}
          {activeTab === "brand"        && <BrandSettingsPanel />}
          {activeTab === "integrations" && <IntegrationsSettingsPanel />}
        </div>
      </div>
    </div>
  )
}
