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

interface DriverSettings {
  dispatchOnlineOnly: boolean
  autoAcceptOrders: boolean
  showOrderPrice: boolean
  showEarningInfo: boolean
  showDriverPhone: boolean
  showSensitiveCustomerDetails: boolean
  itemCheckOnPickup: boolean
  requireProofOfDelivery: boolean
  requireProofOfPickup: boolean
  requireIdScanning: boolean
  driversCanReoptimizeRoute: boolean
  gpsPingIntervalSeconds: 10 | 30 | 60
  earningsPerKmRate: number
}

const DEFAULT: DriverSettings = {
  dispatchOnlineOnly: false,
  autoAcceptOrders: true,
  showOrderPrice: true,
  showEarningInfo: true,
  showDriverPhone: true,
  showSensitiveCustomerDetails: true,
  itemCheckOnPickup: true,
  requireProofOfDelivery: true,
  requireProofOfPickup: false,
  requireIdScanning: false,
  driversCanReoptimizeRoute: true,
  gpsPingIntervalSeconds: 30,
  earningsPerKmRate: 0,
}

const DRIVER_SETTINGS_DOC = "driverSettings"

const DRIVER_TOGGLES: Array<{ key: keyof DriverSettings; label: string; description?: string }> = [
  { key: "dispatchOnlineOnly", label: "Dispatch to online drivers only", description: "This is only show drivers active now on the driver page" },
  { key: "autoAcceptOrders", label: "Drivers will always accept assigned orders (auto-accept)", description: "No accept/reject option for the driver" },
  { key: "showOrderPrice", label: "Show order item price to driver/customer" },
  { key: "showEarningInfo", label: "Show earning info to drivers before they accept the order" },
  { key: "showDriverPhone", label: "Show driver phone number to customers", description: "Customers will be able to call drivers directly" },
  { key: "showSensitiveCustomerDetails", label: "Show sensitive customer details (Customer name & phone number) to the driver" },
  { key: "itemCheckOnPickup", label: "Item check on pick-up", description: "Drivers have to confirm items on pick-up" },
  { key: "requireProofOfDelivery", label: "Require Proof of Delivery", description: "Drivers must take proof of delivery (Signature or Picture) to complete an order" },
  { key: "requireProofOfPickup", label: "Require Proof of Pickup", description: "Drivers must take proof of pickup (Only Picture) to pick up an order" },
  { key: "requireIdScanning", label: "Requires ID scanning", description: "Drivers must do id scanning" },
  { key: "driversCanReoptimizeRoute", label: "Drivers can re-optimize the route from their App" },
]

export function DriverSettingsPanel() {
  const [driver, setDriver] = useState<DriverSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", DRIVER_SETTINGS_DOC))
        if (snap.exists()) {
          setDriver({ ...DEFAULT, ...snap.data() } as DriverSettings)
        }
      } catch (err) {
        console.error("Failed to load driver settings:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, "settings", DRIVER_SETTINGS_DOC), driver)
      logActivity({ action: "settings.updated", details: { section: "driver" } })
      toast({ title: "Saved", description: "Driver settings updated." })
    } catch (err) {
      console.error("Failed to save driver settings:", err)
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold">Driver app</h2>
        <p className="text-sm text-muted-foreground">Custom settings to manage drivers</p>
      </div>

      <div className="space-y-5">
        {DRIVER_TOGGLES.map((toggle) => (
          <div key={toggle.key} className="flex items-start gap-4">
            <Switch
              id={toggle.key}
              checked={driver[toggle.key] as boolean}
              onCheckedChange={(v) => setDriver((prev) => ({ ...prev, [toggle.key]: v }))}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor={toggle.key} className="font-semibold cursor-pointer">
                {toggle.label}
              </Label>
              {toggle.description && (
                <p className="text-sm text-muted-foreground">{toggle.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <hr className="border-border" />

      {/* GPS & Earnings */}
      <section className="space-y-6">
        <div>
          <h3 className="text-base font-semibold">GPS &amp; Earnings</h3>
          <p className="text-sm text-muted-foreground">Configure location tracking frequency and driver pay rate</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ping-interval">GPS ping interval</Label>
          <Select
            value={String(driver.gpsPingIntervalSeconds)}
            onValueChange={(v) => setDriver((prev) => ({ ...prev, gpsPingIntervalSeconds: Number(v) as 10 | 30 | 60 }))}
          >
            <SelectTrigger id="ping-interval" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">Every 10 seconds (high accuracy)</SelectItem>
              <SelectItem value="30">Every 30 seconds (balanced)</SelectItem>
              <SelectItem value="60">Every 60 seconds (battery saver)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Shorter intervals give more accurate live tracking but drain driver battery faster</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="earnings-rate">Earnings rate per km ({driver.earningsPerKmRate > 0 ? `₦${driver.earningsPerKmRate}/km` : "disabled"})</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">₦</span>
            <Input
              id="earnings-rate"
              type="number"
              min={0}
              step={50}
              value={driver.earningsPerKmRate}
              onChange={(e) => setDriver((prev) => ({ ...prev, earningsPerKmRate: Number(e.target.value) }))}
              className="w-36"
            />
            <span className="text-sm text-muted-foreground">/ km</span>
          </div>
          <p className="text-xs text-muted-foreground">Set to 0 to disable earnings calculation. Shown to drivers if &ldquo;Show earning info&rdquo; is on.</p>
        </div>
      </section>

      <div className="pt-4">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Driver Settings"}
        </Button>
      </div>
    </div>
  )
}
