"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Loader2, Copy, Check, Eye, EyeOff, RefreshCw, MapPin, AlertTriangle } from "lucide-react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { db, auth } from "@/lib/firebase"
import { resetGoogleMapsLoader } from "@/lib/google-maps"
import { toast } from "@/hooks/use-toast"

/**
 * Only non-secret configuration belongs here. Webhook and payment *secrets* are
 * read from environment variables by the server routes that use them — they were
 * previously stored in this Firestore document, which no code ever read back and
 * which was world-readable, so they have been removed entirely.
 */
interface IntegrationSettings {
  woocommerceWebhookUrl: string
  paystackPublicKey: string
  apiKey: string
  googleMapsKey: string
}

const DEFAULT: IntegrationSettings = {
  woocommerceWebhookUrl: "",
  paystackPublicKey: "",
  apiKey: "",
  googleMapsKey: "",
}

/** Picks only known fields off the stored document. Anything else — including
 *  the legacy `woocommerceSecret` / `paystackSecretKey` values — is dropped, so
 *  the next save strips them from Firestore. */
function fromStored(data: Record<string, unknown>): IntegrationSettings {
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  return {
    woocommerceWebhookUrl: str(data.woocommerceWebhookUrl),
    paystackPublicKey: str(data.paystackPublicKey),
    apiKey: str(data.apiKey),
    googleMapsKey: str(data.googleMapsKey),
  }
}

type MapsTestResult = { ok: boolean; status: string; message: string }

const SETTINGS_DOC = "integrationSettings"

