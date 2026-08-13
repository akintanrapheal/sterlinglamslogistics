"use client"

import { useState, useEffect, useRef } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Plus, Edit, MoreHorizontal, Printer, Trash2, Send, UserPlus, MapPin, FileText, Barcode, Ban, UserPlus2, ArrowUpDown, ArrowUp, ArrowDown, Search, Upload, Download, Star, Clock, Copy, CheckCircle2, XCircle, ChevronLeft, ChevronRight, MessageCircle, Flame, StickyNote } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { subscribeOrdersRealtime, subscribeDriversRealtime, fetchDriversByStatus, updateOrder, createOrder, deleteOrder } from "@/lib/firestore"
import { formatCurrency } from "@/lib/data"
import type { Order, Driver } from "@/lib/data"
import { toast } from "@/hooks/use-toast"
import { notifyOrderEvent } from "@/lib/notify-client"
import { logActivity } from "@/lib/activity-client"
import { loadGoogleMaps } from "@/lib/google-maps"
import { StatusBadge } from "@/components/orders/status-badge"
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog"
import { ReassignDialog } from "@/components/orders/reassign-dialog"
import { BulkAssignDialog } from "@/components/orders/bulk-assign-dialog"
import { formatOrderTime, formatDistance, handlePrintOrder, handlePrintLabel } from "@/lib/order-utils"
import { ORDER_STATUS, DRIVER_STATUS, ACTIVE_STATUSES, TERMINAL_STATUSES } from "@/lib/constants"
import { useAuth } from "@/components/auth-provider"

type OrderTab = "current" | "completed" | "incomplete" | "history"

const UNASSIGNED_DRIVER = "unassigned" as const

const orderFormSchema = z.object({
  orderNumber: z.string().min(1, "Order number is required"),
  pickupName: z.string().min(1, "Pickup name is required"),
  pickupPhone: z.string().min(1, "Pickup phone is required"),
  pickupAddress: z.string().min(1, "Pickup address is required"),
  pickupTime: z.string().min(1, "Pickup time is required"),
  customerName: z.string().min(1, "Customer name is required"),
  phone: z.string().min(1, "Phone number is required"),
  customerEmail: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("")),
  address: z.string().min(1, "Address is required"),
  deliveryDate: z.string().min(1, "Delivery date is required"),
  deliveryTime: z.string().min(1, "Delivery time is required"),
  items: z.array(z.object({
    name: z.string(),
    price: z.number(),
    qty: z.number(),
    meta: z.string().optional(),
  })).optional(),
  taxRate: z.number().optional(),
  deliveryFees: z.number().optional(),
  deliveryTips: z.number().optional(),
  discount: z.number().optional(),
  deliveryInstruction: z.string().optional(),
  paymentMethod: z.string().optional(),
  assignedDriver: z.string().optional(),
})

type OrderFormData = z.infer<typeof orderFormSchema>

