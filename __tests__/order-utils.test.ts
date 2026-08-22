import { describe, it, expect } from "vitest"
import { parseFirestoreDate } from "@/lib/order-utils"

describe("parseFirestoreDate", () => {
  const seconds = 1755848820 // 2025-08-22T07:47:00Z
  const expectedMs = seconds * 1000

  it("reads admin SDK timestamps, which serialise as _seconds", () => {
    // Every /api/driver/* route uses firebase-admin, whose Timestamp keeps
    // its fields private — JSON.stringify emits _seconds/_nanoseconds. This
    // shape returning null is what emptied the Today/Yesterday tabs.
    expect(parseFirestoreDate({ _seconds: seconds, _nanoseconds: 0 })?.getTime()).toBe(expectedMs)
  })

  it("reads client SDK timestamps, which serialise as seconds", () => {
    expect(parseFirestoreDate({ seconds, nanoseconds: 0 })?.getTime()).toBe(expectedMs)
  })

  it("reads ISO strings, which is what a Date becomes after a JSON round trip", () => {
    // The offline order cache persists through JSON, so cached dates come
    // back as strings rather than Dates.
    const iso = new Date(expectedMs).toISOString()
    expect(parseFirestoreDate(iso)?.getTime()).toBe(expectedMs)
  })

  it("reads epoch milliseconds and seconds", () => {
    expect(parseFirestoreDate(expectedMs)?.getTime()).toBe(expectedMs)
    expect(parseFirestoreDate(seconds)?.getTime()).toBe(expectedMs)
  })

  it("passes through live Timestamp instances via toDate()", () => {
    expect(parseFirestoreDate({ toDate: () => new Date(expectedMs) })?.getTime()).toBe(expectedMs)
  })

  it("returns a Date unchanged", () => {
    const d = new Date(expectedMs)
    expect(parseFirestoreDate(d)).toBe(d)
  })

  it("returns null for missing or unusable values rather than an Invalid Date", () => {
    // Callers do `parseFirestoreDate(x)?.getTime() ?? 0`, so an Invalid Date
    // would sort as NaN instead of falling back cleanly.
    expect(parseFirestoreDate(null)).toBeNull()
    expect(parseFirestoreDate(undefined)).toBeNull()
    expect(parseFirestoreDate("")).toBeNull()
    expect(parseFirestoreDate("not a date")).toBeNull()
    expect(parseFirestoreDate({})).toBeNull()
    expect(parseFirestoreDate(new Date("nonsense"))).toBeNull()
  })

  it("survives a toDate() that throws", () => {
    expect(parseFirestoreDate({ toDate: () => { throw new Error("boom") } })).toBeNull()
  })
})
