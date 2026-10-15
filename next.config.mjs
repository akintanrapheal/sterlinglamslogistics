import path from "node:path"
import { fileURLToPath } from "node:url"
import { withSentryConfig } from "@sentry/nextjs"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" is for self-hosting (Docker / the Oracle VM deploy). Netlify's Next.js runtime builds
  // and routes the app itself and does NOT want a standalone output, so skip it when building on Netlify.
  output: process.env.NETLIFY ? undefined : "standalone",
  turbopack: {
    root: rootDir,
    resolveAlias: {
      tailwindcss: path.resolve(rootDir, "node_modules/tailwindcss"),
      "tw-animate-css": path.resolve(rootDir, "node_modules/tw-animate-css"),
    },
  },
  images: {
    unoptimized: true,
  },
  ...(process.env.NODE_ENV === "development" && {
    allowedDevOrigins: ["192.168.1.222"],
  }),
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,
})
