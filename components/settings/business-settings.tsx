"use client"

import { useEffect, useState, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Save, Loader2, Pencil, Store, Package } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { logActivity } from "@/lib/activity-client"
import { db } from "@/lib/firebase"
import { toast } from "@/hooks/use-toast"
import Image from "next/image"

const DAYS = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
] as const

type DayKey = typeof DAYS[number]["key"]
interface DayHours { open: boolean; from: string; to: string }

interface BusinessSettings {
  businessName: string
  businessLogoUrl: string
  businessType: "merchant" | "delivery_company"
  merchantPhone: string
  merchantAddress: string
  timezone: string
  currency: string
  currencySymbol: string
  whatsappLink: string
  instagramLink: string
  websiteUrl: string
  operatingHours: Record<DayKey, DayHours>
}

const DEFAULT_HOURS = Object.fromEntries(
  DAYS.map(({ key }) => [key, { open: key !== "sunday", from: "09:00", to: "18:00" }])
) as Record<DayKey, DayHours>

const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  businessName: "Sterlinglams",
  businessLogoUrl: "/placeholder-logo.png",
  businessType: "merchant",
  merchantPhone: "+234 9160009893",
  merchantAddress: "Sterlinglams – Ikota Ajah Lagos",
  timezone: "Africa/Lagos",
  currency: "NGN",
  currencySymbol: "₦",
  whatsappLink: "",
  instagramLink: "",
  websiteUrl: "",
  operatingHours: DEFAULT_HOURS,
}

const BUSINESS_SETTINGS_DOC = "businessSettings"

