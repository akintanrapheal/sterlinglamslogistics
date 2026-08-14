"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  ImageIcon,
  Loader2,
  Pen,
  Trash2,
  X,
} from "lucide-react"
import type { Order } from "@/lib/data"
import { toast } from "@/hooks/use-toast"
import { useDriver } from "@/components/driver-context"
import { driverFetch } from "@/lib/driver-client"
import { queueDelivery } from "@/lib/delivery-queue"
import { hapticTap, hapticSuccess, hapticError } from "@/lib/native-bridge"

const MAX_PHOTO_PX = 800
const PHOTO_QUALITY = 0.6

function compressPhoto(video: HTMLVideoElement): string {
  const ratio = Math.min(MAX_PHOTO_PX / video.videoWidth, MAX_PHOTO_PX / video.videoHeight, 1)
  const w = Math.round(video.videoWidth * ratio)
  const h = Math.round(video.videoHeight * ratio)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h)
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY)
}

export default function DeliveryCompletionPage() {
  // Read the id from ?id=… (works in both the dynamic /delivery/[id]
  // web route and the static-export driver-mobile-2 build where
  // dynamic segments can't be pre-rendered).
  const searchParams = useSearchParams()
  const orderId = searchParams.get("id") ?? ""
  const router = useRouter()
  const { session, liveGps } = useDriver()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState("")
  const [signerName, setSignerName] = useState("")
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  // Drawing state lives in refs, not React state: pointermove fires far faster
  // than React can re-render, and a stale `isDrawing` drops the first strokes.
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  // Midpoint the previous smoothed segment ended on — the next one starts
  // there, which is what keeps the stroke unbroken.
  const prevMidRef = useRef<{ x: number; y: number } | null>(null)
  const sigWrapRef = useRef<HTMLDivElement>(null)
  const sigShellRef = useRef<HTMLDivElement>(null)
  // Mirrored into state only so the Save button can enable/disable.
  const hasStrokeRef = useRef(false)
  const [hasStroke, setHasStroke] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    driverFetch(`/api/driver/orders/${encodeURIComponent(orderId)}`, {})
      .then((r) => r.json())
      .then((d: { ok: boolean; order?: Order }) => {
        setOrder(d.order ?? null)
        setLoading(false)
      })
  }, [orderId])

  // Always stop the camera stream when the component unmounts
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // ── Signature drawing ────────────────────────────────────────────────────────

  const STROKE_WIDTH = 2.6
  const STROKE_COLOR = "#111827"

  /** Apply stroke style to a fresh context (state is lost on every resize). */
  function styleCtx(ctx: CanvasRenderingContext2D) {
    ctx.lineWidth = STROKE_WIDTH
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = STROKE_COLOR
    ctx.fillStyle = STROKE_COLOR
  }

  /**
   * Size the canvas bitmap to its real on-screen box times devicePixelRatio.
   *
   * The pad previously hard-coded width={350} height={200} while CSS stretched
   * it to the container width, so canvas coordinates and getBoundingClientRect
   * coordinates disagreed — strokes drifted from the fingertip and the result
   * was upscaled and blurry. Sizing the bitmap to the box keeps 1 canvas unit
   * == 1 CSS px, so the offsets below need no scale factor.
   *
   * Any existing drawing is re-drawn afterwards, so rotating the device or
   * entering fullscreen doesn't wipe a half-finished signature.
   */
  function resizeSignatureCanvas() {
    const canvas = canvasRef.current
    const wrap = sigWrapRef.current
    if (!canvas || !wrap) return
    const { width, height } = wrap.getBoundingClientRect()
    if (width < 1 || height < 1) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const nextW = Math.round(width * dpr)
    const nextH = Math.round(height * dpr)
    if (canvas.width === nextW && canvas.height === nextH) return

    // Snapshot before resizing — setting width/height clears the bitmap.
    const previous = hasStrokeRef.current ? canvas.toDataURL("image/png") : null
    canvas.width = nextW
    canvas.height = nextH
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(dpr, dpr)
    styleCtx(ctx)
    if (previous) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, width, height)
      img.src = previous
    }
  }

  // Size the canvas once the pad is on screen, and again on rotate/resize.
  useEffect(() => {
    if (!showSignaturePad) return
    // Two frames: one for the modal to mount, one for layout to settle after
    // the fullscreen transition, which changes the box underneath us.
    const raf = requestAnimationFrame(() => requestAnimationFrame(resizeSignatureCanvas))
    window.addEventListener("resize", resizeSignatureCanvas)
    window.addEventListener("orientationchange", resizeSignatureCanvas)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resizeSignatureCanvas)
      window.removeEventListener("orientationchange", resizeSignatureCanvas)
    }
  }, [showSignaturePad])

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    // Capture keeps strokes alive if the finger slides past the canvas edge.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not fatal */ }
    drawingRef.current = true
    const p = pointFrom(e)
    lastPointRef.current = p
    // First segment curves out of the touch-down point itself.
    prevMidRef.current = p

    // A tap with no movement is a legitimate signature mark (dotting an "i",
    // a full stop). The old code only did beginPath/moveTo here and stroked
    // solely on move, so a plain tap left nothing behind. Lay down a dot.
    styleCtx(ctx)
    ctx.beginPath()
    ctx.arc(p.x, p.y, STROKE_WIDTH / 2, 0, Math.PI * 2)
    ctx.fill()

    if (!hasStrokeRef.current) {
      hasStrokeRef.current = true
      setHasStroke(true)
    }
  }

  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return

    // Android batches samples between frames during a fast stroke and reports
    // only the newest on the event. Replaying the coalesced ones keeps quick
    // signatures curved instead of faceted; browsers without the API just
    // yield the single event.
    const rect = e.currentTarget.getBoundingClientRect()
    const samples =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : []
    const points = (samples.length > 0 ? samples : [e.nativeEvent]).map((s) => ({
      x: s.clientX - rect.left,
      y: s.clientY - rect.top,
    }))

    for (const p of points) {
      const last = lastPointRef.current
      const prevMid = prevMidRef.current
      if (!last || !prevMid) break

      // Midpoint smoothing: each segment runs from the previous midpoint to
      // the current one, with the raw sample as the quadratic's control
      // point. The curve therefore starts exactly where the last one ended,
      // so the stroke stays continuous while still being smoothed.
      //
      // Drawing last -> mid instead (and then advancing last to p) leaves the
      // mid -> p half of every segment unpainted, which is what rendered the
      // signature as a dashed line.
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }
      ctx.beginPath()
      ctx.moveTo(prevMid.x, prevMid.y)
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y)
      ctx.stroke()

      prevMidRef.current = mid
      lastPointRef.current = p
    }
  }

  function endDraw(e?: React.PointerEvent<HTMLCanvasElement>) {
    if (e) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
    }
    // Smoothing always stops a half-segment short of the final sample, so
    // without this the tail of every stroke is clipped.
    const ctx = canvasRef.current?.getContext("2d")
    const last = lastPointRef.current
    const prevMid = prevMidRef.current
    if (drawingRef.current && ctx && last && prevMid) {
      ctx.beginPath()
      ctx.moveTo(prevMid.x, prevMid.y)
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    }
    drawingRef.current = false
    lastPointRef.current = null
    prevMidRef.current = null
  }

  function clearSignature() {
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      // Reset in device pixels, ignoring the DPR transform on the context.
      ctx?.save()
      ctx?.setTransform(1, 0, 0, 1, 0, 0)
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      ctx?.restore()
    }
    hasStrokeRef.current = false
    setHasStroke(false)
    setSignatureData(null)
  }

  function saveSignature() {
    const canvas = canvasRef.current
    if (!canvas || !hasStrokeRef.current) return
    setSignatureData(canvas.toDataURL("image/png"))
    closeSignaturePad()
    hapticSuccess()
    toast({ title: "Signature captured" })
  }

  /**
   * Open the pad and try to give it the whole screen. Both calls are
   * best-effort: the Fullscreen API rejects unless it's driven by a user
   * gesture (it is, here) and orientation.lock is unsupported on desktop and
   * on iOS Safari. A rejection just means the customer signs in the normal
   * modal, so nothing is gated on either promise.
   */
  async function openSignaturePad() {
    hapticTap()
    setShowSignaturePad(true)
    try {
      // documentElement, not sigShellRef — the pad hasn't rendered yet at this
      // point, so the ref is still null. The pad is `fixed inset-0` anyway, so
      // fullscreening the document fills the screen with it either way.
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.()
    } catch { /* stay windowed */ }
    try {
      await (screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>
      })?.lock?.("landscape")
    } catch { /* portrait is fine */ }
  }

  function closeSignaturePad() {
    setShowSignaturePad(false)
    try { (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.() } catch { /* no-op */ }
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => { /* no-op */ })
  }

  // Leaving fullscreen via the hardware back button / system gesture should
  // close the pad too, otherwise it's stranded mid-screen with no way out.
  useEffect(() => {
    if (!showSignaturePad) return
    function onFsChange() {
      if (!document.fullscreenElement) setShowSignaturePad(false)
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [showSignaturePad])

  // ── Camera ───────────────────────────────────────────────────────────────────

  async function openCamera() {
    setShowCamera(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      const isDenied = err instanceof DOMException && err.name === "NotAllowedError"
      toast({
        title: isDenied ? "Camera access denied" : "Camera error",
        description: isDenied
          ? "Go to Settings → App Permissions → Camera and enable it."
          : "Could not access camera. Try again.",
        variant: "destructive",
      })
      setShowCamera(false)
    }
  }

  function capturePhoto() {
    if (!videoRef.current) return
    setPhotoData(compressPhoto(videoRef.current))
    closeCamera()
    toast({ title: "Photo captured" })
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setShowCamera(false)
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleCompleteDelivery() {
    if (!order || !session) return
    void hapticTap("medium")
    setSubmitting(true)

    const payload = {
      driverId: session.id,
      status: "delivered" as const,
      ...(photoData ? { photoData } : {}),
      ...(signatureData ? { signatureData } : {}),
      ...(notes.trim() ? { deliveryNote: notes.trim() } : {}),
      ...(signerName.trim() ? { signerName: signerName.trim() } : {}),
      ...(liveGps ? { deliveryLat: liveGps.lat, deliveryLng: liveGps.lng } : {}),
    }

    try {
      const res = await driverFetch(`/api/driver/orders/${encodeURIComponent(order.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Failed to complete delivery")
      }

      void hapticSuccess()
      toast({ title: "Delivery completed!", description: `${order.orderNumber} marked as delivered.` })
      router.push("/driver/dashboard")
    } catch (err) {
      // Network failure — queue for automatic retry when connectivity returns
      const isNetworkError = !navigator.onLine || (err instanceof TypeError)
      if (isNetworkError) {
        queueDelivery({
          id: `${order.id}_${Date.now()}`,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          driverId: session.id,
          photoData: photoData ?? null,
          signatureData: signatureData ?? null,
          deliveryNotes: notes.trim(), // PendingDelivery interface uses deliveryNotes
          capturedAt: Date.now(),
          // Keep parity with the online payload above. These were previously
          // dropped on the offline path, losing the signer and the delivery
          // location for any confirmation made without a connection.
          signerName: signerName.trim() || null,
          deliveryLat: liveGps?.lat ?? null,
          deliveryLng: liveGps?.lng ?? null,
        })
        void hapticSuccess()
        toast({
          title: "Saved offline",
          description: `${order.orderNumber} will be submitted automatically when you reconnect.`,
        })
        router.push("/driver/dashboard")
      } else {
        void hapticError()
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to complete delivery.",
          variant: "destructive",
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Order not found</p>
        <Button onClick={() => router.push("/driver/dashboard")}>Go Back</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/driver/dashboard")}
          className="rounded-lg p-1.5 hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-center text-base font-bold">Proof of Delivery (POD)</h1>
        <div className="w-9" />
      </div>

      {/* Scrollable body — leaves room for the fixed-bottom Complete button */}
      <div className="flex-1 overflow-y-auto px-4 pb-32 pt-4">
        {/* Photo preview / tap-to-take-photo placeholder */}
        <button
          type="button"
          onClick={openCamera}
          className="mb-4 block h-56 w-full overflow-hidden rounded-xl border border-border bg-muted/30 transition-opacity hover:opacity-90 active:opacity-80"
        >
          {photoData ? (
            <img src={photoData} alt="Delivery proof" className="h-full w-full object-cover" />
          ) : (
            <div className="relative flex h-full w-full items-center justify-center bg-gray-50">
              <ImageIcon className="h-16 w-16 text-gray-300" />
              <span className="absolute right-7 top-3 text-2xl font-light text-gray-300">+</span>
            </div>
          )}
        </button>

        {/* Signature preview (only when captured) */}
        {signatureData && (
          <div className="mb-3 overflow-hidden rounded-xl border border-green-200 bg-green-50">
            <img src={signatureData} alt="Customer signature" className="h-20 w-full object-contain bg-white" />
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs font-semibold text-green-600">Signature captured</span>
              </div>
              <button
                type="button"
                onClick={() => setSignatureData(null)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                title="Clear signature"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Add image + Add signature outline buttons */}
        <div className="mb-6 flex gap-3">
          <button
            type="button"
            onClick={openCamera}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-white py-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Camera className="h-4 w-4" />
            {photoData ? "Retake Photo" : "Add Image"}
          </button>
          <button
            type="button"
            onClick={openSignaturePad}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full border py-3 text-sm font-medium ${
              signatureData
                ? "border-green-600 text-green-600 hover:bg-green-50"
                : "border-border text-foreground hover:bg-muted"
            }`}
          >
            <Pen className="h-4 w-4" />
            {signatureData ? "✓ Signature" : "Add Signature"}
          </button>
        </div>

        {/* Note section */}
        <h3 className="mb-2.5 text-base font-bold">Write a Note for Future Reference</h3>
        <input
          type="text"
          placeholder="Name of the person signed (Required)"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          className="mb-3 w-full rounded-xl border bg-muted/40 px-4 py-3.5 text-sm placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-green-500/30"
        />
        <Textarea
          placeholder="Enter Your Note"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="rounded-xl border bg-muted/40 px-4 py-3 text-sm placeholder:text-muted-foreground focus:bg-background"
        />
      </div>

      {/* Bottom-anchored Complete button */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
      >
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={handleCompleteDelivery}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 py-4 text-base font-bold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Complete the Order"}
          </button>
        </div>
      </div>

      {/* Camera Modal */}
      {showCamera && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between p-4">
            <h2 className="font-semibold text-white">Take Photo</h2>
            <Button variant="ghost" size="sm" onClick={closeCamera} className="text-white hover:text-white">
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex flex-1 items-center justify-center">
            <video ref={videoRef} autoPlay playsInline className="max-h-full max-w-full" />
          </div>
          <div className="flex justify-center p-6">
            <Button onClick={capturePhoto} className="h-16 w-16 rounded-full bg-white hover:bg-gray-200">
              <Camera className="h-8 w-8 text-black" />
            </Button>
          </div>
        </div>
      )}

      {/* Signature Pad Modal */}
      {showSignaturePad && (
        <div
          ref={sigShellRef}
          className="fixed inset-0 z-50 flex flex-col bg-background"
          // Keep clear of notches/gesture bars once we're truly fullscreen.
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="font-semibold leading-tight">Customer Signature</h2>
              <p className="text-xs text-muted-foreground">
                {order?.customerName ? `Handing to ${order.customerName}` : "Ask the customer to sign"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={closeSignaturePad} aria-label="Close signature pad">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* The wrapper is the measured box; the canvas fills it exactly so
              resizeSignatureCanvas can match the bitmap to it 1:1. */}
          <div ref={sigWrapRef} className="relative m-3 flex-1 overflow-hidden rounded-xl border-2 border-dashed bg-white">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              // Deliberately no onPointerLeave: setPointerCapture already
              // guarantees pointerup reaches us, and ending on leave would cut
              // strokes short exactly when the signature runs near the edge.
            />
            {!hasStroke && (
              // pointer-events-none so tapping the hint still starts a stroke.
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Pen className="h-7 w-7 opacity-40" />
                <span className="text-sm">Sign here with your finger</span>
              </div>
            )}
            {hasStroke && (
              <div className="pointer-events-none absolute bottom-3 left-0 right-0 mx-auto h-px w-4/5 bg-muted-foreground/25" />
            )}
          </div>

          <div className="flex shrink-0 gap-3 px-4 pb-4 pt-1">
            <Button variant="outline" className="flex-1" onClick={clearSignature} disabled={!hasStroke}>
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
            <Button className="flex-1" onClick={saveSignature} disabled={!hasStroke}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Save Signature
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
