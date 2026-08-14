"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Star,
  Eye,
  Power,
  Edit,
  Key,
  Trash2,
  MoreHorizontal,
  Phone,
  MapPin,
  Mail,
  X,
  Loader2,
  Search,
  Plus,
  Smartphone,
  EyeOff,
  Download,
  AlertTriangle,
  Users,
  CheckCircle2,
  Clock,
  WifiOff,
  Zap,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts"
import { subscribeDriversRealtime, subscribeOrdersRealtime } from "@/lib/firestore"
import { toast } from "@/hooks/use-toast"
import type { Driver, Order } from "@/lib/data"
import { DRIVER_STATUS, ORDER_STATUS } from "@/lib/constants"
import { auth } from "@/lib/firebase"
import { format, subWeeks, startOfWeek, formatDistanceToNow, isToday } from "date-fns"

// constants
const DRIVER_STATUSES = [
  { value: DRIVER_STATUS.AVAILABLE, label: "Available" },
  { value: DRIVER_STATUS.ON_DELIVERY, label: "On Delivery" },
  { value: DRIVER_STATUS.OFFLINE, label: "Offline" },
] as const

// helpers
function toMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  if (typeof value === "object" && "seconds" in (value as object))
    return (value as { seconds: number }).seconds * 1000
  return new Date(value as string).getTime() || 0
}

function timeAgo(value: unknown): string {
  const ms = toMs(value)
  if (!ms) return "never"
  try { return formatDistanceToNow(new Date(ms), { addSuffix: true }) }
  catch { return "unknown" }
}

function ordersForDriver(orders: Order[], driverId: string) {
  return orders.filter((o) => o.assignedDriver === driverId)
}

function deliveredOrders(driverOrders: Order[]) {
  return driverOrders.filter((o) => o.status === ORDER_STATUS.DELIVERED)
}

function avgRating(driverOrders: Order[]): number | null {
  const rated = driverOrders.filter((o) => o.customerRating != null)
  if (!rated.length) return null
  return rated.reduce((s, o) => s + (o.customerRating ?? 0), 0) / rated.length
}

function avgDeliveryMin(driverOrders: Order[]): number | null {
  const valid = driverOrders.filter(
    (o) => o.status === ORDER_STATUS.DELIVERED && toMs(o.deliveredAt) > 0 && toMs(o.createdAt) > 0
  )
  if (!valid.length) return null
  const total = valid.reduce((s, o) => s + (toMs(o.deliveredAt) - toMs(o.createdAt)), 0)
  return Math.round(total / valid.length / 60000)
}

function weeklyDeliveries(driverOrders: Order[]): { week: string; count: number }[] {
  const weeks = Array.from({ length: 8 }, (_, i) => subWeeks(new Date(), 7 - i))
  return weeks.map((weekStart) => {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 }).getTime()
    const end = start + 7 * 24 * 60 * 60 * 1000
    const count = driverOrders.filter((o) => {
      const t = toMs(o.deliveredAt)
      return o.status === ORDER_STATUS.DELIVERED && t >= start && t < end
    }).length
    return { week: format(weekStart, "MMM d"), count }
  })
}

function exportDriversCSV(drivers: Driver[], orders: Order[]) {
  const header = ["Name", "Phone", "Email", "Area", "Vehicle", "Status", "Rating", "Total Deliveries", "Success Rate %"]
  const rows = drivers.map((d) => {
    const dOrders = ordersForDriver(orders, d.id)
    const delivered = deliveredOrders(dOrders).length
    const total = dOrders.length
    const successRate = total > 0 ? ((delivered / total) * 100).toFixed(1) : "0"
    return [d.name, d.phone, d.email ?? "", d.area ?? "", d.vehicle, d.status, d.rating, delivered, successRate].join(",")
  })
  const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `drivers-${format(new Date(), "yyyy-MM-dd")}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// sub-components
function DriverStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    [DRIVER_STATUS.AVAILABLE]: "bg-success/15 text-success border-success/20",
    [DRIVER_STATUS.ON_DELIVERY]: "bg-warning/15 text-warning border-warning/20",
    [DRIVER_STATUS.OFFLINE]: "bg-muted-foreground/15 text-muted-foreground border-muted-foreground/20",
  }
  const labels: Record<string, string> = {
    [DRIVER_STATUS.AVAILABLE]: "Available",
    [DRIVER_STATUS.ON_DELIVERY]: "On Delivery",
    [DRIVER_STATUS.OFFLINE]: "Offline",
  }
  return <Badge variant="outline" className={variants[status] ?? ""}>{labels[status] ?? status}</Badge>
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className={`flex size-10 items-center justify-center rounded-lg ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  )
}

