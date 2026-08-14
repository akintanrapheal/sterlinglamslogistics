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

interface DispatchSettings {
  autoAssignEnabled: boolean
  autoAssignStrategy: "nearest" | "least_loaded" | "round_robin"
  dispatchCutoffEnabled: boolean
  dispatchCutoffTime: string
  requireDriverConfirmation: boolean
  maxOrdersPerDriver: number
  notifyDriverOnAssign: boolean
  slaEnabled: boolean
  slaHours: number
  graceMinutes: number
  autoReassignEnabled: boolean
}

const DEFAULT: DispatchSettings = {
  autoAssignEnabled: false,
  autoAssignStrategy: "nearest",
  dispatchCutoffEnabled: false,
  dispatchCutoffTime: "18:00",
  requireDriverConfirmation: false,
  maxOrdersPerDriver: 20,
  notifyDriverOnAssign: true,
  slaEnabled: false,
  slaHours: 4,
  graceMinutes: 10,
  autoReassignEnabled: false,
}

const SETTINGS_DOC = "dispatchSettings"

export function DispatchSettingsPanel() {
  const [settings, setSettings] = useState<DispatchSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", SETTINGS_DOC))
        if (snap.exists()) {
          setSettings({ ...DEFAULT, ...snap.data() } as DispatchSettings)
        }
      } catch (err) {
        console.error("Failed to load dispatch settings:", err)
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
      logActivity({ action: "settings.updated", details: { section: "dispatch" } })
      toast({ title: "Saved", description: "Dispatch settings updated." })
    } catch (err) {
      console.error("Failed to save dispatch settings:", err)
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof DispatchSettings>(key: K, value: DispatchSettings[K]) {
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
        <h2 className="text-xl font-semibold">Dispatch settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure how orders are dispatched and assigned to drivers
        </p>
      </div>

      {/* Auto-assign */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Auto-assign</h3>
          <p className="text-sm text-muted-foreground">
            Automatically assign incoming orders to available drivers
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="auto-assign" className="font-normal">Enable auto-assign</Label>
          <Switch
            id="auto-assign"
            checked={settings.autoAssignEnabled}
            onCheckedChange={(v) => update("autoAssignEnabled", v)}
          />
        </div>

        {settings.autoAssignEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label>Auto-assign strategy</Label>
            <Select
              value={settings.autoAssignStrategy}
              onValueChange={(v) => update("autoAssignStrategy", v as DispatchSettings["autoAssignStrategy"])}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nearest">Nearest driver</SelectItem>
                <SelectItem value="least_loaded">Least loaded driver</SelectItem>
                <SelectItem value="round_robin">Round robin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      {/* Dispatch cutoff */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Dispatch cutoff</h3>
          <p className="text-sm text-muted-foreground">
            Stop accepting new dispatch assignments after a certain time of day
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="cutoff-enabled" className="font-normal">Enable dispatch cutoff</Label>
          <Switch
            id="cutoff-enabled"
            checked={settings.dispatchCutoffEnabled}
            onCheckedChange={(v) => update("dispatchCutoffEnabled", v)}
          />
        </div>

        {settings.dispatchCutoffEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label htmlFor="cutoff-time">Cutoff time</Label>
            <Input
              id="cutoff-time"
              type="time"
              value={settings.dispatchCutoffTime}
              onChange={(e) => update("dispatchCutoffTime", e.target.value)}
              className="w-36"
            />
          </div>
        )}
      </section>

      {/* Limits */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Order limits</h3>

        <div className="space-y-2">
          <Label htmlFor="max-orders">Maximum orders per driver</Label>
          <Input
            id="max-orders"
            type="number"
            min={1}
            max={100}
            value={settings.maxOrdersPerDriver}
            onChange={(e) => update("maxOrdersPerDriver", Number(e.target.value))}
            className="w-28"
          />
          <p className="text-xs text-muted-foreground">
            Drivers will not receive new assignments when they reach this limit
          </p>
        </div>
      </section>

      {/* Driver confirmation */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Driver confirmation</h3>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="driver-confirm" className="font-normal">Require driver confirmation on assign</Label>
            <p className="text-xs text-muted-foreground">
              Driver must explicitly accept before the order is marked as started
            </p>
          </div>
          <Switch
            id="driver-confirm"
            checked={settings.requireDriverConfirmation}
            onCheckedChange={(v) => update("requireDriverConfirmation", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="notify-assign" className="font-normal">Notify driver on assignment</Label>
            <p className="text-xs text-muted-foreground">
              Send a push notification to the driver when an order is assigned
            </p>
          </div>
          <Switch
            id="notify-assign"
            checked={settings.notifyDriverOnAssign}
            onCheckedChange={(v) => update("notifyDriverOnAssign", v)}
          />
        </div>
      </section>

      {/* SLA */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">SLA target</h3>
          <p className="text-sm text-muted-foreground">
            Flag orders that exceed a target delivery time. Overdue orders are highlighted in the dispatch view.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="sla-enabled" className="font-normal">Enable SLA tracking</Label>
          <Switch id="sla-enabled" checked={settings.slaEnabled} onCheckedChange={(v) => update("slaEnabled", v)} />
        </div>

        {settings.slaEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label htmlFor="sla-hours">Target delivery time (hours)</Label>
            <Input
              id="sla-hours"
              type="number"
              min={1}
              max={72}
              value={settings.slaHours}
              onChange={(e) => update("slaHours", Number(e.target.value))}
              className="w-28"
            />
            <p className="text-xs text-muted-foreground">Orders older than this threshold are flagged as overdue</p>
          </div>
        )}
      </section>

      {/* Grace period & auto-reassign */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Grace period &amp; auto-reassign</h3>
          <p className="text-sm text-muted-foreground">
            If a driver does not accept an order within the grace period, unassign and reassign automatically.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="auto-reassign" className="font-normal">Enable auto-reassign</Label>
          <Switch id="auto-reassign" checked={settings.autoReassignEnabled} onCheckedChange={(v) => update("autoReassignEnabled", v)} />
        </div>

        {settings.autoReassignEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label htmlFor="grace-minutes">Grace period (minutes)</Label>
            <Input
              id="grace-minutes"
              type="number"
              min={1}
              max={60}
              value={settings.graceMinutes}
              onChange={(e) => update("graceMinutes", Number(e.target.value))}
              className="w-28"
            />
            <p className="text-xs text-muted-foreground">Order is unassigned after this many minutes without driver acceptance</p>
          </div>
        )}
      </section>

      <div className="pt-2">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Dispatch Settings"}
        </Button>
      </div>
    </div>
  )
}