function generateApiKey(): string {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return "slk_" + Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function MaskedInput({ value, onChange, placeholder, id }: { value: string; onChange: (v: string) => void; placeholder?: string; id: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative flex items-center">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export function IntegrationsSettingsPanel() {
  const [settings, setSettings] = useState<IntegrationSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [testingMaps, setTestingMaps] = useState(false)
  const [mapsTest, setMapsTest] = useState<MapsTestResult | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", SETTINGS_DOC))
        if (snap.exists()) {
          setSettings(fromStored(snap.data() as Record<string, unknown>))
        }
      } catch (err) {
        console.error("Failed to load integration settings:", err)
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
      // Force the next map load to pick up a changed key.
      resetGoogleMapsLoader()
      toast({
        title: "Saved",
        description:
          "Integration settings updated. Reload any open map pages for a new Google Maps key to take effect.",
      })
    } catch (err) {
      console.error("Failed to save integration settings:", err)
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  /** Asks the server to call Google with this key and report the real status,
   *  so a broken key is diagnosed here instead of as a grey map. */
  async function testMapsKey() {
    setTestingMaps(true)
    setMapsTest(null)
    try {
      const token = await auth?.currentUser?.getIdToken()
      const res = await fetch("/api/admin/test-maps-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ key: settings.googleMapsKey.trim() }),
      })
      const data = (await res.json()) as MapsTestResult
      setMapsTest(data)
    } catch (err) {
      console.error("Maps key test failed:", err)
      setMapsTest({
        ok: false,
        status: "NETWORK_ERROR",
        message: "Could not reach the server to run the test.",
      })
    } finally {
      setTestingMaps(false)
    }
  }

  function update<K extends keyof IntegrationSettings>(key: K, value: IntegrationSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  function regenerateApiKey() {
    const key = generateApiKey()
    update("apiKey", key)
    toast({ title: "New key generated", description: "Save settings to persist the new API key." })
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
        <h2 className="text-xl font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect external services — Google Maps, WooCommerce, Paystack, and your public API key
        </p>
      </div>

      {/* Google Maps */}
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <MapPin className="size-4" />
            Google Maps
          </h3>
          <p className="text-sm text-muted-foreground">
            Powers the dispatch map, driver map, route optimisation, and address geocoding.
            Saving a key here overrides the deployed environment variable — no redeploy needed.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="google-maps-key">API key</Label>
          <div className="flex gap-2">
            <div className="flex-1">
              <MaskedInput
                id="google-maps-key"
                value={settings.googleMapsKey}
                onChange={(v) => {
                  update("googleMapsKey", v)
                  setMapsTest(null)
                }}
                placeholder="AIzaSy... (leave blank to use the deployed env key)"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={testMapsKey}
              disabled={testingMaps}
              className="shrink-0"
            >
              {testingMaps ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {testingMaps ? "Testing..." : "Test key"}
            </Button>
          </div>

          {mapsTest && (
            <div
              role="status"
              className={`flex gap-2 rounded-md border p-3 text-xs ${
                mapsTest.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
              }`}
            >
              {mapsTest.ok ? (
                <Check className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="space-y-1">
                <p className="font-semibold">
                  {mapsTest.ok ? "Key is working" : `Failed — ${mapsTest.status}`}
                </p>
                <p className="opacity-90">{mapsTest.message}</p>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Test the key before saving. Restrict it to an HTTP referrer
            (<code className="font-mono">sterlinglamslogistics.com/*</code>) in Google Cloud —
            this key is visible to anyone who loads a map, so an unrestricted key can be
            used by others at your expense.
          </p>
        </div>
      </section>

      <hr className="border-border" />

      {/* API key */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">API key</h3>
          <p className="text-sm text-muted-foreground">
            A generated token for future external API access
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key">API key</Label>
          <div className="flex gap-2">
            <div className="relative flex flex-1 items-center">
              <Input
                id="api-key"
                readOnly
                value={settings.apiKey || "No key generated yet"}
                className="font-mono text-xs pr-10 bg-secondary/40"
              />
              {settings.apiKey && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(settings.apiKey, "apiKey")}
                  className="absolute right-3 text-muted-foreground hover:text-foreground"
                  aria-label="Copy API key"
                >
                  {copiedField === "apiKey" ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                </button>
              )}
            </div>
            <Button type="button" variant="outline" onClick={regenerateApiKey} className="shrink-0">
              <RefreshCw className="mr-1.5 size-4" />
              {settings.apiKey ? "Regenerate" : "Generate"}
            </Button>
          </div>
          {settings.apiKey && (
            <p className="text-xs text-amber-600">
              Not yet enforced — no API route currently validates this key, so generating
              or regenerating it grants and revokes nothing. Treat it as a placeholder
              until request authentication is wired up.
            </p>
          )}
        </div>
      </section>

      <hr className="border-border" />

      {/* WooCommerce */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">WooCommerce</h3>
          <p className="text-sm text-muted-foreground">
            Configure the webhook so WooCommerce pushes new orders directly into the platform
          </p>
        </div>

        <div className="space-y-2">
          <Label>Webhook URL (paste into WooCommerce → Settings → Advanced → Webhooks)</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={typeof window !== "undefined" ? `${window.location.origin}/api/woocommerce/webhook` : "/api/woocommerce/webhook"}
              className="font-mono text-xs bg-secondary/40 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => copyToClipboard(typeof window !== "undefined" ? `${window.location.origin}/api/woocommerce/webhook` : "/api/woocommerce/webhook", "webhookUrl")}
              className="shrink-0"
            >
              {copiedField === "webhookUrl" ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Webhook secret</Label>
          <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            Set as the{" "}
            <code className="font-mono text-foreground">WOOCOMMERCE_WEBHOOK_SECRET</code>{" "}
            environment variable, not here — it must match WooCommerce → Webhooks → Secret.
            Secrets are kept out of Firestore because this settings document is
            readable by every signed-in admin and is not an appropriate store for
            credentials.
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wc-webhook">WooCommerce REST API base URL (optional)</Label>
          <Input
            id="wc-webhook"
            value={settings.woocommerceWebhookUrl}
            onChange={(e) => update("woocommerceWebhookUrl", e.target.value)}
            placeholder="https://your-store.com/wp-json/wc/v3"
          />
        </div>
      </section>

      <hr className="border-border" />

      {/* Paystack */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Paystack</h3>
          <p className="text-sm text-muted-foreground">
            Used to verify payment status on orders before dispatching
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="paystack-public">Public key</Label>
          <Input
            id="paystack-public"
            value={settings.paystackPublicKey}
            onChange={(e) => update("paystackPublicKey", e.target.value)}
            placeholder="pk_live_..."
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label>Secret key</Label>
          <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            Set as a <code className="font-mono text-foreground">PAYSTACK_SECRET_KEY</code>{" "}
            environment variable, not here. Only the public key belongs in this form.
          </div>
        </div>
      </section>

      <div className="pt-2">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {saving ? "Saving..." : "Save Integration Settings"}
        </Button>
      </div>
    </div>
  )
}