// form schemas
const driverFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  area: z.string().optional(),
  vehicle: z.string().min(1, "Vehicle is required"),
  status: z.enum([DRIVER_STATUS.AVAILABLE, DRIVER_STATUS.ON_DELIVERY, DRIVER_STATUS.OFFLINE]),
  note: z.string().optional(),
})

const newDriverFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone number is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(4, "Password must be at least 4 characters"),
  note: z.string().optional(),
})

type DriverFormData = z.infer<typeof driverFormSchema>
type NewDriverFormData = z.infer<typeof newDriverFormSchema>

// main page
export default function DriversPage() {
  const [allDrivers, setAllDrivers] = useState<Driver[]>([])
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false)
  const [newDriverOpen, setNewDriverOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "on-delivery" | "offline">("all")
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    const unsubDrivers = subscribeDriversRealtime((drivers) => setAllDrivers(drivers))
    const unsubOrders = subscribeOrdersRealtime((orders) => setAllOrders(orders))
    return () => { unsubDrivers(); unsubOrders() }
  }, [])

  async function getAdminHeaders(): Promise<Record<string, string>> {
    const token = await auth.currentUser?.getIdToken()
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  const editForm = useForm<DriverFormData>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: { name: "", phone: "", email: "", area: "", vehicle: "", status: DRIVER_STATUS.AVAILABLE, note: "" },
  })
  const resetForm = useForm({ defaultValues: { password: "" } })
  const newDriverForm = useForm<NewDriverFormData>({
    resolver: zodResolver(newDriverFormSchema),
    defaultValues: { name: "", phone: "+234", email: "", password: "", note: "" },
  })

  const filteredDrivers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return allDrivers.filter((d) => {
      const matchesSearch = !q || d.name.toLowerCase().includes(q) || d.phone.toLowerCase().includes(q) || (d.email?.toLowerCase().includes(q) ?? false) || d.vehicle.toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || d.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [allDrivers, searchTerm, statusFilter])

  const availableCount = allDrivers.filter((d) => d.status === DRIVER_STATUS.AVAILABLE).length
  const onDeliveryCount = allDrivers.filter((d) => d.status === DRIVER_STATUS.ON_DELIVERY).length
  const offlineCount = allDrivers.filter((d) => d.status === DRIVER_STATUS.OFFLINE).length
  const fleetAvgRating = allDrivers.length > 0
    ? (allDrivers.reduce((s, d) => s + (d.rating ?? 0), 0) / allDrivers.length).toFixed(1)
    : "0"

  const todayOrders = useMemo(() => allOrders.filter((o) => {
    const ms = toMs(o.createdAt)
    return ms > 0 && isToday(new Date(ms))
  }), [allOrders])

  function driverTodayCount(driverId: string) {
    return todayOrders.filter((o) => o.assignedDriver === driverId && o.status === ORDER_STATUS.DELIVERED).length
  }

  function driverCurrentOrder(driverId: string): Order | null {
    return allOrders.find((o) => o.assignedDriver === driverId && (o.status === ORDER_STATUS.STARTED || o.status === ORDER_STATUS.PICKED_UP || o.status === ORDER_STATUS.IN_TRANSIT)) ?? null
  }

  function driverAvgRating(driverId: string): number | null {
    return avgRating(ordersForDriver(allOrders, driverId))
  }

  function isLowRating(driverId: string): boolean {
    const r = driverAvgRating(driverId)
    return r !== null && r < 3.5
  }

  function isInactive(driverId: string): boolean {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = allOrders.filter((o) => o.assignedDriver === driverId && o.status === ORDER_STATUS.DELIVERED && toMs(o.deliveredAt) > sevenDaysAgo)
    return recent.length === 0
  }

  function driverActiveOrders(driverId: string): number {
    return allOrders.filter((o) => o.assignedDriver === driverId && ["started", "picked-up", "in-transit", "unassigned"].includes(o.status)).length
  }

  function driverPerfScore(driverId: string): number {
    const dOrders = ordersForDriver(allOrders, driverId)
    const total = dOrders.length
    if (!total) return 0
    const delivered = deliveredOrders(dOrders).length
    const successPct = delivered / total

    const validTimes = dOrders.filter((o) => o.status === ORDER_STATUS.DELIVERED && toMs(o.deliveredAt) > 0 && toMs(o.createdAt) > 0)
    const avgMin = validTimes.length ? validTimes.reduce((s, o) => s + (toMs(o.deliveredAt) - toMs(o.createdAt)), 0) / validTimes.length / 60000 : null
    const speedScore = avgMin ? Math.max(0, Math.min(1, (120 - avgMin) / 120)) : 0

    const rated = dOrders.filter((o) => o.customerRating != null)
    const ratingScore = rated.length ? rated.reduce((s, o) => s + (o.customerRating ?? 0), 0) / rated.length / 5 : 0

    return Math.round(successPct * 40 + speedScore * 30 + ratingScore * 30)
  }

  const allSelected = filteredDrivers.length > 0 && filteredDrivers.every((d) => selectedIds.includes(d.id))
  const someSelected = selectedIds.length > 0

  function toggleSelect(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }
  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? filteredDrivers.map((d) => d.id) : [])
  }

  async function handleBulkSetStatus(targetStatus: "available" | "offline") {
    const targets = allDrivers.filter((d) => selectedIds.includes(d.id))
    if (!targets.length) return
    setIsLoading(true)
    try {
      await Promise.all(targets.map((d) =>
        fetch("/api/admin/drivers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: targetStatus === "offline" ? "set_offline" : "update", driverId: d.id, payload: { status: targetStatus } }),
        })
      ))
      setSelectedIds([])
      toast({ title: `${targets.length} driver(s) set to ${targetStatus}` })
    } catch {
      toast({ title: "Error", description: "Bulk update failed", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  function openProfile(driver: Driver) { setSelectedDriver(driver); setProfileOpen(true) }
  function openEdit(driver: Driver) {
    setSelectedDriver(driver)
    editForm.reset({ name: driver.name, phone: driver.phone, email: driver.email || "", area: driver.area || "", vehicle: driver.vehicle, status: driver.status, note: driver.note || "" })
    setEditOpen(true)
  }
  function openDeleteDialog(driver: Driver) { setSelectedDriver(driver); setDeleteOpen(true) }
  function openResetPassword(driver: Driver) { setSelectedDriver(driver); resetForm.reset({ password: "" }); setResetPasswordOpen(true) }

  async function handleQuickToggle(driver: Driver) {
    const newStatus = driver.status === DRIVER_STATUS.OFFLINE ? DRIVER_STATUS.AVAILABLE : DRIVER_STATUS.OFFLINE
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: await getAdminHeaders(),
        body: JSON.stringify({ action: newStatus === "offline" ? "set_offline" : "update", driverId: driver.id, payload: { status: newStatus } }),
      })
      if (!res.ok) throw new Error()
      toast({ title: `${driver.name} set to ${newStatus}` })
    } catch {
      toast({ title: "Error", description: "Status update failed", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  async function handleEndShift(driver: Driver) {
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/drivers", { method: "POST", headers: await getAdminHeaders(), body: JSON.stringify({ action: "set_offline", driverId: driver.id }) })
      if (!res.ok) throw new Error()
      toast({ title: "Shift ended", description: `${driver.name} set to offline.` })
    } catch {
      toast({ title: "Error", description: "Failed to end shift.", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  async function handleEditSubmit(data: DriverFormData) {
    if (!selectedDriver) return
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/drivers", { method: "POST", headers: await getAdminHeaders(), body: JSON.stringify({ action: "update", driverId: selectedDriver.id, payload: data }) })
      if (!res.ok) throw new Error()
      setEditOpen(false)
      toast({ title: "Driver updated", description: `${data.name}'s details have been updated.` })
    } catch {
      toast({ title: "Error", description: "Failed to update driver.", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  async function handleResetPassword(data: { password: string }) {
    if (!selectedDriver) return
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/drivers", { method: "POST", headers: await getAdminHeaders(), body: JSON.stringify({ action: "reset_password", driverId: selectedDriver.id, payload: { password: data.password } }) })
      if (!res.ok) throw new Error()
      setResetPasswordOpen(false)
      toast({ title: "Password reset", description: `${selectedDriver.name}'s password has been reset.` })
    } catch {
      toast({ title: "Error", description: "Failed to reset password.", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  async function handleDelete() {
    if (!selectedDriver) return
    setIsLoading(true)
    try {
      const res = await fetch("/api/admin/drivers", { method: "POST", headers: await getAdminHeaders(), body: JSON.stringify({ action: "delete", driverId: selectedDriver.id }) })
      if (!res.ok) throw new Error()
      setDeleteOpen(false)
      toast({ title: "Driver deleted", description: `${selectedDriver.name} has been permanently deleted.` })
    } catch {
      toast({ title: "Error", description: "Failed to delete driver.", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  async function handleNewDriverSubmit(data: NewDriverFormData) {
    setIsLoading(true)
    try {
      const newDriver: Omit<Driver, "id"> = { name: data.name, phone: data.phone, email: data.email, vehicle: "", status: DRIVER_STATUS.AVAILABLE, rating: 5.0, password: data.password, note: data.note ?? "" }
      const res = await fetch("/api/admin/drivers", { method: "POST", headers: await getAdminHeaders(), body: JSON.stringify({ action: "create", payload: newDriver }) })
      if (!res.ok) throw new Error()
      setNewDriverOpen(false)
      newDriverForm.reset({ name: "", phone: "+234", email: "", password: "", note: "" })
      setShowNewPassword(false)
      toast({ title: "Driver added", description: `${data.name} has been added successfully.` })
    } catch {
      toast({ title: "Error", description: "Failed to add driver.", variant: "destructive" })
    } finally { setIsLoading(false) }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Drivers</h1>
        <p className="mt-1 text-sm text-muted-foreground">View and manage your delivery fleet in real time</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={<Users className="size-5 text-primary" />} label="Total Drivers" value={allDrivers.length} color="bg-primary/10" />
        <StatCard icon={<CheckCircle2 className="size-5 text-success" />} label="Available" value={availableCount} color="bg-success/10" />
        <StatCard icon={<Zap className="size-5 text-warning" />} label="On Delivery" value={onDeliveryCount} color="bg-warning/10" />
        <StatCard icon={<WifiOff className="size-5 text-muted-foreground" />} label="Offline" value={offlineCount} color="bg-muted" />
        <StatCard icon={<Star className="size-5 fill-warning text-warning" />} label="Fleet Avg Rating" value={fleetAvgRating} color="bg-warning/10" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, vehicle…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearchTerm("")}
            className="pl-9 pr-8"
          />
          {searchTerm && (
            <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearchTerm("")}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {(["all", "available", "on-delivery", "offline"] as const).map((s) => {
            const count = s === "all" ? allDrivers.length : allDrivers.filter((d) => d.status === s).length
            return (
              <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                {s === "all" ? "All" : s === "on-delivery" ? "On Delivery" : s.charAt(0).toUpperCase() + s.slice(1)}
                <span className="ml-1 opacity-70">({count})</span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {someSelected && (
            <>
              <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleBulkSetStatus("available")} disabled={isLoading}>Set Available</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleBulkSetStatus("offline")} disabled={isLoading}>End Shift</Button>
            </>
          )}
          <Button variant="outline" className="gap-2 h-9" onClick={() => exportDriversCSV(filteredDrivers, allOrders)}>
            <Download className="h-4 w-4" />Export
          </Button>
          <Button variant="outline" className="gap-2 h-9" onClick={() => window.open("/driver", "_blank")}>
            <Smartphone className="h-4 w-4" />Get the app
          </Button>
          <Button className="gap-2 h-9 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => { newDriverForm.reset({ name: "", phone: "+234", email: "", password: "", note: "" }); setShowNewPassword(false); setNewDriverOpen(true) }}>
            <Plus className="h-4 w-4" />New Driver
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 px-2">
                <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={(c) => toggleSelectAll(c === true)} />
              </TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Vehicle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead className="hidden sm:table-cell">Last Seen</TableHead>
              <TableHead className="w-20">Today</TableHead>
              <TableHead className="w-12" />
              <TableHead className="pr-8">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDrivers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-sm text-muted-foreground">No drivers match your search.</TableCell>
              </TableRow>
            ) : (
              filteredDrivers.map((driver) => {
                const lowRating = isLowRating(driver.id)
                const currentOrder = driverCurrentOrder(driver.id)
                const todayCount = driverTodayCount(driver.id)
                const inactive = isInactive(driver.id)
                const activeOrders = driverActiveOrders(driver.id)
                const perfScore = driverPerfScore(driver.id)
                return (
                  <TableRow key={driver.id} className={selectedIds.includes(driver.id) ? "bg-muted/40" : ""}>
                    <TableCell className="px-2">
                      <Checkbox checked={selectedIds.includes(driver.id)} onCheckedChange={() => toggleSelect(driver.id)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {driver.name.split(" ").map((n) => n[0]).join("")}
                          {driver.status === DRIVER_STATUS.AVAILABLE && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-success" />}
                          {driver.status === DRIVER_STATUS.ON_DELIVERY && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-warning" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground">{driver.name}</span>
                            {lowRating && <AlertTriangle className="size-3.5 text-warning" aria-label="Low avg rating" />}
                            {inactive && <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-400/40 text-amber-600">Inactive</Badge>}
                          </div>
                          {driver.area && <p className="text-[11px] text-muted-foreground">{driver.area}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{driver.phone}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{driver.vehicle}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <DriverStatusBadge status={driver.status} />
                        {currentOrder && <span className="text-[10px] text-muted-foreground">#{currentOrder.orderNumber}</span>}
                        {/* capacity bar */}
                        <div className="flex items-center gap-1">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                            <div className={`h-full rounded-full ${activeOrders >= 4 ? "bg-destructive" : activeOrders >= 2 ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(100, (activeOrders / 5) * 100)}%` }} />
                          </div>
                          <span className="text-[9px] text-muted-foreground">{activeOrders}/5</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Star className="size-3.5 fill-warning text-warning" />
                        <span className="text-sm font-medium text-foreground">{driver.rating}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{timeAgo(driver.lastPingAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold text-foreground">{todayCount}</span>
                        <span className="text-[10px] text-muted-foreground">del.</span>
                        {perfScore > 0 && (
                          <Badge variant="outline" className={`h-4 px-1 text-[9px] w-fit ${perfScore >= 70 ? "border-success/40 text-success" : perfScore >= 40 ? "border-warning/40 text-warning" : "border-destructive/40 text-destructive"}`}>
                            {perfScore}pts
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-1">
                      <button
                        title={driver.status === DRIVER_STATUS.OFFLINE ? "Set Available" : "End Shift"}
                        disabled={isLoading}
                        onClick={() => handleQuickToggle(driver)}
                        className={`flex size-7 items-center justify-center rounded-md border transition-colors ${driver.status === DRIVER_STATUS.OFFLINE ? "border-success/30 text-success hover:bg-success/10" : "border-muted-foreground/20 text-muted-foreground hover:bg-muted"}`}
                      >
                        <Power className="size-3.5" />
                      </button>
                    </TableCell>
                    <TableCell className="pr-8">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openProfile(driver)}>
                            <Eye className="mr-2 h-4 w-4" /> View profile
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEndShift(driver)} disabled={isLoading}>
                            <Power className="mr-2 h-4 w-4" /> End shift
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(driver)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openResetPassword(driver)}>
                            <Key className="mr-2 h-4 w-4" /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(driver)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedDriver?.name ?? "Driver profile"}</DialogTitle>
          </DialogHeader>
          {selectedDriver && (
            <ProfileBody driver={selectedDriver} orders={ordersForDriver(allOrders, selectedDriver.id)} />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>Edit Driver</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+234 801 234 5678" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="john@example.com" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="area" render={({ field }) => (<FormItem><FormLabel>Area</FormLabel><FormControl><Input placeholder="Lagos, Nigeria" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="vehicle" render={({ field }) => (<FormItem><FormLabel>Vehicle</FormLabel><FormControl><Input placeholder="Toyota Hilux - LG 234 AK" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={editForm.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                    <SelectContent>{DRIVER_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="note" render={({ field }) => (<FormItem><FormLabel>Note</FormLabel><FormControl><Textarea placeholder="Any special notes..." {...field} /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isLoading}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Changes</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>Reset Password</DialogTitle></DialogHeader>
          <form onSubmit={resetForm.handleSubmit(handleResetPassword)} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <Input type="password" placeholder="Enter new password" {...resetForm.register("password", { required: "Password is required" })} />
              {resetForm.formState.errors.password && <p className="text-sm text-destructive">{resetForm.formState.errors.password.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetPasswordOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reset Password</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Driver</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to permanently delete <strong>{selectedDriver?.name}</strong>? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Driver Dialog */}
      <Dialog open={newDriverOpen} onOpenChange={setNewDriverOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>Add a new driver</DialogTitle></DialogHeader>
          <Form {...newDriverForm}>
            <form onSubmit={newDriverForm.handleSubmit(handleNewDriverSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={newDriverForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={newDriverForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Phone No <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="+234" {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={newDriverForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email <span className="text-destructive">*</span></FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={newDriverForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Temporary password <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input type={showNewPassword ? "text" : "password"} {...field} />
                      <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNewPassword((v) => !v)}>
                        {showNewPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={newDriverForm.control} name="note" render={({ field }) => (<FormItem><FormLabel>Note</FormLabel><FormControl><Textarea className="min-h-[80px]" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setNewDriverOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isLoading} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Profile body component
function ProfileBody({ driver, orders }: { driver: Driver; orders: Order[] }) {
  function toMsLocal(value: unknown): number {
    if (!value) return 0
    if (value instanceof Date) return value.getTime()
    if (typeof value === "number") return value
    if (typeof value === "object" && "seconds" in (value as object))
      return (value as { seconds: number }).seconds * 1000
    return new Date(value as string).getTime() || 0
  }

  const delivered = deliveredOrders(orders)
  const failed = orders.filter((o) => o.status === ORDER_STATUS.FAILED)
  const total = orders.length
  const successRate = total > 0 ? ((delivered.length / total) * 100).toFixed(1) : "0"
  const rating = avgRating(orders)
  const avgMin = avgDeliveryMin(orders)
  const chartData = weeklyDeliveries(orders)
  const reviews = orders.filter((o) => o.customerRating != null).sort((a, b) => toMsLocal(b.deliveredAt) - toMsLocal(a.deliveredAt)).slice(0, 20)

  return (
    <div className="flex max-h-[80vh] overflow-hidden">
      <div className="w-52 shrink-0 border-r p-5 overflow-y-auto">
        <div className="flex flex-col items-center gap-3">
          <Avatar className="h-20 w-20">
            <AvatarFallback className="text-lg">{driver.name.split(" ").map((n) => n[0]).join("")}</AvatarFallback>
          </Avatar>
          <div className="text-center">
            <h2 className="text-base font-semibold">{driver.name}</h2>
            <div className="flex items-center justify-center gap-1 mt-0.5">
              <Star className="size-3.5 fill-warning text-warning" />
              <span className="text-sm">{driver.rating}</span>
            </div>
            <Badge className="mt-2" variant="outline">{driver.status}</Badge>
          </div>
          <div className="space-y-1.5 self-start text-sm">
            {driver.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="size-3.5" />{driver.phone}</div>}
            {driver.area && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3.5" />{driver.area}</div>}
            {driver.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="size-3.5" />{driver.email}</div>}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <Tabs defaultValue="stats">
          <TabsList>
            <TabsTrigger value="stats">Performance</TabsTrigger>
            <TabsTrigger value="reviews">
              Reviews
              {reviews.length > 0 && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{reviews.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="bio">Bio</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="mt-4 space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{delivered.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Delivered</p>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{failed.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Failed</p>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{successRate}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">Success Rate</p>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                {rating !== null ? (
                  <>
                    <div className="flex items-center justify-center gap-1">
                      <Star className="size-4 fill-warning text-warning" />
                      <p className="text-2xl font-bold text-foreground">{rating.toFixed(1)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Avg Rating</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Avg Rating</p>
                  </>
                )}
              </div>
            </div>

            {avgMin !== null && (
              <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3">
                <Clock className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Avg delivery time:</span>
                <span className="font-semibold text-foreground">{avgMin} min</span>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Weekly deliveries (last 8 weeks)</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="count" name="Deliveries" className="fill-primary" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Payout calculator */}
            {(() => {
              let rate = 0
              try { rate = parseFloat(localStorage.getItem("earningsPerKmRate") ?? "0") || 0 } catch {}
              const totalKm = orders.filter((o) => o.status === ORDER_STATUS.DELIVERED && (o.distanceKm ?? 0) > 0).reduce((s, o) => s + (o.distanceKm ?? 0), 0)
              if (!rate && !totalKm) return null
              const payout = (totalKm * rate)
              return (
                <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Estimated Payout</p>
                    <p className="text-xs text-muted-foreground">{totalKm.toFixed(1)} km × ₦{rate.toFixed(2)}/km</p>
                  </div>
                  <p className="text-xl font-bold text-foreground">₦{payout.toFixed(2)}</p>
                </div>
              )
            })()}
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No customer reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {reviews.map((o) => (
                  <div key={o.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`size-3.5 ${i < (o.customerRating ?? 0) ? "fill-warning text-warning" : "text-muted-foreground/30"}`} />
                        ))}
                        <span className="ml-1 text-xs font-medium text-foreground">{o.customerRating}/5</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {o.deliveredAt ? format(new Date(toMsLocal(o.deliveredAt)), "MMM d, yyyy") : ""}
                      </span>
                    </div>
                    {o.customerFeedback && <p className="mt-1.5 text-sm text-foreground">{o.customerFeedback}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground">Order #{o.orderNumber} · {o.customerName}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="bio" className="mt-4 space-y-4">
            <div className="rounded-lg border p-4">
              <h3 className="mb-2 font-semibold text-sm">Personal Information</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="font-medium text-muted-foreground text-xs">Full name</p><p>{driver.name}</p></div>
                <div><p className="font-medium text-muted-foreground text-xs">Phone</p><p>{driver.phone}</p></div>
                {driver.email && <div><p className="font-medium text-muted-foreground text-xs">Email</p><p>{driver.email}</p></div>}
                {driver.area && <div><p className="font-medium text-muted-foreground text-xs">Area</p><p>{driver.area}</p></div>}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <h3 className="mb-2 font-semibold text-sm">Vehicle details</h3>
              <p className="text-sm">{driver.vehicle || "—"}</p>
            </div>
            {driver.note && (
              <div className="rounded-lg border p-4">
                <h3 className="mb-2 font-semibold text-sm">Driver note</h3>
                <p className="text-sm">{driver.note}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
