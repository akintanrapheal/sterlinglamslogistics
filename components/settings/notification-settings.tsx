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

interface NotificationSettings {
  etaEmail: boolean
  etaWhatsapp: boolean
  etaSms: boolean
  etaTrigger: string
  allowEditDeliveryInstructions: boolean
  proactiveDelayAlerts: boolean
  delayAlertThresholdMinutes: number
  deliveryReceiptEmail: boolean
  deliveryFeedbackEmail: boolean
  failedDeliveryEnabled: boolean
  failedDeliveryMessage: string
}

const DEFAULT: NotificationSettings = {
  etaEmail: true,
  etaWhatsapp: true,
  etaSms: false,
  etaTrigger: "out_for_delivery",
  allowEditDeliveryInstructions: false,
  proactiveDelayAlerts: false,
  delayAlertThresholdMinutes: 30,
  deliveryReceiptEmail: true,
  deliveryFeedbackEmail: true,
  failedDeliveryEnabled: false,
  failedDeliveryMessage: "Hi {customerName}, we were unable to deliver your order #{orderNumber}. Please contact us to reschedule.",
}

const SETTINGS_DOC = "customerNotification"

export function NotificationSettingsPanel() {
  const [notif, setNotif] = useState<NotificationSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", SETTINGS_DOC))
        if (snap.exists()) {
          setNotif({ ...DEFAULT, ...snap.data() } as NotificationSettings)
        }
      } catch (err) {
        console.error("Failed to load notification settings:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, "settings", SETTINGS_DOC), notif)
      logActivity({ action: "settings.updated", details: { section: "notification" } })
      toast({ title: "Saved", description: "Customer notification settings updated." })
    } catch (err) {
      console.error("Failed to save notification settings:", err)
      toast({ title: "Error", description: "Failed to save settings. Try again.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setNotif((prev) => ({ ...prev, [key]: value }))
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
      <h2 className="text-xl font-semibold">Customer notification</h2>

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Customer ETA sharing</h3>
          <p className="text-sm text-muted-foreground">
            Turning on customer tracking will send customers a real time delivery tracking
            page with live ETA by mins. It will also show the driver name, profile picture
            and phone number to call or text the driver
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="eta-email" className="font-normal">Email</Label>
          <Switch id="eta-email" checked={notif.etaEmail} onCheckedChange={(v) => update("etaEmail", v)} />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="eta-whatsapp" className="font-normal">WhatsApp</Label>
          <Switch id="eta-whatsapp" checked={notif.etaWhatsapp} onCheckedChange={(v) => update("etaWhatsapp", v)} />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="eta-sms" className="font-normal">SMS</Label>
          <Switch id="eta-sms" checked={notif.etaSms} onCheckedChange={(v) => update("etaSms", v)} />
        </div>

        <div className="space-y-2">
          <Label>Send tracking notification as soon as</Label>
          <Select value={notif.etaTrigger} onValueChange={(v) => update("etaTrigger", v)}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order_accepted">Order is accepted</SelectItem>
              <SelectItem value="out_for_delivery">Order is on the way</SelectItem>
              <SelectItem value="picked_up">Order is picked up</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch id="edit-instructions" checked={notif.allowEditDeliveryInstructions} onCheckedChange={(v) => update("allowEditDeliveryInstructions", v)} />
          <div>
            <Label htmlFor="edit-instructions" className="font-semibold cursor-pointer">
              Allow Editing Delivery Instructions on Tracking Link
            </Label>
            <p className="text-sm text-muted-foreground">
              Allow Customers to change delivery instructions directly from the tracking link
            </p>
          </div>
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch id="delay-alerts" checked={notif.proactiveDelayAlerts} onCheckedChange={(v) => update("proactiveDelayAlerts", v)} />
          <div>
            <Label htmlFor="delay-alerts" className="font-semibold cursor-pointer">
              Proactive Delay Alerts
            </Label>
            <p className="text-sm text-muted-foreground">
              Automatically notify customers if an order is running late via SMS notification
            </p>
          </div>
        </div>
        {notif.proactiveDelayAlerts && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label htmlFor="delay-threshold">Alert when order is past ETA by (minutes)</Label>
            <Input
              id="delay-threshold"
              type="number"
              min={5}
              max={240}
              value={notif.delayAlertThresholdMinutes}
              onChange={(e) => update("delayAlertThresholdMinutes", Number(e.target.value))}
              className="w-28"
            />
          </div>
        )}
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Delivery receipt</h3>
          <p className="text-sm text-muted-foreground">
            This will send a notification to the customer with delivery details and proof
            of delivery after the delivery is complete
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="receipt-email" className="font-normal">Email</Label>
          <Switch id="receipt-email" checked={notif.deliveryReceiptEmail} onCheckedChange={(v) => update("deliveryReceiptEmail", v)} />
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Delivery feedback</h3>
          <p className="text-sm text-muted-foreground">
            This will send a reminder notification within 24 hours to share feedback/rating
            of their delivery service
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="feedback-email" className="font-normal">Email</Label>
          <Switch id="feedback-email" checked={notif.deliveryFeedbackEmail} onCheckedChange={(v) => update("deliveryFeedbackEmail", v)} />
        </div>
      </section>

      <hr className="border-border" />

      {/* Failed delivery notification */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Failed delivery notification</h3>
          <p className="text-sm text-muted-foreground">
            Send a message to the customer when their order is marked as Failed, with a reschedule prompt.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="failed-delivery" checked={notif.failedDeliveryEnabled} onCheckedChange={(v) => update("failedDeliveryEnabled", v)} />
          <Label htmlFor="failed-delivery" className="cursor-pointer font-normal">Enable failed delivery notification</Label>
        </div>
        {notif.failedDeliveryEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label htmlFor="failed-msg">Message (variables: {`{customerName} {orderNumber}`})</Label>
            <textarea
              id="failed-msg"
              rows={3}
              value={notif.failedDeliveryMessage}
              onChange={(e) => update("failedDeliveryMessage", e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>
        )}
      </section>

      <div className="pt-4">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Notification Settings"}
        </Button>
      </div>
    </div>
  )
}
