
"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Package, Truck, MapPin, Clock, Shield, Search, ArrowRight, ExternalLink, Phone, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export default function LandingPage() {
  const [trackingId, setTrackingId] = useState("")
  const router = useRouter()

  function handleTrack(e: React.FormEvent) {
    e.preventDefault()
    if (trackingId.trim()) {
      router.push(`/track/${encodeURIComponent(trackingId.trim())}`)
    }
  }

  return (
    <div className="min-h-screen bg-white text-[hsl(0,0%,12%)]">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-[hsl(330,8%,90%)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 lg:px-8">
          <Link href="/">
            <Image
              src="/placeholder-logo.png"
              alt="Sterlinglams"
              width={120}
              height={120}
              className="rounded-lg"
            />
          </Link>
          <div className="flex items-center gap-3">
            <a
              href="https://sterlinglams.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 text-sm font-medium text-[hsl(0,0%,45%)] transition-colors hover:text-[hsl(330,82%,52%)] sm:flex"
            >
              Shop Sterlinglams
              <ExternalLink className="size-3.5" />
            </a>
            <Link href="/login">
              <Button size="sm" className="bg-[hsl(330,82%,52%)] text-white hover:bg-[hsl(330,82%,45%)]">Sign In</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-[hsl(330,30%,97%)]">
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(330,82%,52%)]/5 via-transparent to-[hsl(330,82%,52%)]/10" />
        <div className="relative mx-auto max-w-7xl px-4 py-12 lg:px-8 lg:py-16">
          <div className="grid items-start gap-8 lg:grid-cols-2">
            {/* Text Column */}
            <div className="text-center lg:text-left lg:py-8">
              <p className="mb-4 text-sm font-medium uppercase tracking-widest text-[hsl(330,82%,52%)]">
                Official Delivery Partner of{" "}
                <a
                  href="https://sterlinglams.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-[hsl(330,82%,45%)]"
                >
                  Sterlinglams.com
                </a>
              </p>
              <h1 className="text-4xl font-extrabold tracking-tight text-[hsl(0,0%,8%)] sm:text-5xl lg:text-6xl">
                Your Order,{" "}
                <span className="text-[hsl(330,82%,52%)]">Delivered with Care</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-[hsl(0,0%,40%)] lg:mx-0 mx-auto">
                We handle every Sterlinglams order — from jewellery to accessories —
                with real-time tracking, same-day dispatch, and secure packaging so
                your items arrive safely and on time.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
                <Link href="/login">
                  <Button size="lg" className="gap-2 bg-[hsl(330,82%,52%)] px-8 text-white hover:bg-[hsl(330,82%,45%)]">
                    <Package className="size-5" />
                    Manage Deliveries
                  </Button>
                </Link>
                <a
                  href="https://sterlinglams.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="lg" className="gap-2 border-[hsl(330,82%,52%)] px-8 text-[hsl(330,82%,52%)] hover:bg-[hsl(330,82%,52%)]/10">
                    Visit Sterlinglams Store
                    <ExternalLink className="size-4" />
                  </Button>
                </a>
              </div>
            </div>

            {/* Image Column – flush to top so head is visible */}
            <div className="relative mx-auto w-full max-w-lg lg:max-w-none lg:-mt-16 lg:-mb-16">
              <Image
                src="/delivery-hero.png"
                alt="Sterlinglams Logistics delivery agent holding a branded package"
                width={600}
                height={700}
                className="h-auto w-full object-contain object-top"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Track Shipment Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/track-bg.png"
            alt="Sterlinglams delivery"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-8 lg:py-28">
          <div className="max-w-xl">
            <h2 className="text-3xl font-bold italic tracking-tight text-white sm:text-4xl">
              Track Shipment
            </h2>
            <form
              onSubmit={handleTrack}
              className="mt-6 flex flex-col gap-0 sm:flex-row"
            >
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Enter waybill number / Tracking ID"
                  value={trackingId}
                  onChange={(e) => setTrackingId(e.target.value)}
                  className="h-12 w-full rounded-l-md border-0 bg-white px-4 text-sm text-[hsl(0,0%,20%)] outline-none placeholder:text-[hsl(0,0%,55%)] sm:rounded-r-none rounded-r-md"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="h-12 rounded-r-md bg-[hsl(330,82%,52%)] px-8 text-sm font-semibold text-white hover:bg-[hsl(330,82%,45%)] sm:rounded-l-none rounded-l-md"
              >
                Track Now
              </Button>
            </form>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-[hsl(330,30%,97%)] py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[hsl(0,0%,8%)]">How It Works</h2>
            <p className="mt-3 text-[hsl(0,0%,45%)]">
              From checkout on Sterlinglams to your doorstep
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Order Placed",
                description:
                  "You shop on sterlinglams.com and complete your purchase. We receive your order automatically.",
              },
              {
                step: "02",
                title: "Dispatched & Tracked",
                description:
                  "Our team picks, packs, and dispatches your item. You get a tracking link with live GPS updates.",
              },
              {
                step: "03",
                title: "Safe Delivery",
                description:
                  "Your jewellery or accessories arrive securely packaged at your door — on time, every time.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-[hsl(330,82%,52%)] text-xl font-bold text-white">
                  {item.step}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[hsl(0,0%,10%)]">{item.title}</h3>
                <p className="text-sm leading-relaxed text-[hsl(0,0%,45%)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[hsl(330,8%,90%)] bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[hsl(0,0%,8%)]">Why We&apos;re Trusted</h2>
            <p className="mt-3 text-[hsl(0,0%,45%)]">
              Built exclusively for Sterlinglams customers
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Clock,
                title: "Same-Day Dispatch",
                description: "Orders placed before 2 PM are dispatched the same day.",
              },
              {
                icon: MapPin,
                title: "Live GPS Tracking",
                description: "Follow your package in real-time from warehouse to doorstep.",
              },
              {
                icon: Shield,
                title: "Secure Packaging",
                description: "Jewellery and accessories are wrapped and insured for protection.",
              },
              {
                icon: Truck,
                title: "Dedicated Fleet",
                description: "Our riders handle only Sterlinglams orders — no third parties.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-[hsl(330,8%,90%)] bg-white p-6 text-center transition-shadow hover:shadow-lg hover:shadow-[hsl(330,82%,52%)]/10"
              >
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-[hsl(330,82%,52%)]/10">
                  <feature.icon className="size-6 text-[hsl(330,82%,52%)]" />
                </div>
                <h3 className="mb-2 font-semibold text-[hsl(0,0%,10%)]">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-[hsl(0,0%,45%)]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl px-8 py-16 text-center text-white">
            <Image
              src="/cta-bg.png"
              alt=""
              fill
              className="object-cover"
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-[hsl(0,0%,8%)]/40" />
            <div className="relative">
              <h2 className="text-3xl font-bold">Shop Sterlinglams Today</h2>
              <p className="mx-auto mt-4 max-w-xl text-white/70">
                Browse the full collection of jewellery, watches, and accessories.
                We&apos;ll take care of the delivery.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <a
                  href="https://sterlinglams.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="lg" className="gap-2 bg-[hsl(330,82%,52%)] px-8 text-white hover:bg-[hsl(330,82%,45%)]">
                    Visit Sterlinglams.com
                    <ExternalLink className="size-4" />
                  </Button>
                </a>
                <Link href="/login">
                  <Button size="lg" variant="outline" className="gap-2 border-white/30 bg-transparent px-8 text-white hover:bg-white/10 hover:text-white">
                    Admin Login
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[hsl(330,8%,90%)] bg-[hsl(0,0%,8%)] py-12 text-white">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-3">
            {/* Brand */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Image
                  src="/placeholder-logo.png"
                  alt="Sterlinglams"
                  width={60}
                  height={60}
                  className="rounded-lg"
                />
                <span className="text-base font-semibold">Sterlinglams Logistics</span>
              </div>
              <p className="text-sm leading-relaxed text-white/60">
                Official delivery partner of{" "}
                <a
                  href="https://sterlinglams.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[hsl(330,82%,52%)] hover:underline"
                >
                  sterlinglams.com
                </a>
              </p>
            </div>

            {/* Contact */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-white/80">Contact Us</h4>
              <a
                href="tel:+2349160009893"
                className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-[hsl(330,82%,52%)]"
              >
                <Phone className="size-4" />
                0916 000 9893
              </a>
              <a
                href="mailto:contact@sterlinglamslogistics.com"
                className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-[hsl(330,82%,52%)]"
              >
                <Mail className="size-4" />
                contact@sterlinglamslogistics.com
              </a>
            </div>

            {/* Social */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-white/80">Follow Us</h4>
              <div className="flex items-center gap-4">
                {/* Facebook */}
                <a
                  href="https://www.facebook.com/sterlinglams/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook"
                  className="flex size-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-[hsl(330,82%,52%)] hover:text-white"
                >
                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
                  </svg>
                </a>
                {/* Instagram */}
                <a
                  href="https://www.instagram.com/Sterlinglamsofficial/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="flex size-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-[hsl(330,82%,52%)] hover:text-white"
                >
                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.17.054 1.97.24 2.43.403a4.088 4.088 0 011.47.957c.453.454.793.918.957 1.47.163.46.349 1.26.403 2.43.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.054 1.17-.24 1.97-.403 2.43a4.088 4.088 0 01-.957 1.47 4.088 4.088 0 01-1.47.957c-.46.163-1.26.349-2.43.403-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.17-.054-1.97-.24-2.43-.403a4.088 4.088 0 01-1.47-.957 4.088 4.088 0 01-.957-1.47c-.163-.46-.349-1.26-.403-2.43C2.175 15.584 2.163 15.204 2.163 12s.012-3.584.07-4.85c.054-1.17.24-1.97.403-2.43a4.088 4.088 0 01.957-1.47A4.088 4.088 0 015.063 2.3c.46-.163 1.26-.349 2.43-.403C8.759 1.839 9.139 1.827 12 1.827V2.163zM12 0C8.741 0 8.333.014 7.053.072c-1.28.058-2.152.261-2.913.558a5.884 5.884 0 00-2.126 1.384A5.884 5.884 0 00.63 4.14C.333 4.901.13 5.773.072 7.053.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.058 1.28.261 2.152.558 2.913a5.884 5.884 0 001.384 2.126 5.884 5.884 0 002.126 1.384c.761.297 1.633.5 2.913.558C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c1.28-.058 2.152-.261 2.913-.558a5.884 5.884 0 002.126-1.384 5.884 5.884 0 001.384-2.126c.297-.761.5-1.633.558-2.913.058-1.28.072-1.688.072-4.948s-.014-3.668-.072-4.948c-.058-1.28-.261-2.152-.558-2.913a5.884 5.884 0 00-1.384-2.126A5.884 5.884 0 0019.861.63C19.1.333 18.228.13 16.948.072 15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                  </svg>
                </a>
                {/* TikTok */}
                <a
                  href="https://www.tiktok.com/@sterlinglams"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="TikTok"
                  className="flex size-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-[hsl(330,82%,52%)] hover:text-white"
                >
                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.84a4.86 4.86 0 01-1-.15z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 border-t border-white/10 pt-6 text-center">
            <p className="text-sm text-white/50">
              &copy; {new Date().getFullYear()} Sterlinglamslogistics. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

