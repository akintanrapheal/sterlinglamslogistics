"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { applyTheme, getStoredTheme, setStoredTheme, type DriverTheme } from "@/lib/driver-theme"
import { hapticTap } from "@/lib/native-bridge"

const options: { value: DriverTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System Default" },
]

export default function DriverDisplaySettingsPage() {
  const router = useRouter()
  const [theme, setTheme] = useState<DriverTheme>("system")

  useEffect(() => {
    setTheme(getStoredTheme())
  }, [])

  function selectTheme(value: DriverTheme) {
    void hapticTap()
    setTheme(value)
    // Persisting and applying now live in lib/driver-theme so the layout can
    // reapply the choice at startup — this screen used to do both inline,
    // which is why the theme reset every time the app was reopened.
    setStoredTheme(value)
    applyTheme(value)
  }

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
        <h1 className="text-lg font-bold">Display</h1>
      </div>

      <div className="space-y-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => selectTheme(opt.value)}
            className={cn(
              "flex w-full items-center justify-between rounded-xl px-4 py-4 text-sm font-medium transition-colors",
              theme === opt.value ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <span>{opt.label}</span>
            {theme === opt.value && (
              <Check className="h-5 w-5 text-green-600" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
