# Sterlin Glams Store ⇄ Delivery Integration

Two-way integration with the new **sterlinglams.com** platform (replaces the WooCommerce import):

1. **Store → Delivery**: when a Lagos delivery order is paid + confirmed, the store POSTs it to
   `/api/external-orders` and it appears here as an **unassigned** order (orderNumber = `SL-…`).
2. **Delivery → Store**: when a driver marks the order **delivered**, we POST back to the store so
   it flips that order's status to **Delivered** automatically.

Both calls are signed with one shared **HMAC-SHA256** secret (`x-sg-signature`, base64).

---

## 1. Pick a shared secret

Generate one strong value (e.g. `openssl rand -hex 32`). The **same** value must be set here and
on the store.

## 2. Vercel env vars (this app)

| Name | Value |
|------|-------|
| `STORE_WEBHOOK_SECRET` | the shared secret |
| `STORE_DELIVERED_WEBHOOK_URL` | `https://sterlinglams.com/webhooks/logistics/delivered` (or the Render URL) |

Redeploy after adding them.

## 3. Store env vars (sterlinglams.com / Render)

| Name | Value |
|------|-------|
| `Logistics__Enabled` | `true` |
| `Logistics__SharedSecret` | the same shared secret |
| `Logistics__PushUrl` | `https://sterlinglamslogistics.com/api/external-orders` |

## 4. How it works

- **Incoming order** (`POST /api/external-orders`): verifies the signature, dedupes by
  `orderNumber` (doc id `sg_{orderNumber}`), maps customer/address/items/totals, and creates an
  unassigned order (distance auto-calculated). Appears in the dispatch dashboard immediately.
- **Delivered callback**: the driver "delivered" action calls `notifyStoreDelivered()` which POSTs
  `{ orderNumber, deliveredAt, signerName? }` (signed) to `STORE_DELIVERED_WEBHOOK_URL`. The store
  marks the matching order Delivered (idempotent). Orders the store doesn't recognise (legacy
  WooCommerce imports) are acked and ignored — safe to leave both integrations running.

## 5. Notes

- The customer delivery notification (WhatsApp/SMS/email) is still sent from **this** app on the
  "delivered" event — the store does **not** re-notify, so customers don't get duplicates.
- Both directions are best-effort + idempotent: retries and double-fires never create duplicates
  or double-deliver.
