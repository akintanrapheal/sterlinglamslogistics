# driver-mobile-2 — full offline-first variant

Side-by-side experiment alongside the original `driver-mobile/`. Same UI,
different shipping model:

|                      | driver-mobile (original)              | driver-mobile-2 (this folder)             |
|----------------------|---------------------------------------|-------------------------------------------|
| What the APK loads   | `https://sterlinglamslogistics.com/driver` via WebView `server.url` | Local HTML/CSS/JS bundled inside the APK |
| Needs internet at cold launch? | Yes (offline.html shows otherwise) | **No** — the shell renders from local files |
| Needs internet for API calls?  | Yes                          | Yes (API calls go to the live server)     |
| Update story          | Push to `main` → Vercel deploys → all phones get it next launch | Rebuild APK, sideload to each driver |
| `appId`               | `com.sterlinglams.driver`              | `com.sterlinglams.driver2` (so the two installs co-exist on one phone) |

You can install both APKs on the same phone and compare them flow-by-flow.

## How it works (overview)

```
main project /app/(app)/driver/*  ──►  driver-mobile-2/source/app/*
            /components/*         ──►  driver-mobile-2/source/components/*
            /lib/*                ──►  driver-mobile-2/source/lib/*
            /hooks/*              ──►  driver-mobile-2/source/hooks/*

driver-mobile-2/source/                 next build (output: 'export')
    ├── app/                    ──►     out/
    ├── components/
    ├── lib/
    └── ...

driver-mobile-2/                        cap sync android
    ├── www/    ◄── out/                Android scaffold copies www/
    │                                   into app/src/main/assets/public
    └── android/                ──►     gradlew assembleRelease
                                         ──► app-release.apk
```

The build script (`build.ps1`) automates all of the above.

## Prerequisites (one time)

- Node 20+ and pnpm 9+ on PATH (same as the main project).
- Android SDK + JDK 17 already set up via `local.properties` (this folder
  inherits the same setup `driver-mobile/` has).
- The `driver-test.keystore` from `driver-mobile/android/` is already
  copied here, so signing works out of the box.

## Daily workflow

After every UI change in the main project (anything under
`app/(app)/driver/`, `components/`, `lib/`, `hooks/`):

```powershell
cd "c:\Users\user\Downloads\sterlinglamslogistics-main\sterlinglamslogistics-main\driver-mobile-2"
.\build.ps1 -Build
```

The `-Build` flag also runs `gradlew assembleRelease`. Skip it to just
prepare `www/` + sync Capacitor without producing an APK (useful for
debugging in Android Studio).

When it finishes you'll find the signed APK at:

```
driver-mobile-2\android\app\build\outputs\apk\release\app-release.apk
```

Sideload it on a driver phone alongside the original driver-mobile.

## What the build script does, step by step

1. **Sync sources from the main project** — copies `components/`,
   `hooks/`, `lib/`, `public/`, and `app/globals.css` into `source/`,
   so you never have to keep two copies of anything in sync by hand.
2. **Adapt driver routes** — pulls every child of
   `app/(app)/driver/` and drops it at the top of `source/app/`, so
   `dashboard/page.tsx` becomes `source/app/dashboard/page.tsx`. That
   matches the URL shape the static export will serve from `file://`.
3. **`pnpm install` + `next build`** inside `source/`. Output is
   `source/out/` (pure HTML/CSS/JS, no Node server needed).
4. **Copy `out/` over `www/`** — preserves the bundled `offline.html`
   in case the WebView ever crashes the SPA and needs a fallback.
5. **`npx cap sync android`** — registers the new `www/` with the
   Android project under `app/src/main/assets/public/`.
6. *(optional)* `gradlew assembleRelease` if you passed `-Build`.

## API calls

The static-export bundle runs from a `file://` (or `https://localhost`)
origin, where the `/api/driver/*` routes don't exist. To keep API calls
working, the build script sets `NEXT_PUBLIC_API_BASE_URL` at compile
time, and `lib/driver-client.ts`'s `driverFetch` prepends that base to
any path-relative request. If you ever need to point at a staging server,
pass `-ApiBase "https://staging.example.com"` to `build.ps1`.

### Why the default is the Vercel origin

`-ApiBase` defaults to `https://sterlinglamslogistics.vercel.app`, **not**
the apex `https://sterlinglamslogistics.com`, because drivers hit
intermittent `403`s on the apex.

What is established: the apex resolves to Cloudflare (`Server: cloudflare`),
the Vercel origin does not, and the app itself is not the source — both
origins answer a token-less `/api/driver/profile` with a correct `401` and
a correct CORS preflight. So the `403` is injected by an edge that only
exists in front of the apex.

What is *not* confirmed: the exact Cloudflare rule. The likely trigger is
the custom User-Agent — the WebView appends `SterlinDriverApp2` (see
`capacitor.config.ts`) — flagged by bot-fight/WAF rules, which would explain
a per-request, "sometimes" failure. This has not been reproduced on demand;
to confirm it, check the Cloudflare dashboard's Security Events for blocked
requests to `/api/driver/*` and read the rule that matched.

Talking to Vercel directly skips that edge. The trade-off is that you also
skip Cloudflare's caching and DDoS protection for driver API traffic — an
acceptable deal for a handful of authenticated drivers, but reconsider it
if the driver fleet grows a lot.

The cleaner long-term fix is a Cloudflare WAF skip rule for the driver
app's User-Agent (or its `X-Driver-Token` header), which would let the
apex work and keep the protection. Once that rule exists, flip the default
back with `-ApiBase "https://sterlinglamslogistics.com"`. Both origins are
already in `allowNavigation`, so no other change is needed.

Note this only affects the **bundled APK**. The web app at the apex is
same-origin and leaves `NEXT_PUBLIC_API_BASE_URL` empty, so it is
unaffected either way.

## Rolling back

If something behaves worse than the original driver-mobile, just install
the original APK back. The two `appId`s differ, so neither uninstall
nor reinstall affects the other. driver-mobile-2 is purely additive —
the main project is unchanged except for the small `driverFetch`
absolute-base-URL hook, which is a no-op for any same-origin build.

## What's NOT in here yet

- Live updates (every code change still requires a new APK). Drop in
  Capacitor Live Updates / `@capgo/capacitor-updater` later if drivers
  are getting fed up with reinstalls.
- A signed release-track keystore for the Play Store (right now we use
  the same dev keystore the original uses).

## Common failure modes

- `next build` complains about a server-only import (`adminDb`, Sentry,
  Firebase Admin, `fs`, `path`). The build script's sync step is meant
  to leave those behind, but if a driver page accidentally imports one,
  you'll see the error here. Fix is to gate the import behind a `"use
  client"` check or move the function call inside an effect/handler.
- `Module not found: tw-animate-css`. Run `pnpm install` inside
  `source/` once.
- White screen in the APK with no errors. Open Chrome DevTools and
  remote-inspect the WebView (`chrome://inspect/#devices`). 99% of the
  time it's a stray `window.location.href = "/driver/..."` that no
  longer resolves; switch to `router.push("/dashboard")` or similar.
