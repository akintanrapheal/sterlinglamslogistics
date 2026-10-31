# driver-mobile-2 — full offline-first variant

Side-by-side experiment alongside the original `driver-mobile/`. Same UI,
different shipping model:

|                      | driver-mobile (original)              | driver-mobile-2 (this folder)             |
|----------------------|---------------------------------------|-------------------------------------------|
| What the APK loads   | `https://sterlinglamslogistics.com/driver` via WebView `server.url` | Local HTML/CSS/JS bundled inside the APK |
| Needs internet at cold launch? | Yes (offline.html shows otherwise) | **No** — the shell renders from local files |
| Needs internet for API calls?  | Yes                          | Yes (API calls go to the live server)     |
| Update story          | Push to `main` → Vercel deploys → all phones get it next launch | Rebuild APK, sideload to each driver |
| `appId`               | `com.sterlinglams.driver`              | `com.sterlinglams.driver` (driver-mobile has since been removed; this is the only driver app) |

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

### Why the default is the apex domain

`-ApiBase` defaults to `https://sterlinglamslogistics.com`.

It did not always. Drivers hit intermittent `403`s on the apex while it was
fronted by an edge that the Vercel origin sat behind — established at the
time by the apex resolving to Cloudflare, the Vercel origin not, and both
answering a token-less `/api/driver/profile` with a correct `401`. The `403`
was injected between the driver and the app, so the default moved to Vercel
to skip it. The exact rule was never identified; the likely trigger was the
custom User-Agent (`SterlinDriverApp2`, see `capacitor.config.ts`) matching
a bot-fight rule, which fits a per-request, "sometimes" failure.

Hosting has since moved to Netlify and the apex points there, so that edge
is no longer in the path. Before switching the default back, the apex was
checked for the three things the APK depends on:

- `/api/driver/location` and `/api/driver/trail` answer a token-less request
  with `401` — the routes exist and reject properly, rather than `404`
  (not deployed) or `403` (something in front of them)
- the CORS preflight returns `Access-Control-Allow-Origin: https://localhost`
  with `Access-Control-Allow-Credentials: true` — the APK's own origin
- `/api/maps-key` answers (`405` to a POST, since it is GET-only)

If drivers report `403`s again, this is the first thing to suspect, and
`-ApiBase "https://sterlinglamslogistics.vercel.app"` moves them off the apex
without any other change — both origins stay in `allowNavigation`.

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
