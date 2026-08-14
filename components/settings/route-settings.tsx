"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Save, Loader2 } from "lucide-react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { logActivity } from "@/lib/activity-client"
import { db } from "@/lib/firebase"
import { toast } from "@/hooks/use-toast"

interface RouteSettings {
  optimizationEnabled: boolean
  optimizationMode: "distance" | "time" | "manual"
  maxStopsPerRoute: number
  returnToHubAfterDelivery: boolean
  allowDriverReorder: boolean
  trafficAware: boolean
  deliveryTimeWindowsEnabled: boolean
  avoidHighways: boolean
  avoidTolls: boolean
}

const DEFAULT: RouteSettings = {
  optimizationEnabled: true,
  optimizationMode: "distance",
  maxStopsPerRoute: 15,
  returnToHubAfterDelivery: false,
  allowDriverReorder: true,
  trafficAware: false,
  deliveryTimeWindowsEnabled: false,
  avoidHighways: false,
  avoidTolls: false,
}

const SETTINGS_DOC = "routeSettings"

export function RouteSettingsPanel() {
  const [settings, setSettings] = useState<RouteSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", SETTINGS_DOC))
        if (snap.exists()) {
          setSettings({ ...DEFAULT, ...snap.data() } as RouteSettings)
        }
      } catch (err) {
        console.error("Failed to load route settings:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, "settings", SETTINGS_DOC), settings)
      logActivity({ action: "settings.updated", details: { section: "route" } })
      toast({ title: "Saved", description: "Route settings updated." })
    } catch (err) {
      console.error("Failed to save route settings:", err)
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof RouteSettings>(key: K, value: RouteSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold">Route planning</h2>
        <p className="text-sm text-muted-foreground">
          Configure route optimization and driver routing preferences
        </p>
      </div>

      {/* Optimization */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Route optimization</h3>
          <p className="text-sm text-muted-foreground">
            Automatically calculate the most efficient stop order for each route
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="opt-enabled" className="font-normal">Enable route optimization</Label>
          <Switch
            id="opt-enabled"
            checked={settings.optimizationEnabled}
            onCheckedChange={(v) => update("optimizationEnabled", v)}
          />
        </div>

        {settings.optimizationEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label>Optimize by</Label>
            <Select
              value={settings.optimizationMode}
              onValueChange={(v) => update("optimizationMode", v as RouteSettings["optimizationMode"])}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="distance">Shortest distance</SelectItem>
                <SelectItem value="time">Fastest time</SelectItem>
                <SelectItem value="manual">Manual (drag-and-drop only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      {/* Stop limits */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Route limits</h3>

        <div className="space-y-2">
          <Label htmlFor="max-stops">Maximum stops per route</Label>
          <Input
            id="max-stops"
            type="number"
            min={1}
            max={100}
            value={settings.maxStopsPerRoute}
            onChange={(e) => update("maxStopsPerRoute", Number(e.target.value))}
            className="w-28"
          />
          <p className="text-xs text-muted-foreground">
            Orders beyond this count will be queued for the next available route
          </p>
        </div>
      </section>

      {/* Preferences */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Routing preferences</h3>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="return-hub" className="font-normal">Return driver to hub after last delivery</Label>
            <p className="text-xs text-muted-foreground">
              Include hub as the final stop in every optimized route
            </p>
          </div>
          <Switch
            id="return-hub"
            checked={settings.returnToHubAfterDelivery}
            onCheckedChange={(v) => update("returnToHubAfterDelivery", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="driver-reorder" className="font-normal">Allow drivers to re-order stops in the app</Label>
            <p className="text-xs text-muted-foreground">
              Drivers can adjust their own stop sequence from the mobile app
            </p>
          </div>
          <Switch
            id="driver-reorder"
            checked={settings.allowDriverReorder}
            onCheckedChange={(v) => update("allowDriverReorder", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="traffic" className="font-normal">Traffic-aware routing</Label>
            <p className="text-xs text-muted-foreground">
              Use real-time traffic data when calculating ETAs (requires Google Maps API)
            </p>
          </div>
          <Switch
            id="traffic"
            checked={settings.trafficAware}
            onCheckedChange={(v) => update("trafficAware", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="avoid-highways" className="font-normal">Avoid highways</Label>
            <p className="text-xs text-muted-foreground">
              Passes <code className="font-mono">avoidHighways: true</code> to Google Maps route calculations
            </p>
          </div>
          <Switch
            id="avoid-highways"
            checked={settings.avoidHighways}
            onCheckedChange={(v) => update("avoidHighways", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="avoid-tolls" className="font-normal">Avoid tolls</Label>
            <p className="text-xs text-muted-foreground">
              Passes <code className="font-mono">avoidTolls: true</code> to Google Maps route calculations
            </p>
          </div>
          <Switch
            id="avoid-tolls"
            checked={settings.avoidTolls}
            onCheckedChange={(v) => update("avoidTolls", v)}
          />
        </div>
      </section>

      {/* Delivery time windows */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Delivery time windows</h3>
          <p className="text-sm text-muted-foreground">
            Allow customers to specify a preferred delivery window (e.g. 10am – 2pm). Drivers see the window on each stop.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="time-windows" className="font-normal">Enable customer time windows</Label>
          <Switch
            id="time-windows"
            checked={settings.deliveryTimeWindowsEnabled}
            onCheckedChange={(v) => update("deliveryTimeWindowsEnabled", v)}
          />
        </div>
        {settings.deliveryTimeWindowsEnabled && (
          <p className="text-xs text-muted-foreground pl-4 border-l-2 border-muted">
            When enabled, a time-window picker appears on the order form and is displayed to the driver in the mobile app.
          </p>
        )}
      </section>

      <div className="pt-2">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Route Settings"}
        </Button>
      </div>
    </div>
  )
}
