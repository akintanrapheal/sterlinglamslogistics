"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Save, Loader2, MapPin } from "lucide-react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { logActivity } from "@/lib/activity-client"
import { db } from "@/lib/firebase"
import { toast } from "@/hooks/use-toast"

interface LocationSettings {
  hubName: string
  hubAddress: string
  hubLat: string
  hubLng: string
  serviceAreaEnabled: boolean
  serviceAreaRadiusKm: number
  geofencingEnabled: boolean
}

const DEFAULT: LocationSettings = {
  hubName: "Main Hub",
  hubAddress: "",
  hubLat: "",
  hubLng: "",
  serviceAreaEnabled: false,
  serviceAreaRadiusKm: 30,
  geofencingEnabled: false,
}

const SETTINGS_DOC = "locationSettings"

export function LocationSettingsPanel() {
  const [settings, setSettings] = useState<LocationSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", SETTINGS_DOC))
        if (snap.exists()) {
          setSettings({ ...DEFAULT, ...snap.data() } as LocationSettings)
        }
      } catch (err) {
        console.error("Failed to load location settings:", err)
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
      logActivity({ action: "settings.updated", details: { section: "location" } })
      toast({ title: "Saved", description: "Location settings updated." })
    } catch (err) {
      console.error("Failed to save location settings:", err)
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof LocationSettings>(key: K, value: LocationSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  async function geocodeAddress() {
    if (!settings.hubAddress.trim()) {
      toast({ title: "No address", description: "Enter a hub address first.", variant: "destructive" })
      return
    }
    setGeocoding(true)
    try {
      const { loadGoogleMaps } = await import("@/lib/google-maps")
      await loadGoogleMaps()
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode({ address: settings.hubAddress }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location
          setSettings((prev) => ({ ...prev, hubLat: loc.lat().toFixed(6), hubLng: loc.lng().toFixed(6) }))
          toast({ title: "Coordinates found", description: `${loc.lat().toFixed(6)}, ${loc.lng().toFixed(6)}` })
        } else {
          toast({ title: "Not found", description: "Could not geocode that address. Try a more specific address.", variant: "destructive" })
        }
        setGeocoding(false)
      })
    } catch {
      toast({ title: "Error", description: "Geocoding failed. Check your Maps API key.", variant: "destructive" })
      setGeocoding(false)
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
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold">Location</h2>
        <p className="text-sm text-muted-foreground">
          Configure your hub address, service area, and geofencing
        </p>
      </div>

      {/* Hub */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Delivery hub</h3>
          <p className="text-sm text-muted-foreground">
            The hub is used as the origin for route optimization and distance calculations.
            Coordinates override the address for precision.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hub-name">Hub name</Label>
          <Input
            id="hub-name"
            placeholder="Main Hub"
            value={settings.hubName}
            onChange={(e) => update("hubName", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="hub-address">Hub address</Label>
          <div className="flex gap-2">
            <Input
              id="hub-address"
              placeholder="123 Warehouse St, Lagos"
              value={settings.hubAddress}
              onChange={(e) => update("hubAddress", e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={geocodeAddress}
              disabled={geocoding || !settings.hubAddress.trim()}
              className="shrink-0"
            >
              {geocoding ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
              {geocoding ? "Looking up..." : "Look up coords"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="hub-lat">Latitude</Label>
            <Input
              id="hub-lat"
              placeholder="6.4643"
              value={settings.hubLat}
              onChange={(e) => update("hubLat", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hub-lng">Longitude</Label>
            <Input
              id="hub-lng"
              placeholder="3.5555"
              value={settings.hubLng}
              onChange={(e) => update("hubLng", e.target.value)}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Tip: set <code className="font-mono">NEXT_PUBLIC_HUB_LAT</code> and{" "}
          <code className="font-mono">NEXT_PUBLIC_HUB_LNG</code> in your Vercel environment
          variables for the build-time default.
        </p>
      </section>

      {/* Service area */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Service area</h3>
          <p className="text-sm text-muted-foreground">
            Restrict orders to within a certain radius of the hub
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="service-area" className="font-normal">Enable service area restriction</Label>
          <Switch
            id="service-area"
            checked={settings.serviceAreaEnabled}
            onCheckedChange={(v) => update("serviceAreaEnabled", v)}
          />
        </div>

        {settings.serviceAreaEnabled && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <Label htmlFor="radius">Service radius (km)</Label>
            <Input
              id="radius"
              type="number"
              min={1}
              max={500}
              value={settings.serviceAreaRadiusKm}
              onChange={(e) => update("serviceAreaRadiusKm", Number(e.target.value))}
              className="w-28"
            />
          </div>
        )}
      </section>

      {/* Geofencing */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Geofencing</h3>
          <p className="text-sm text-muted-foreground">
            Automatically trigger delivery events when a driver enters or exits a delivery zone
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="geofencing" className="font-normal">Enable geofencing</Label>
            <p className="text-xs text-muted-foreground">
              Requires Google Maps API and driver location sharing to be active
            </p>
          </div>
          <Switch
            id="geofencing"
            checked={settings.geofencingEnabled}
            onCheckedChange={(v) => update("geofencingEnabled", v)}
          />
        </div>
      </section>

      <div className="pt-2">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Location Settings"}
        </Button>
      </div>
    </div>
  )
}