export default function OrdersPage() {
  const [orderList, setOrderList] = useState<Order[]>([])
  const [availableDrivers, setAvailableDrivers] = useState<Driver[]>([])
  const [allDrivers, setAllDrivers] = useState<Driver[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [activeTab, setActiveTab] = useState<OrderTab>("current")
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false)
  const [bulkDriverId, setBulkDriverId] = useState<string>(UNASSIGNED_DRIVER)
  const [reassignOrderId, setReassignOrderId] = useState<string | null>(null)
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null)

  // New filter/pagination state
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [driverFilter, setDriverFilter] = useState<string>("all")
  const [paymentFilter, setPaymentFilter] = useState<string>("all")
  const [dateFromFilter, setDateFromFilter] = useState("")
  const [dateToFilter, setDateToFilter] = useState("")
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  const { role } = useAuth()
  const isAdminOrOwner = role === "admin" || role === "owner"

  // Search / filter state
  const [searchQuery, setSearchQuery] = useState("")
  const [historyDateFrom, setHistoryDateFrom] = useState("")
  const [historyDateTo, setHistoryDateTo] = useState("")
  const [historySearchField, setHistorySearchField] = useState("orderNumber")
  const [historyKeyword, setHistoryKeyword] = useState("")
  const [historyResults, setHistoryResults] = useState<Order[] | null>(null)
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ display_name: string; lat: string; lon: string; placeId?: string }>>([])
  const [addressSearching, setAddressSearching] = useState(false)
  const [addressPreviewCoord, setAddressPreviewCoord] = useState<{ lat: number; lng: number } | null>(null)
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null)
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null)
  const placesContainerRef = useRef<HTMLDivElement | null>(null)

  const form = useForm<OrderFormData>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      orderNumber: "",
      pickupName: "Sterlin Glams",
      pickupPhone: "+234 9160009893",
      pickupAddress: "Sterlin Glams – Ikota Ajah Lagos",
      pickupTime: "",
      customerName: "",
      phone: "",
      customerEmail: "",
      address: "",
      deliveryDate: new Date().toISOString().split("T")[0],
      deliveryTime: "",
      items: [{ name: "", price: 0, qty: 1, meta: "" }],
      taxRate: 0,
      deliveryFees: 0,
      deliveryTips: 0,
      discount: 0,
      deliveryInstruction: "",
      paymentMethod: "",
      assignedDriver: "",
    },
  })

  useEffect(() => {
    setIsLoading(true)

    const unsubOrders = subscribeOrdersRealtime((data) => {
      setOrderList(data)
      setIsLoading(false)
      setError(null)
    })

    const unsubDrivers = subscribeDriversRealtime((data) => {
      setAllDrivers(data)
      setAvailableDrivers(data.filter((d) => d.status === DRIVER_STATUS.AVAILABLE))
    })

    return () => {
      unsubOrders()
      unsubDrivers()
    }
  }, [])

  useEffect(() => {
    if (isLoading || orderList.length === 0) return

    const HUB = {
      lat: Number(process.env.NEXT_PUBLIC_HUB_LAT) || 6.4642667,
      lng: Number(process.env.NEXT_PUBLIC_HUB_LNG) || 3.5554814,
    }

    function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
      const toRad = (v: number) => (v * Math.PI) / 180
      const dLat = toRad(b.lat - a.lat)
      const dLng = toRad(b.lng - a.lng)
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
      return Number((6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))).toFixed(2))
    }

    // An order needs backfilling if it is missing its distance *or* its
    // coordinates — the latter is what keeps it off the map.
    const missing = orderList.filter((o) => {
      if (!o.address?.trim()) return false
      const needsDistance = typeof o.distanceKm !== "number" || Number.isNaN(o.distanceKm)
      const needsCoords = typeof o.lat !== "number" || typeof o.lng !== "number"
      return needsDistance || needsCoords
    })
    if (missing.length === 0) return

    let cancelled = false

    async function backfillDistances() {
      try {
        await loadGoogleMaps()
        const geocoder = new google.maps.Geocoder()

        for (const order of missing) {
          if (cancelled) break
          try {
            const result = await new Promise<google.maps.GeocoderResult[] | null>((resolve) => {
              geocoder.geocode(
                { address: order.address, region: "NG" },
                (results, status) => {
                  if (status === google.maps.GeocoderStatus.OK && results?.length) {
                    resolve(results)
                  } else {
                    resolve(null)
                  }
                }
              )
            })
            if (!result) continue

            const loc = result[0].geometry.location
            const coords = { lat: loc.lat(), lng: loc.lng() }
            const distanceKm = haversineKm(HUB, coords)

            if (!cancelled) {
              setOrderList((prev) =>
                prev.map((o) => (o.id === order.id ? { ...o, ...coords, distanceKm } : o))
              )
              // Persist coordinates too — an order without lat/lng cannot be
              // plotted on the dispatch or driver map.
              updateOrder(order.id, { ...coords, distanceKm } as Partial<Order>).catch(() => {})
            }
          } catch {
            // skip this order
          }
        }
      } catch {
        // Google Maps not available, skip
      }
    }

    backfillDistances()
    return () => { cancelled = true }
  }, [isLoading, orderList.length])

  async function handleAssignDriver(orderId: string, driverId: string) {
    try {
      setIsSaving(true)
      const startedAt = new Date()
      const targetOrder = orderList.find((o) => o.id === orderId)
      await updateOrder(orderId, {
        assignedDriver: driverId,
        status: ORDER_STATUS.STARTED,
        startedAt,
      })

      setOrderList((prev) =>
        prev.map((order) =>
          order.id === orderId
            ? { ...order, assignedDriver: driverId, status: ORDER_STATUS.STARTED, startedAt }
            : order
        )
      )

      const assignedDriverObj = allDrivers.find((d) => d.id === driverId)
      logActivity({
        action: "order.assigned",
        resourceId: targetOrder?.orderNumber ?? orderId,
        details: { target: assignedDriverObj?.name ?? driverId },
      })

      if (targetOrder) {
        notifyOrderEvent("order_accepted", {
          orderId: targetOrder.id,
          orderNumber: targetOrder.orderNumber,
          customerName: targetOrder.customerName,
          customerPhone: targetOrder.phone,
          customerEmail: targetOrder.customerEmail,
          address: targetOrder.address,
          driverName: assignedDriverObj?.name,
          items: targetOrder.items,
        })
      }
    } catch (err) {
      console.error("Error assigning driver:", err)
      setError("Failed to assign driver")
    } finally {
      setIsSaving(false)
    }
  }

  function getDriverDisplayName(driverId: string | null) {
    if (!driverId) return "Unassigned"
    const fromFirestore = allDrivers.find((d) => d.id === driverId)
    if (fromFirestore) return fromFirestore.name
    return "Unknown"
  }

  function openNewOrderDialog() {
    setEditingOrder(null)
    form.reset({
      orderNumber: "",
      pickupName: "Sterlin Glams",
      pickupPhone: "+234 9160009893",
      pickupAddress: "Sterlin Glams – Ikota Ajah Lagos",
      pickupTime: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      customerName: "",
      phone: "",
      customerEmail: "",
      address: "",
      deliveryDate: new Date().toISOString().split("T")[0],
      deliveryTime: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      items: [{ name: "", price: 0, qty: 1, meta: "" }],
      taxRate: 0,
      deliveryFees: 0,
      deliveryTips: 0,
      discount: 0,
      deliveryInstruction: "",
      paymentMethod: "",
      assignedDriver: UNASSIGNED_DRIVER,
    })
    setAddressSuggestions([])
    setAddressPreviewCoord(null)
    setIsDialogOpen(true)
  }

  function openEditOrderDialog(order: Order) {
    setEditingOrder(order)
    form.reset({
      orderNumber: order.orderNumber,
      pickupName: order.pickupName ?? "Sterlin Glams",
      pickupPhone: order.pickupPhone ?? "+234 9160009893",
      pickupAddress: order.pickupAddress ?? "Sterlin Glams – Ikota Ajah Lagos",
      pickupTime: order.pickupTime ?? "",
      customerName: order.customerName,
      phone: order.phone,
      customerEmail: order.customerEmail ?? "",
      address: order.address,
      deliveryDate: order.deliveryDate ?? "",
      deliveryTime: order.deliveryTime ?? "",
      items: order.items?.length ? order.items.map(i => ({ name: i.name, price: i.price ?? 0, qty: i.qty ?? 1, meta: i.meta ?? "" })) : [{ name: "", price: 0, qty: 1, meta: "" }],
      taxRate: order.taxRate ?? 0,
      deliveryFees: order.deliveryFees ?? 0,
      deliveryTips: order.deliveryTips ?? 0,
      discount: order.discount ?? 0,
      deliveryInstruction: order.deliveryInstruction ?? "",
      paymentMethod: order.paymentMethod ?? "",
      assignedDriver: order.assignedDriver ?? UNASSIGNED_DRIVER,
    })
    setAddressSuggestions([])
    setAddressPreviewCoord(null)
    setIsDialogOpen(true)
  }

  async function handleDeleteOrder(orderId: string) {
    try {
      const orderNumber = orderList.find((o) => o.id === orderId)?.orderNumber ?? orderId
      await deleteOrder(orderId)
      logActivity({ action: "order.deleted", resourceId: orderNumber })
      setOrderList((prev) => prev.filter((o) => o.id !== orderId))
      setSelectedOrderIds((prev) => prev.filter((id) => id !== orderId))
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(null)
      }
      toast({ title: "Order deleted" })
    } catch (err) {
      console.error("Error deleting order:", err)
      toast({ title: "Failed to delete order", variant: "destructive" })
    }
  }

  function computeTotals(data: OrderFormData) {
    const validItems = (data.items ?? []).filter(i => i.name.trim())
    const subtotal = validItems.reduce((s, i) => s + (i.price * i.qty), 0)
    const taxRate = data.taxRate ?? 0
    const tax = Math.round(subtotal * taxRate) / 100
    const deliveryFees = data.deliveryFees ?? 0
    const deliveryTips = data.deliveryTips ?? 0
    const discount = data.discount ?? 0
    const total = subtotal + tax + deliveryFees + deliveryTips - discount
    return { subtotal, tax, total: Math.max(total, 0), validItems }
  }

  async function onSubmit(data: OrderFormData) {
    try {
      setIsSaving(true)
      const { subtotal, tax, total, validItems } = computeTotals(data)

      if (editingOrder) {
        const normalizedCustomerEmail = data.customerEmail?.trim() ? data.customerEmail.trim() : null
        const nextAssignedDriver =
          data.assignedDriver === UNASSIGNED_DRIVER
            ? null
            : data.assignedDriver || null
        const nextStatus: Order["status"] = nextAssignedDriver ? editingOrder.status : ORDER_STATUS.UNASSIGNED

        await updateOrder(editingOrder.id, {
          orderNumber: data.orderNumber,
          pickupName: data.pickupName,
          pickupPhone: data.pickupPhone,
          pickupAddress: data.pickupAddress,
          pickupTime: data.pickupTime,
          customerName: data.customerName,
          phone: data.phone,
          customerEmail: normalizedCustomerEmail,
          address: data.address,
          deliveryDate: data.deliveryDate,
          deliveryTime: data.deliveryTime,
          items: validItems,
          subtotal,
          taxRate: data.taxRate ?? 0,
          tax,
          deliveryFees: data.deliveryFees ?? 0,
          deliveryTips: data.deliveryTips ?? 0,
          discount: data.discount ?? 0,
          amount: total,
          deliveryInstruction: data.deliveryInstruction ?? "",
          paymentMethod: data.paymentMethod ?? "",
          assignedDriver: nextAssignedDriver,
          status: nextStatus,
        })

        setOrderList((prev) =>
          prev.map((order) =>
            order.id === editingOrder.id
              ? {
                  ...order,
                  orderNumber: data.orderNumber,
                  pickupName: data.pickupName,
                  pickupPhone: data.pickupPhone,
                  pickupAddress: data.pickupAddress,
                  pickupTime: data.pickupTime,
                  customerName: data.customerName,
                  phone: data.phone,
                  customerEmail: normalizedCustomerEmail,
                  address: data.address,
                  deliveryDate: data.deliveryDate,
                  deliveryTime: data.deliveryTime,
                  items: validItems,
                  subtotal,
                  taxRate: data.taxRate ?? 0,
                  tax,
                  deliveryFees: data.deliveryFees ?? 0,
                  deliveryTips: data.deliveryTips ?? 0,
                  discount: data.discount ?? 0,
                  amount: total,
                  deliveryInstruction: data.deliveryInstruction ?? "",
                  paymentMethod: data.paymentMethod ?? "",
                  assignedDriver: nextAssignedDriver,
                  status: nextStatus,
                }
              : order
          )
        )
        logActivity({
          action: "order.updated",
          resourceId: data.orderNumber || editingOrder.id,
          details: { customer: data.customerName },
        })
        toast({ title: "Order updated" })
      } else {
        const normalizedCustomerEmail = data.customerEmail?.trim() ? data.customerEmail.trim() : null
        const assignedDriverValue =
          data.assignedDriver === UNASSIGNED_DRIVER
            ? null
            : data.assignedDriver || null
        const initialStatus: Order["status"] = assignedDriverValue ? ORDER_STATUS.STARTED : ORDER_STATUS.UNASSIGNED

        // Warn if another active order already uses this order number
        const duplicate = orderList.find(
          (o) => o.orderNumber === data.orderNumber && !["delivered", "cancelled", "failed"].includes(o.status)
        )
        if (duplicate) {
          const proceed = window.confirm(
            `Order number "${data.orderNumber}" is already in use by an active order (${duplicate.status}). Create anyway?`
          )
          if (!proceed) { setIsSaving(false); return }
        }

        const orderId = await createOrder({
          orderNumber: data.orderNumber,
          pickupName: data.pickupName,
          pickupPhone: data.pickupPhone,
          pickupAddress: data.pickupAddress,
          pickupTime: data.pickupTime,
          customerName: data.customerName,
          phone: data.phone,
          customerEmail: normalizedCustomerEmail,
          address: data.address,
          deliveryDate: data.deliveryDate,
          deliveryTime: data.deliveryTime,
          items: validItems,
          subtotal,
          taxRate: data.taxRate ?? 0,
          tax,
          deliveryFees: data.deliveryFees ?? 0,
          deliveryTips: data.deliveryTips ?? 0,
          discount: data.discount ?? 0,
          amount: total,
          deliveryInstruction: data.deliveryInstruction ?? "",
          paymentMethod: data.paymentMethod ?? "",
          status: initialStatus,
          assignedDriver: assignedDriverValue,
        })
        logActivity({
          action: "order.created",
          resourceId: data.orderNumber || orderId,
          details: { customer: data.customerName },
        })
        toast({ title: "Order created" })

        const newOrder: Order = {
          id: orderId,
          orderNumber: data.orderNumber,
          pickupName: data.pickupName,
          pickupPhone: data.pickupPhone,
          pickupAddress: data.pickupAddress,
          pickupTime: data.pickupTime,
          customerName: data.customerName,
          phone: data.phone,
          customerEmail: normalizedCustomerEmail,
          address: data.address,
          deliveryDate: data.deliveryDate,
          deliveryTime: data.deliveryTime,
          items: validItems,
          subtotal,
          taxRate: data.taxRate ?? 0,
          tax,
          deliveryFees: data.deliveryFees ?? 0,
          deliveryTips: data.deliveryTips ?? 0,
          discount: data.discount ?? 0,
          amount: total,
          deliveryInstruction: data.deliveryInstruction ?? "",
          paymentMethod: data.paymentMethod ?? "",
          status: initialStatus,
          assignedDriver: assignedDriverValue,
          createdAt: new Date(),
          startedAt: initialStatus === ORDER_STATUS.STARTED ? new Date() : undefined,
        }

        setOrderList((prev) => [newOrder, ...prev])
      }

      setIsDialogOpen(false)
      setError(null)
    } catch (err) {
      console.error("Error saving order:", err)
      setError(editingOrder ? "Failed to update order" : "Failed to create order")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const currentOrders = orderList.filter(
    (o) => ACTIVE_STATUSES.includes(o.status)
  )
  const completedOrders = orderList.filter((o) => o.status === ORDER_STATUS.DELIVERED)
  const incompleteOrders = orderList.filter((o) => o.status === ORDER_STATUS.CANCELLED || o.status === ORDER_STATUS.FAILED)
  const historyOrders = orderList.filter(
    (o) => TERMINAL_STATUSES.includes(o.status)
  )

  const baseVisibleOrders =
    activeTab === "current"
      ? currentOrders
      : activeTab === "completed"
        ? completedOrders
        : activeTab === "incomplete"
          ? incompleteOrders
          : historyResults ?? historyOrders

  const visibleOrders = (() => {
    let list = activeTab === "history"
      ? baseVisibleOrders
      : searchQuery.trim() === ""
        ? baseVisibleOrders
        : baseVisibleOrders.filter((o) => {
            const q = searchQuery.trim().toLowerCase()
            return (
              (o.customerName ?? "").toLowerCase().includes(q) ||
              (o.orderNumber ?? "").toLowerCase().includes(q)
            )
          })
    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter)
    if (driverFilter !== "all") list = list.filter((o) => (o.assignedDriver ?? "none") === driverFilter)
    if (paymentFilter !== "all") list = list.filter((o) => (o.paymentMethod ?? "") === paymentFilter)
    if (dateFromFilter) {
      const from = new Date(dateFromFilter).getTime()
      list = list.filter((o) => {
        const ms = toMs(o.createdAt)
        return ms >= from
      })
    }
    if (dateToFilter) {
      const to = new Date(dateToFilter).getTime() + 86_400_000
      list = list.filter((o) => {
        const ms = toMs(o.createdAt)
        return ms <= to
      })
    }
    return list
  })()

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  function SortHead({ col, label, className }: { col: string; label: string; className?: string }) {
    const active = sortCol === col
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${className ?? ""}`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active
            ? sortDir === "asc"
              ? <ArrowUp className="h-3 w-3 text-primary" />
              : <ArrowDown className="h-3 w-3 text-primary" />
            : <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
          }
        </span>
      </TableHead>
    )
  }

  const sortedOrders = [...visibleOrders].sort((a, b) => {
    if (!sortCol) return 0
    const dir = sortDir === "asc" ? 1 : -1
    const val = (o: Order): string | number => {
      switch (sortCol) {
        case "orderNumber": return o.orderNumber ?? ""
        case "customerName": return o.customerName ?? ""
        case "phone": return o.phone ?? ""
        case "address": return o.address ?? ""
        case "amount": return o.amount ?? 0
        case "status": return o.status ?? ""
        case "driver": return o.assignedDriver ?? ""
        case "distance": return o.distanceKm ?? 0
        case "placementTime": {
          const d = o.createdAt
          if (!d) return 0
          if (typeof d === "object" && "seconds" in (d as object)) return (d as { seconds: number }).seconds
          return new Date(d as string | number).getTime() / 1000
        }
        default: return ""
      }
    }
    const av = val(a), bv = val(b)
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
    return String(av).localeCompare(String(bv)) * dir
  })

  const visibleOrderIds = sortedOrders.map((o) => o.id)
  const selectedVisibleCount = visibleOrderIds.filter((id) => selectedOrderIds.includes(id)).length
  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / PAGE_SIZE))
  const paginatedOrders = sortedOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allVisibleSelected = visibleOrderIds.length > 0 && selectedVisibleCount === visibleOrderIds.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  function toggleOrderSelection(orderId: string, checked: boolean) {
    setSelectedOrderIds((prev) =>
      checked ? [...new Set([...prev, orderId])] : prev.filter((id) => id !== orderId)
    )
  }

  function toggleSelectAllVisible(checked: boolean) {
    if (!checked) {
      setSelectedOrderIds((prev) => prev.filter((id) => !visibleOrderIds.includes(id)))
      return
    }
    setSelectedOrderIds((prev) => [...new Set([...prev, ...visibleOrderIds])])
  }

  function openBulkAssignDialog() {
    if (selectedOrderIds.length === 0) {
      toast({ title: "Select orders first" })
      return
    }
    setBulkDriverId(UNASSIGNED_DRIVER)
    setIsBulkAssignOpen(true)
  }

  async function handleBulkAssign() {
    if (selectedOrderIds.length === 0 || bulkDriverId === UNASSIGNED_DRIVER) return
    try {
      setIsSaving(true)
      await Promise.all(
        selectedOrderIds.map((id) =>
          updateOrder(id, {
            assignedDriver: bulkDriverId,
            status: ORDER_STATUS.STARTED,
            startedAt: new Date(),
          })
        )
      )

      setOrderList((prev) =>
        prev.map((order) =>
          selectedOrderIds.includes(order.id)
            ? { ...order, assignedDriver: bulkDriverId, status: ORDER_STATUS.STARTED, startedAt: new Date() }
            : order
        )
      )

      const selectedOrders = orderList.filter((o) => selectedOrderIds.includes(o.id))
      const bulkDriverObj = allDrivers.find((d) => d.id === bulkDriverId)
      for (const item of selectedOrders) {
        notifyOrderEvent("order_accepted", {
          orderId: item.id,
          orderNumber: item.orderNumber,
          customerName: item.customerName,
          customerPhone: item.phone,
          customerEmail: item.customerEmail,
          address: item.address,
          driverName: bulkDriverObj?.name,
          items: item.items,
        })
      }

      logActivity({
        action: "order.assigned",
        details: { bulk: true, count: selectedOrderIds.length, target: bulkDriverObj?.name ?? bulkDriverId },
      })

      setIsBulkAssignOpen(false)
      toast({ title: "Orders assigned", description: `${selectedOrderIds.length} orders updated.` })
    } catch {
      toast({ title: "Failed to assign orders", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  function handleBulkSendEta() {
    if (selectedOrderIds.length === 0) {
      toast({ title: "Select orders first" })
      return
    }
    toast({ title: "ETA sent", description: `ETA sent for ${selectedOrderIds.length} orders.` })
  }

  // ── Helpers ──
  function timeAgo(value: unknown): string {
    if (!value) return ""
    let date: Date
    if (typeof value === "object" && value !== null && "seconds" in value) {
      date = new Date((value as { seconds: number }).seconds * 1000)
    } else if (value instanceof Date) {
      date = value
    } else {
      date = new Date(value as string | number)
    }
    return formatDistanceToNow(date, { addSuffix: true })
  }

  function exportOrdersCSV(orders: Order[]) {
    const rows = [
      ["Order #", "Customer", "Phone", "Address", "Amount", "Status", "Driver", "Payment", "Distance (km)", "Created At", "Delivered At", "Rating"],
      ...orders.map((o) => {
        const driver = o.assignedDriver ? allDrivers.find((d) => d.id === o.assignedDriver)?.name ?? "" : ""
        const createdAt = o.createdAt
          ? typeof o.createdAt === "object" && "seconds" in (o.createdAt as object)
            ? format(new Date((o.createdAt as { seconds: number }).seconds * 1000), "yyyy-MM-dd HH:mm")
            : format(new Date(o.createdAt as string | number), "yyyy-MM-dd HH:mm")
          : ""
        const deliveredAt = o.deliveredAt
          ? typeof o.deliveredAt === "object" && "seconds" in (o.deliveredAt as object)
            ? format(new Date((o.deliveredAt as { seconds: number }).seconds * 1000), "yyyy-MM-dd HH:mm")
            : format(new Date(o.deliveredAt as string | number), "yyyy-MM-dd HH:mm")
          : ""
        return [
          o.orderNumber, o.customerName, o.phone,
          `"${(o.address ?? "").replace(/"/g, '""')}"`,
          o.amount ?? 0, o.status, driver,
          o.paymentMethod ?? "", o.distanceKm ?? "",
          createdAt, deliveredAt, o.customerRating ?? "",
        ]
      }),
    ]
    const csv = rows.map((r) => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `orders-${format(new Date(), "yyyy-MM-dd")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDuplicateOrder(order: Order) {
    setEditingOrder(null)
    form.reset({
      orderNumber: "",
      pickupName: order.pickupName ?? "Sterlin Glams",
      pickupPhone: order.pickupPhone ?? "+234 9160009893",
      pickupAddress: order.pickupAddress ?? "Sterlin Glams – Ikota Ajah Lagos",
      pickupTime: order.pickupTime ?? "",
      customerName: order.customerName,
      phone: order.phone,
      customerEmail: order.customerEmail ?? "",
      address: order.address,
      deliveryDate: new Date().toISOString().split("T")[0],
      deliveryTime: order.deliveryTime ?? "",
      items: order.items?.length ? order.items.map((i) => ({ name: i.name, price: i.price ?? 0, qty: i.qty ?? 1, meta: i.meta ?? "" })) : [{ name: "", price: 0, qty: 1, meta: "" }],
      taxRate: order.taxRate ?? 0,
      deliveryFees: order.deliveryFees ?? 0,
      deliveryTips: order.deliveryTips ?? 0,
      discount: order.discount ?? 0,
      deliveryInstruction: order.deliveryInstruction ?? "",
      paymentMethod: order.paymentMethod ?? "",
      assignedDriver: UNASSIGNED_DRIVER,
    })
    setAddressSuggestions([])
    setAddressPreviewCoord(null)
    setIsDialogOpen(true)
  }

  async function handleMarkStatus(order: Order, status: "delivered" | "failed") {
    if (!window.confirm(`Mark order ${order.orderNumber} as ${status}?`)) return
    try {
      setIsSaving(true)
      const updates: Partial<Order> = { status }
      if (status === "delivered") updates.deliveredAt = new Date()
      if (status === "failed") updates.deliveryAttempts = (order.deliveryAttempts ?? 0) + 1
      await updateOrder(order.id, updates)
      logActivity({ action: "order.status_changed", resourceId: order.orderNumber, details: { status } })
      setOrderList((prev) => prev.map((o) => o.id === order.id ? { ...o, ...updates } : o))
      toast({ title: `Order marked as ${status}` })
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleBulkCancel() {
    if (selectedOrderIds.length === 0) { toast({ title: "Select orders first" }); return }
    if (!window.confirm(`Cancel ${selectedOrderIds.length} selected orders?`)) return
    try {
      setIsSaving(true)
      await Promise.all(selectedOrderIds.map((id) => updateOrder(id, { status: "cancelled", assignedDriver: null })))
      setOrderList((prev) => prev.map((o) => selectedOrderIds.includes(o.id) ? { ...o, status: "cancelled", assignedDriver: null } : o))
      setSelectedOrderIds([])
      toast({ title: "Orders cancelled", description: `${selectedOrderIds.length} orders cancelled.` })
    } catch {
      toast({ title: "Failed to cancel orders", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  function isOverdue(order: Order): boolean {
    if (!["started", "picked-up", "in-transit"].includes(order.status)) return false
    const started = order.startedAt
    if (!started) return false
    const ms = typeof started === "object" && "seconds" in (started as object)
      ? (started as { seconds: number }).seconds * 1000
      : new Date(started as string | number).getTime()
    return Date.now() - ms > 3 * 60 * 60 * 1000
  }

  function toMs(ts: unknown): number {
    if (!ts) return 0
    if (typeof ts === "object" && ts !== null && "seconds" in ts) return (ts as { seconds: number }).seconds * 1000
    return new Date(ts as string | number).getTime()
  }

  function openWhatsApp(order: Order) {
    const phone = order.phone.replace(/\D/g, "")
    const msg = encodeURIComponent(`Hi ${order.customerName}, your order #${order.orderNumber} is on its way! Track it here: ${window.location.origin}/track/${encodeURIComponent(order.orderNumber)}`)
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer")
  }

  async function handleToggleUrgent(order: Order) {
    try {
      const urgent = !order.urgent
      await updateOrder(order.id, { urgent } as Partial<Order>)
      setOrderList((prev) => prev.map((o) => o.id === order.id ? { ...o, urgent } : o))
      toast({ title: urgent ? "Marked as urgent" : "Urgency removed" })
    } catch {
      toast({ title: "Failed to update order", variant: "destructive" })
    }
  }

  async function handleSaveAdminNote(orderId: string, note: string) {
    try {
      await updateOrder(orderId, { adminNote: note } as Partial<Order>)
      setOrderList((prev) => prev.map((o) => o.id === orderId ? { ...o, adminNote: note } : o))
      toast({ title: "Note saved" })
    } catch {
      toast({ title: "Failed to save note", variant: "destructive" })
    }
  }

  function printManifest(orders: Order[]) {
    const rows = orders.map((o) => {
      const driver = o.assignedDriver ? allDrivers.find((d) => d.id === o.assignedDriver)?.name ?? "Unassigned" : "Unassigned"
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">#${o.orderNumber}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${o.customerName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${o.phone}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${o.address}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${driver}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${formatCurrency(o.amount)}</td>
      </tr>`
    }).join("")
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>Order Manifest</title><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 12px;border-bottom:2px solid #111;font-size:12px;text-transform:uppercase;color:#6b7280}td{font-size:13px}</style></head><body><h2 style="margin-bottom:4px">Order Manifest</h2><p style="color:#6b7280;margin-bottom:16px;font-size:13px">Generated ${new Date().toLocaleString()} — ${orders.length} orders</p><table><thead><tr><th>Order #</th><th>Customer</th><th>Phone</th><th>Address</th><th>Driver</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table></body></html>`)
    win.document.close()
    win.print()
  }

  async function handleCancelOrder(order: Order) {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return
    try {
      setIsSaving(true)
      await updateOrder(order.id, { status: "cancelled", assignedDriver: null })
      logActivity({
        action: "order.status_changed",
        resourceId: order.orderNumber || order.id,
        details: { status: "cancelled" },
      })
      setOrderList((prev) =>
        prev.map((o) => o.id === order.id ? { ...o, status: "cancelled", assignedDriver: null } : o)
      )
      toast({ title: "Order cancelled", description: `${order.orderNumber} has been cancelled.` })
    } catch {
      toast({ title: "Failed to cancel order", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleUnassignOrder(orderId: string) {
    try {
      setIsSaving(true)
      await updateOrder(orderId, { assignedDriver: null, status: "unassigned", startedAt: null })
      logActivity({
        action: "order.assigned",
        resourceId: orderList.find((o) => o.id === orderId)?.orderNumber ?? orderId,
        details: { unassigned: true },
      })
      setOrderList((prev) =>
        prev.map((o) => o.id === orderId ? { ...o, assignedDriver: null, status: "unassigned", startedAt: null } : o)
      )
      setReassignOrderId(null)
      toast({ title: "Order unassigned" })
    } catch {
      toast({ title: "Failed to unassign order", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  function getDriverActiveOrderCount(driverId: string) {
    return orderList.filter(
      (o) => o.assignedDriver === driverId && !["unassigned", "delivered", "cancelled", "failed"].includes(o.status)
    ).length
  }

  async function handleBulkDelete() {
    if (selectedOrderIds.length === 0) {
      toast({ title: "Select orders first" })
      return
    }
    const shouldDelete = window.confirm(`Delete ${selectedOrderIds.length} selected orders?`)
    if (!shouldDelete) return

    try {
      setIsSaving(true)
      const count = selectedOrderIds.length
      await Promise.all(selectedOrderIds.map((id) => deleteOrder(id)))
      logActivity({ action: "order.deleted", details: { bulk: true, count } })
      setOrderList((prev) => prev.filter((order) => !selectedOrderIds.includes(order.id)))
      setSelectedOrderIds([])
      toast({ title: "Orders deleted", description: "Selected orders were removed." })
    } catch {
      toast({ title: "Failed to delete selected orders", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  function handleHistorySearch() {
    let results = historyOrders
    if (historyDateFrom) {
      const from = new Date(historyDateFrom)
      from.setHours(0, 0, 0, 0)
      results = results.filter((o) => {
        const d = o.createdAt
        if (!d) return false
        const date = typeof d === "object" && "seconds" in (d as object)
          ? new Date((d as { seconds: number }).seconds * 1000)
          : new Date(d as string | number)
        return date >= from
      })
    }
    if (historyDateTo) {
      const to = new Date(historyDateTo)
      to.setHours(23, 59, 59, 999)
      results = results.filter((o) => {
        const d = o.createdAt
        if (!d) return false
        const date = typeof d === "object" && "seconds" in (d as object)
          ? new Date((d as { seconds: number }).seconds * 1000)
          : new Date(d as string | number)
        return date <= to
      })
    }
    if (historyKeyword.trim()) {
      const kw = historyKeyword.trim().toLowerCase()
      results = results.filter((o) => {
        switch (historySearchField) {
          case "customerName": return (o.customerName ?? "").toLowerCase().includes(kw)
          case "phone": return (o.phone ?? "").toLowerCase().includes(kw)
          case "orderNumber": return (o.orderNumber ?? "").toLowerCase().includes(kw)
          case "driver": return (o.assignedDriver ?? "").toLowerCase().includes(kw)
          case "pickupName": return (o.pickupName ?? "").toLowerCase().includes(kw)
          default: return true
        }
      })
    }
    setHistoryResults(results)
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const lines = text.split(/\r?\n/).filter((l) => l.trim())
      if (lines.length < 2) {
        toast({ title: "CSV has no data rows", variant: "destructive" })
        return
      }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())
      const idx = (name: string) => headers.indexOf(name)
      const rows = lines.slice(1)
      let created = 0
      let failed = 0
      for (const row of rows) {
        const cols = row.split(",").map((c) => c.trim())
        const orderNumber = cols[idx("ordernumber")] ?? cols[idx("order number")] ?? cols[idx("order_number")] ?? ""
        const customerName = cols[idx("customername")] ?? cols[idx("customer name")] ?? cols[idx("customer_name")] ?? ""
        const phone = cols[idx("phone")] ?? cols[idx("customerphone")] ?? cols[idx("customer phone")] ?? ""
        const address = cols[idx("address")] ?? ""
        const amountStr = cols[idx("amount")] ?? ""
        const amount = parseFloat(amountStr.replace(/[^0-9.]/g, "")) || 0
        if (!orderNumber || !customerName) { failed++; continue }
        try {
          await createOrder({
            orderNumber,
            customerName,
            phone,
            address,
            amount,
            status: "unassigned",
            assignedDriver: null,
            pickupName: "Sterlin Glams",
            pickupPhone: "+234 9160009893",
            pickupAddress: "Sterlin Glams – Ikota Ajah Lagos",
            pickupTime: "",
            deliveryDate: new Date().toISOString().split("T")[0],
            deliveryTime: "",
            items: [],
            createdAt: new Date(),
          } as Parameters<typeof createOrder>[0])
          created++
        } catch {
          failed++
        }
      }
      toast({
        title: `CSV import complete`,
        description: `${created} order(s) imported${failed > 0 ? `, ${failed} failed` : ""}.`,
        variant: failed > 0 && created === 0 ? "destructive" : "default",
      })
    }
    reader.readAsText(file)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Title row ── */}
      {activeTab === "current" && (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground mr-auto">Orders</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 w-56 h-9"
              placeholder="Search name or order no…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
              onKeyDown={(e) => e.key === "Escape" && setSearchQuery("")}
            />
          </div>
          <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          <Button variant="outline" className="h-9" onClick={() => csvInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            CSV Upload
          </Button>
          <Button className="h-9" onClick={openNewOrderDialog}>
            <Plus className="mr-2 h-4 w-4" />
            New Order
          </Button>
        </div>
      )}
      {(activeTab === "completed" || activeTab === "incomplete") && (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground mr-auto">Orders</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 w-56 h-9"
              placeholder="Search name or order no…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}
      {activeTab === "history" && (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground w-full sm:w-auto mr-auto">Orders</h1>
          <Input
            type="date"
            className="h-9 w-36"
            value={historyDateFrom}
            onChange={(e) => setHistoryDateFrom(e.target.value)}
            placeholder="From date"
          />
          <span className="text-muted-foreground text-sm">–</span>
          <Input
            type="date"
            className="h-9 w-36"
            value={historyDateTo}
            onChange={(e) => setHistoryDateTo(e.target.value)}
            placeholder="To date"
          />
          <Select value={historySearchField} onValueChange={setHistorySearchField}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="orderNumber">Order Number</SelectItem>
              <SelectItem value="customerName">Customer Name</SelectItem>
              <SelectItem value="phone">Customer Phone</SelectItem>
              <SelectItem value="driver">Driver</SelectItem>
              <SelectItem value="pickupName">Pick Up From</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="h-9 w-44"
            placeholder="Keyword…"
            value={historyKeyword}
            onChange={(e) => setHistoryKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleHistorySearch()}
          />
          <Button className="h-9 bg-green-600 hover:bg-green-700 text-white" onClick={handleHistorySearch}>
            Search
          </Button>
        </div>
      )}

      {/* ── Tabs + bulk action icons ── */}
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-5 overflow-x-auto">
          {(["current", "completed", "incomplete", "history"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearchQuery(""); setHistoryResults(null); setStatusFilter("all"); setDriverFilter("all"); setPaymentFilter("all"); setPage(1) }}
              className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "current" && currentOrders.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{currentOrders.length}</span>
              )}
              {tab === "completed" && completedOrders.length > 0 && (
                <span className="ml-1.5 rounded-full bg-success/20 px-2 py-0.5 text-xs text-success">{completedOrders.length}</span>
              )}
              {tab === "incomplete" && incompleteOrders.length > 0 && (
                <span className="ml-1.5 rounded-full bg-destructive/20 px-2 py-0.5 text-xs text-destructive">{incompleteOrders.length}</span>
              )}
              {tab === "history" && (
                <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{historyOrders.length}</span>
              )}
            </button>
          ))}
        </div>
        {activeTab === "current" && (
          <div className="flex items-center gap-1 pb-2">
            {selectedOrderIds.length > 0 && (
              <span className="mr-1 text-xs text-muted-foreground">{selectedOrderIds.length} selected</span>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openBulkAssignDialog} disabled={selectedOrderIds.length === 0 || isSaving} title="Assign Orders">
              <UserPlus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBulkSendEta} disabled={selectedOrderIds.length === 0 || isSaving} title="Send ETA">
              <Send className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBulkCancel} disabled={selectedOrderIds.length === 0 || isSaving} title="Cancel selected">
              <XCircle className="h-4 w-4 text-warning" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => exportOrdersCSV(orderList.filter((o) => selectedOrderIds.includes(o.id)))} disabled={selectedOrderIds.length === 0} title="Export selected as CSV">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.print()} disabled={selectedOrderIds.length === 0} title="Print">
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBulkDelete} disabled={selectedOrderIds.length === 0 || isSaving} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      <p className="-mt-2 text-sm text-muted-foreground">Manage and track all delivery orders</p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ── Filter strip ── */}
      {activeTab !== "history" && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Status chips */}
          {activeTab === "current" && (
            <div className="flex flex-wrap gap-1">
              {(["all", "unassigned", "started", "picked-up", "in-transit"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setPage(1) }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ")}
                  <span className="ml-1 opacity-70">
                    {s === "all" ? `(${currentOrders.length})` : `(${currentOrders.filter((o) => o.status === s).length})`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Driver filter */}
          {activeTab === "current" && allDrivers.length > 0 && (
            <select
              value={driverFilter}
              onChange={(e) => { setDriverFilter(e.target.value); setPage(1) }}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">All drivers</option>
              <option value="none">Unassigned</option>
              {allDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}

          {/* Payment filter */}
          {(() => {
            const methods = [...new Set(visibleOrders.map((o) => o.paymentMethod ?? "").filter(Boolean))]
            if (!methods.length) return null
            return (
              <select
                value={paymentFilter}
                onChange={(e) => { setPaymentFilter(e.target.value); setPage(1) }}
                className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All payments</option>
                {methods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )
          })()}

          {/* Date range filter */}
          <>
            <input
              type="date"
              value={dateFromFilter}
              onChange={(e) => { setDateFromFilter(e.target.value); setPage(1) }}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
              title="From date"
            />
            <input
              type="date"
              value={dateToFilter}
              onChange={(e) => { setDateToFilter(e.target.value); setPage(1) }}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
              title="To date"
            />
          </>

          {/* Export / Print manifest */}
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => printManifest(visibleOrders)}>
              <Printer className="mr-1.5 h-3.5 w-3.5" />Manifest
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportOrdersCSV(visibleOrders)}>
              <Download className="mr-1.5 h-3.5 w-3.5" />Export
            </Button>
          </div>
        </div>
      )}

      <div>
        {visibleOrders.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">No orders in this section.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 px-2">
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                  aria-label="Select all visible orders"
                />
              </TableHead>
              <SortHead col="orderNumber" label="Order No." className="w-24" />
              <SortHead col="customerName" label="C. Name" />
              <SortHead col="address" label="C. Address" className="hidden lg:table-cell" />
              <SortHead col="amount" label="Amount" className="w-28" />
              <SortHead col="distance" label="Distance" className="w-24" />
              <SortHead col="placementTime" label="Order Placed" className="w-28" />
              <SortHead col="status" label="Status" className="w-28" />
              <SortHead col="driver" label="Driver" className="w-36" />
              {activeTab === "current" && <TableHead className="w-16">Track</TableHead>}
              {(activeTab === "completed" || activeTab === "history") && <TableHead className="w-28">Delivery Time</TableHead>}
              {activeTab === "completed" && <TableHead className="w-20">Rating</TableHead>}
              {activeTab !== "completed" && activeTab !== "history" && <TableHead className="w-10"></TableHead>}
              {activeTab === "history" && isAdminOrOwner && <TableHead className="w-10"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedOrders.map((order) => (
              <TableRow key={order.id} className="text-sm">
                <TableCell className="px-2">
                  <Checkbox
                    checked={selectedOrderIds.includes(order.id)}
                    onCheckedChange={(checked) => toggleOrderSelection(order.id, checked === true)}
                    aria-label={`Select order ${order.orderNumber}`}
                  />
                </TableCell>
                <TableCell className="font-medium text-foreground whitespace-nowrap">
                  <button
                    onClick={() => setSelectedOrder(order)}
                    className="underline hover:text-primary"
                  >
                    {order.orderNumber}
                  </button>
                  {!!order.urgent && (
                    <span title="Urgent" className="ml-1 inline-flex"><Flame className="inline size-3.5 text-orange-500" aria-label="Urgent" /></span>
                  )}
                  {!!order.adminNote && (
                    <span title={order.adminNote} className="ml-0.5 inline-flex"><StickyNote className="inline size-3 text-amber-400" aria-label="Has note" /></span>
                  )}
                  {(order.deliveryAttempts ?? 0) > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">({order.deliveryAttempts}×)</span>
                  )}
                </TableCell>
                <TableCell className="text-foreground whitespace-nowrap">{order.customerName}</TableCell>
                <TableCell className="hidden max-w-[180px] truncate text-muted-foreground lg:table-cell">
                  {order.address}
                </TableCell>
                <TableCell className="font-medium text-foreground whitespace-nowrap">
                  {formatCurrency(order.amount)}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{formatDistance(order.distanceKm)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatOrderTime(order.createdAt)}
                  {order.status === "unassigned" && (
                    <span className="block text-[10px] text-muted-foreground/60">{timeAgo(order.createdAt)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={order.status} />
                    {isOverdue(order) && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        <Clock className="size-2.5" />Overdue
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {order.assignedDriver ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-foreground">{getDriverDisplayName(order.assignedDriver)}</span>
                      {activeTab !== "completed" && activeTab !== "history" && (
                        <button
                          onClick={() => setReassignOrderId(order.id)}
                          className="text-xs text-muted-foreground hover:text-primary"
                          title="Reassign"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  ) : (
                    <Select onValueChange={(value) => handleAssignDriver(order.id, value)}>
                      <SelectTrigger className="h-8 w-[110px] rounded-md border bg-amber-50 text-xs font-medium shadow-sm border-amber-200 text-amber-700">
                        <SelectValue placeholder="+ Assign" />
                      </SelectTrigger>
                      <SelectContent className="shadow-xl">
                        {availableDrivers.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                {activeTab === "current" && (
                  <TableCell>
                    {order.assignedDriver ? (
                      <Button asChild size="sm" variant="link" className="h-7 px-0 text-primary">
                        <Link
                          href={`/track/${encodeURIComponent(order.orderNumber)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Track
                        </Link>
                      </Button>
                    ) : null}
                  </TableCell>
                )}
                {(activeTab === "completed" || activeTab === "history") && (
                  <TableCell className="text-muted-foreground whitespace-nowrap">{formatOrderTime(order.deliveredAt)}</TableCell>
                )}
                {activeTab === "completed" && (
                  <TableCell>
                    {order.customerRating ? (
                      <span className="flex items-center gap-0.5 text-xs">
                        <Star className="size-3 fill-yellow-400 text-yellow-400" />
                        <span className="font-medium">{order.customerRating}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                )}
                {activeTab === "history" && isAdminOrOwner && (
                  <TableCell className="px-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setOrderToDelete(order)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
                {activeTab !== "completed" && activeTab !== "history" && (
                  <TableCell className="px-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {order.assignedDriver && (
                          <DropdownMenuItem onClick={() => setReassignOrderId(order.id)}>
                            <UserPlus2 className="mr-2 h-4 w-4" /> Reassign
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setSelectedOrder(order)}>
                          <FileText className="mr-2 h-4 w-4" /> Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEditOrderDialog(order)}>
                          <Edit className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handlePrintOrder(order, getDriverDisplayName)}>
                          <Printer className="mr-2 h-4 w-4" /> Print order
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handlePrintLabel(order)}>
                          <Barcode className="mr-2 h-4 w-4" /> Print label
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDuplicateOrder(order)}>
                          <Copy className="mr-2 h-4 w-4" /> Duplicate order
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleUrgent(order)}>
                          <Flame className="mr-2 h-4 w-4 text-orange-500" />
                          {order.urgent ? "Remove urgent flag" : "Mark as urgent"}
                        </DropdownMenuItem>
                        {!!order.phone && (
                          <DropdownMenuItem onClick={() => openWhatsApp(order)}>
                            <MessageCircle className="mr-2 h-4 w-4 text-green-500" /> Message on WhatsApp
                          </DropdownMenuItem>
                        )}
                        {isAdminOrOwner && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleMarkStatus(order, "delivered")}>
                              <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Mark as delivered
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleMarkStatus(order, "failed")}>
                              <XCircle className="mr-2 h-4 w-4 text-destructive" /> Mark as failed
                            </DropdownMenuItem>
                          </>
                        )}
                        {order.assignedDriver && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleCancelOrder(order)}>
                              <Ban className="mr-2 h-4 w-4" /> Cancel order
                            </DropdownMenuItem>
                          </>
                        )}
                        {isAdminOrOwner && activeTab === "incomplete" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setOrderToDelete(order)}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete order
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, sortedOrders.length)}–{Math.min(page * PAGE_SIZE, sortedOrders.length)} of {sortedOrders.length}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1).reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && (arr[idx - 1] as number) < p - 1) acc.push("…")
                acc.push(p)
                return acc
              }, []).map((p, i) =>
                p === "…" ? <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                : <button key={p} onClick={() => setPage(p)} className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium ${ page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>{p}</button>
              )}
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Extracted dialog components */}
      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!orderToDelete} onOpenChange={(open) => { if (!open) setOrderToDelete(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete order <strong>#{orderToDelete?.orderNumber}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOrderToDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (orderToDelete) handleDeleteOrder(orderToDelete.id)
                setOrderToDelete(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReassignDialog
        reassignOrderId={reassignOrderId}
        orderList={orderList}
        allDrivers={allDrivers}
        isSaving={isSaving}
        onClose={() => setReassignOrderId(null)}
        onAssignDriver={handleAssignDriver}
        onUnassignOrder={handleUnassignOrder}
        getDriverActiveOrderCount={getDriverActiveOrderCount}
      />

      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setAddressSuggestions([]); setAddressPreviewCoord(null) } }}>
        <DialogContent className="w-[95vw] max-w-[1200px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-2xl font-bold">
              {editingOrder ? "Edit Order" : "New Order"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editingOrder ? "Edit order details" : "Create a new order"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid gap-10 md:grid-cols-2">
                {/* ─── Left Column ─── */}
                <div className="space-y-6">
                  <FormField control={form.control} name="orderNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Order Number: <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="Enter order number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <fieldset className="space-y-4">
                    <legend className="text-lg font-semibold">Pick-up From:</legend>
                    <FormField control={form.control} name="pickupName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name: <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="Enter pickup name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pickupPhone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone No: <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="+234 000-000-0000" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pickupAddress" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address: <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="Enter pickup address" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="pickupTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pickup Time: <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input type="time" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="text-lg font-semibold">Deliver to:</legend>
                    <FormField control={form.control} name="customerName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name: <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="Enter customer name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone No: <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="+234 000-000-0000" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="customerEmail" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email:</FormLabel>
                        <FormControl><Input placeholder="Enter an email" type="email" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="address" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address: <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <div className="relative">
                            <div ref={placesContainerRef} className="hidden" />
                            <input
                              type="text"
                              autoComplete="off"
                              placeholder="Enter a location"
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              value={field.value}
                              onChange={(e) => {
                                const val = e.target.value
                                field.onChange(val)
                                setAddressPreviewCoord(null)
                                if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current)
                                if (val.trim().length < 3) { setAddressSuggestions([]); return }
                                addressDebounceRef.current = setTimeout(async () => {
                                  setAddressSearching(true)
                                  try {
                                    await loadGoogleMaps()
                                    if (!autocompleteServiceRef.current) {
                                      autocompleteServiceRef.current = new google.maps.places.AutocompleteService()
                                    }
                                    autocompleteServiceRef.current.getPlacePredictions(
                                      { input: val, componentRestrictions: { country: "ng" } },
                                      (predictions, status) => {
                                        if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                                          setAddressSuggestions(predictions.slice(0, 5).map(p => ({
                                            display_name: p.description,
                                            lat: "",
                                            lon: "",
                                            placeId: p.place_id,
                                          })))
                                        } else {
                                          setAddressSuggestions([])
                                        }
                                        setAddressSearching(false)
                                      }
                                    )
                                  } catch {
                                    setAddressSearching(false)
                                  }
                                }, 300)
                              }}
                            />
                            {(addressSearching || addressSuggestions.length > 0) && (
                              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover shadow-lg">
                                {addressSearching && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                                )}
                                {addressSuggestions.map((s, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                                    onClick={async () => {
                                      field.onChange(s.display_name)
                                      setAddressSuggestions([])
                                      if (s.placeId) {
                                        try {
                                          await loadGoogleMaps()
                                          if (!placesServiceRef.current && placesContainerRef.current) {
                                            placesServiceRef.current = new google.maps.places.PlacesService(placesContainerRef.current)
                                          }
                                          placesServiceRef.current?.getDetails(
                                            { placeId: s.placeId, fields: ["geometry"] },
                                            (place, detailStatus) => {
                                              if (detailStatus === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                                                setAddressPreviewCoord({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() })
                                              }
                                            }
                                          )
                                        } catch { /* ignore */ }
                                      }
                                    }}
                                  >
                                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="line-clamp-2">{s.display_name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="deliveryDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Delivery Date: <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="deliveryTime" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Delivery Time: <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input type="time" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </fieldset>
                </div>

                {/* ─── Right Column: Order Details ─── */}
                <div className="space-y-5">
                  <p className="text-lg font-semibold">Order Details <span className="text-muted-foreground font-normal text-sm">(Optional)</span></p>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Items:</p>
                    {(form.watch("items") ?? []).map((_, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="grid grid-cols-[1fr_120px_80px_28px] gap-3 items-end">
                          <Input
                            placeholder="Item name"
                            value={form.watch(`items.${idx}.name`)}
                            onChange={(e) => {
                              const items = [...(form.getValues("items") ?? [])]
                              items[idx] = { ...items[idx], name: e.target.value }
                              form.setValue("items", items)
                            }}
                          />
                          <Input
                            type="number"
                            placeholder="Price"
                            value={form.watch(`items.${idx}.price`) || ""}
                            onChange={(e) => {
                              const items = [...(form.getValues("items") ?? [])]
                              items[idx] = { ...items[idx], price: parseFloat(e.target.value) || 0 }
                              form.setValue("items", items)
                            }}
                          />
                          <Input
                            type="number"
                            placeholder="Qty"
                            value={form.watch(`items.${idx}.qty`) || ""}
                            onChange={(e) => {
                              const items = [...(form.getValues("items") ?? [])]
                              items[idx] = { ...items[idx], qty: parseInt(e.target.value) || 1 }
                              form.setValue("items", items)
                            }}
                          />
                          <button
                            type="button"
                            className="flex h-9 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              const items = [...(form.getValues("items") ?? [])]
                              if (items.length > 1) {
                                items.splice(idx, 1)
                                form.setValue("items", items)
                              }
                            }}
                          >×</button>
                        </div>
                        <Input
                          placeholder="Attributes (e.g. +pa_color : blue)"
                          className="h-7 text-xs"
                          value={form.watch(`items.${idx}.meta`) || ""}
                          onChange={(e) => {
                            const items = [...(form.getValues("items") ?? [])]
                            items[idx] = { ...items[idx], meta: e.target.value }
                            form.setValue("items", items)
                          }}
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        const items = [...(form.getValues("items") ?? []), { name: "", price: 0, qty: 1, meta: "" }]
                        form.setValue("items", items)
                      }}
                    >+ Add item</button>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Subtotal (₦):</span>
                    <span className="font-medium">{(form.watch("items") ?? []).reduce((s, i) => s + (i.price * i.qty), 0)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">Tax Rate %:</span>
                    <Input type="number" step="0.01" className="h-9 w-48 text-right" placeholder="Enter tax rate" {...form.register("taxRate", { valueAsNumber: true })} />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Tax (₦):</span>
                    <span>{Math.round((form.watch("items") ?? []).reduce((s, i) => s + (i.price * i.qty), 0) * (form.watch("taxRate") ?? 0)) / 100}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">Delivery Fees (₦):</span>
                    <Input type="number" className="h-9 w-48 text-right" placeholder="Enter delivery fees" {...form.register("deliveryFees", { valueAsNumber: true })} />
                  </div>

                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">Delivery Tips (₦):</span>
                    <Input type="number" className="h-9 w-48 text-right" placeholder="Enter delivery tips amount" {...form.register("deliveryTips", { valueAsNumber: true })} />
                  </div>

                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">Discount (₦):</span>
                    <Input type="number" className="h-9 w-48 text-right" placeholder="Enter discount amount" {...form.register("discount", { valueAsNumber: true })} />
                  </div>

                  <div className="flex items-center justify-between text-base font-bold border-t pt-3">
                    <span>Total(₦):</span>
                    <span>{(() => {
                      const items = form.watch("items") ?? []
                      const sub = items.reduce((s, i) => s + (i.price * i.qty), 0)
                      const tax = Math.round(sub * (form.watch("taxRate") ?? 0)) / 100
                      return Math.max(sub + tax + (form.watch("deliveryFees") ?? 0) + (form.watch("deliveryTips") ?? 0) - (form.watch("discount") ?? 0), 0)
                    })()}</span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-sm font-medium">Delivery Instruction:</span>
                    <Textarea placeholder="Enter delivery instructions" className="resize-none" rows={3} {...form.register("deliveryInstruction")} />
                  </div>

                  {/* Internal admin note */}
                  {isAdminOrOwner && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <StickyNote className="size-3.5 text-amber-500" />
                        <span className="text-sm font-medium">Internal Note (not visible to customer):</span>
                      </div>
                      <Textarea
                        placeholder="Add a private note for your team..."
                        className="resize-none border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 focus-visible:ring-amber-300"
                        rows={2}
                        defaultValue={editingOrder?.adminNote ?? ""}
                        onChange={(e) => {
                          if (editingOrder) handleSaveAdminNote(editingOrder.id, e.target.value)
                        }}
                        onBlur={(e) => {
                          if (editingOrder) handleSaveAdminNote(editingOrder.id, e.target.value)
                        }}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">Payment Method:</span>
                    <Input className="h-9 w-48" placeholder="" {...form.register("paymentMethod")} />
                  </div>

                  <p className="text-right text-sm text-destructive">* Required</p>
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <BulkAssignDialog
        open={isBulkAssignOpen}
        onOpenChange={setIsBulkAssignOpen}
        selectedCount={selectedOrderIds.length}
        availableDrivers={availableDrivers}
        bulkDriverId={bulkDriverId}
        onDriverChange={setBulkDriverId}
        onAssign={handleBulkAssign}
        isSaving={isSaving}
      />

      <OrderDetailDialog
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onDelete={handleDeleteOrder}
        getDriverDisplayName={getDriverDisplayName}
      />
    </div>
  )
}