export function BusinessSettingsPanel() {
  const [biz, setBiz] = useState<BusinessSettings>(DEFAULT_BUSINESS_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", BUSINESS_SETTINGS_DOC))
        if (snap.exists()) {
          setBiz({ ...DEFAULT_BUSINESS_SETTINGS, ...snap.data() } as BusinessSettings)
        }
      } catch (err) {
        console.error("Failed to load business settings:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, "settings", BUSINESS_SETTINGS_DOC), biz)
      logActivity({ action: "settings.updated", details: { section: "business" } })
      toast({ title: "Saved", description: "Business settings updated." })
      setEditingName(false)
    } catch (err) {
      console.error("Failed to save business settings:", err)
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setBiz((prev) => ({ ...prev, [key]: value }))
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Error", description: "Logo must be under 2MB.", variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      update("businessLogoUrl", reader.result as string)
    }
    reader.readAsDataURL(file)
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
      <h2 className="text-xl font-semibold">Business settings</h2>

      <section className="space-y-6">
        <div>
          <h3 className="text-base font-semibold">Business details</h3>
          <p className="text-sm text-muted-foreground">Set your business details</p>
        </div>

        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Business name</p>
            {editingName ? (
              <Input
                value={biz.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false) }}
                className="max-w-xs"
                autoFocus
              />
            ) : (
              <p className="text-base">{biz.businessName}</p>
            )}
          </div>
          <button
            onClick={() => setEditingName(!editingName)}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit business name"
          >
            <Pencil className="size-4" />
          </button>
        </div>

        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Business logo</p>
            <div className="relative size-16 rounded-lg border border-border overflow-hidden bg-muted">
              <Image src={biz.businessLogoUrl} alt="Business logo" fill className="object-contain" />
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
          </div>
          <button
            onClick={() => logoInputRef.current?.click()}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit business logo"
          >
            <Pencil className="size-4" />
          </button>
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-6">
        <div>
          <h3 className="text-base font-semibold">Business type details</h3>
          <p className="text-sm text-muted-foreground">Set your business type details</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Business type</p>
          <p className="text-sm text-muted-foreground">
            If you are a delivery only business like Pizza shop where pick up is always from
            the same place, please choose the business type delivery only. Otherwise keep it
            pick up and delivery.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => update("businessType", "merchant")}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border-2 px-6 py-4 text-sm font-medium transition-colors",
                biz.businessType === "merchant"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              )}
            >
              <Store className="size-6" />
              Merchant
            </button>
            <button
              onClick={() => update("businessType", "delivery_company")}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border-2 px-6 py-4 text-sm font-medium transition-colors",
                biz.businessType === "delivery_company"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              )}
            >
              <Package className="size-6" />
              Delivery company
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="merchant-phone">Merchant phone number</Label>
          <Input
            id="merchant-phone"
            type="tel"
            value={biz.merchantPhone}
            onChange={(e) => update("merchantPhone", e.target.value)}
            className="max-w-sm"
            placeholder="+234 9160009893"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="merchant-address">Merchant store address</Label>
          <Input
            id="merchant-address"
            value={biz.merchantAddress}
            onChange={(e) => update("merchantAddress", e.target.value)}
            className="max-w-sm"
            placeholder="Your store address"
          />
        </div>
      </section>

      <hr className="border-border" />

      {/* Regional settings */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Regional settings</h3>
          <p className="text-sm text-muted-foreground">Timezone and currency used across the platform</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={biz.timezone} onValueChange={(v) => update("timezone", v)}>
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Africa/Lagos">Africa/Lagos (WAT)</SelectItem>
                <SelectItem value="Africa/Accra">Africa/Accra (GMT)</SelectItem>
                <SelectItem value="Africa/Nairobi">Africa/Nairobi (EAT)</SelectItem>
                <SelectItem value="Europe/London">Europe/London (GMT/BST)</SelectItem>
                <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Select value={biz.currency} onValueChange={(v) => {
              const symbols: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", KES: "KSh", GHS: "₵" }
              update("currency", v)
              update("currencySymbol", symbols[v] ?? v)
            }}>
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NGN">NGN — Nigerian Naira (₦)</SelectItem>
                <SelectItem value="USD">USD — US Dollar ($)</SelectItem>
                <SelectItem value="GBP">GBP — British Pound (£)</SelectItem>
                <SelectItem value="EUR">EUR — Euro (€)</SelectItem>
                <SelectItem value="KES">KES — Kenyan Shilling (KSh)</SelectItem>
                <SelectItem value="GHS">GHS — Ghanaian Cedi (₵)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* Social links */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Social &amp; contact links</h3>
          <p className="text-sm text-muted-foreground">Shown on the customer-facing tracking page</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="whatsapp">WhatsApp Business link</Label>
            <Input id="whatsapp" placeholder="https://wa.me/2349160009893" value={biz.whatsappLink} onChange={(e) => update("whatsappLink", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="instagram">Instagram URL</Label>
            <Input id="instagram" placeholder="https://instagram.com/yourhandle" value={biz.instagramLink} onChange={(e) => update("instagramLink", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="website">Website URL</Label>
            <Input id="website" placeholder="https://yourbusiness.com" value={biz.websiteUrl} onChange={(e) => update("websiteUrl", e.target.value)} />
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* Operating hours */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Operating hours</h3>
          <p className="text-sm text-muted-foreground">Days and hours your business accepts orders</p>
        </div>
        <div className="space-y-3">
          {DAYS.map(({ key, label }) => {
            const hours = biz.operatingHours[key] ?? { open: false, from: "09:00", to: "18:00" }
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-9 shrink-0 text-sm font-medium text-muted-foreground">{label}</span>
                <input
                  type="checkbox"
                  id={`day-${key}`}
                  checked={hours.open}
                  onChange={(e) => update("operatingHours", { ...biz.operatingHours, [key]: { ...hours, open: e.target.checked } })}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {hours.open ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="time"
                      value={hours.from}
                      onChange={(e) => update("operatingHours", { ...biz.operatingHours, [key]: { ...hours, from: e.target.value } })}
                      className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">–</span>
                    <input
                      type="time"
                      value={hours.to}
                      onChange={(e) => update("operatingHours", { ...biz.operatingHours, [key]: { ...hours, to: e.target.value } })}
                      className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <div className="pt-4">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Business Settings"}
        </Button>
      </div>
    </div>
  )
}
