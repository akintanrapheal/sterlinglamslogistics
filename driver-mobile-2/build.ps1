# driver-mobile-2 build script — produces an offline-first APK that
# runs entirely from local files. Pipeline:
#
#   1. Sync source files FROM the main project INTO source/
#      (components, lib, hooks, the driver app routes, globals.css).
#      Anything outside this script's allow-list is ignored, so we
#      don't accidentally pull in admin pages, API routes, or Sentry.
#
#   2. Adapt the copied driver routes for static export:
#      - The main project has them at app/(app)/driver/page.tsx etc.
#        Here we move them to app/page.tsx, app/dashboard/page.tsx, etc.
#      - Strip any server-only imports.
#
#   3. pnpm install + next build inside source/.
#      Output lands in source/out/.
#
#   4. Copy source/out/ over ../www/ (preserving the offline.html that
#      driver-mobile already ships).
#
#   5. npx cap sync android — registers the assets with the Capacitor
#      Android project.
#
#   6. (Optional) -Build flag also runs gradlew assembleRelease.
#
# Run from the driver-mobile-2/ folder:
#   .\build.ps1            # builds www/ only, leaves you ready to test
#                          # with Android Studio
#   .\build.ps1 -Build     # also assembles the release APK in
#                          # android/app/build/outputs/apk/release/

param(
    [switch]$Build,
    # Default to the Vercel origin rather than the apex domain. Drivers hit
    # intermittent 403s on the apex, which sits behind Cloudflare; the Vercel
    # origin does not, and both answer the API correctly otherwise. So the 403
    # comes from that edge. Hitting Vercel directly skips it. See README.md
    # ("Why the default is the Vercel origin") for what is and isn't confirmed.
    #
    # To go back to the Cloudflare-fronted apex:
    #   .\build.ps1 -ApiBase "https://sterlinglamslogistics.com"
    [string]$ApiBase = "https://sterlinglamslogistics.vercel.app"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mainRoot  = Split-Path -Parent $scriptDir
$srcRoot   = Join-Path $scriptDir "source"

Write-Host ""
Write-Host "==> driver-mobile-2 build" -ForegroundColor Cyan
Write-Host "    main project:  $mainRoot"
Write-Host "    sub-project:   $srcRoot"
Write-Host "    API base URL:  $ApiBase"
Write-Host ""

# 1. Sync source files from main project. We only copy what the driver
#    UI actually needs — keeps the static-export project clean and stops
#    Next.js trying to compile admin pages, API routes, Sentry config, etc.
Write-Host "[1/5] Syncing source from main project..." -ForegroundColor Yellow

# Folders to mirror wholesale.
$dirsToSync = @(
    @{ from = "components"; to = "components" }
    @{ from = "hooks";      to = "hooks" }
    @{ from = "lib";        to = "lib" }
    @{ from = "public";     to = "public" }
)

foreach ($pair in $dirsToSync) {
    $from = Join-Path $mainRoot $pair.from
    $to   = Join-Path $srcRoot  $pair.to
    if (Test-Path $to) { Remove-Item -Recurse -Force $to }
    if (Test-Path $from) {
        Copy-Item -Recurse -Force $from $to
    }
}

# globals.css from main project's app/
Copy-Item -Force (Join-Path $mainRoot "app/globals.css") (Join-Path $srcRoot "app/globals.css")

# 2. Adapt the driver routes. Main project lays them out as:
#    app/(app)/driver/page.tsx              -> source/app/page.tsx        (login)
#    app/(app)/driver/dashboard/page.tsx    -> source/app/dashboard/page.tsx
#    app/(app)/driver/order/[orderId]/...   -> source/app/order/[orderId]/...
# etc. We do a flat copy then move the contents up one level.
Write-Host "[2/5] Adapting driver routes for static export..." -ForegroundColor Yellow

$appDir = Join-Path $srcRoot "app"
# Remove any prior copy of the driver routes (keep layout.tsx + globals.css)
Get-ChildItem $appDir -Directory -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -notin @("api")  # api dir won't exist anyway; defensive
} | Remove-Item -Recurse -Force

$driverSrc = Join-Path $mainRoot "app/(app)/driver"
# layout.tsx is owned by the static-export sub-project (it has the
# required <html><body> + drops DriverSWRegister), so DON'T overwrite
# it from the main project's driver layout.
$skipNames = @(".idea", "layout.tsx")
if (Test-Path $driverSrc) {
    Get-ChildItem $driverSrc -Force | ForEach-Object {
        if ($skipNames -contains $_.Name) { return }
        $dest = Join-Path $appDir $_.Name
        Copy-Item -Recurse -Force $_.FullName $dest
    }
}

# 2.5. Strip the "/driver" URL prefix from the copied source. The live web
#      build serves the driver app at /driver/* (router.push("/driver/dashboard"),
#      Link href="/driver/order?id=...", etc.), but the static-export bundle
#      sits at the WebView root with no prefix — so every navigation call
#      needs to be rewritten before next build runs.
#
# Rules
#  - "/driver/X"  ->  "/X"   (router URLs, Link hrefs)
#  - "/driver"    ->  "/"    (login URL, exact-match path comparisons)
#  - /api/driver/* is LEFT ALONE because /api/driver/orders etc. are API
#    paths, not router routes (the lookbehind keeps them intact).
#  - root-shell.tsx is skipped because it's marketing/admin chrome that's
#    dead code in the APK bundle but still has /driver/ literals.
Write-Host "[2.5/5] Stripping /driver URL prefix from copied source..." -ForegroundColor Yellow
$filesToTransform = Get-ChildItem -Path $srcRoot -Recurse -Include "*.ts","*.tsx" -Force | Where-Object {
    $_.FullName -notlike "*\node_modules\*" -and
    $_.FullName -notlike "*\out\*" -and
    $_.FullName -notlike "*\.next\*" -and
    $_.Name -ne "root-shell.tsx"
}
foreach ($file in $filesToTransform) {
    $content = [System.IO.File]::ReadAllText($file.FullName)
    $original = $content
    # "/driver/..." -> "/..." but NOT "/api/driver/..."
    $content = [regex]::Replace($content, '(?<!/api)/driver/', '/')
    # /driver" -> /"   (closing the string, exact-match cases)
    $content = $content.Replace('/driver"', '/"')
    # /driver' -> /'
    $content = $content.Replace("/driver'", "/'")
    # /driver` -> /`  (template literal ending right at /driver)
    $content = $content.Replace('/driver`', '/`')
    if ($content -ne $original) {
        [System.IO.File]::WriteAllText($file.FullName, $content)
    }
}

# 2.6. Drop the /driver service worker + manifest from public/ — those
#      are for the live web build (where the WebView loads the remote
#      URL through the SW). In the bundled APK the assets are local;
#      keeping the SW around just confuses the WebView.
$srcPublicDriver = Join-Path $srcRoot "public\driver"
if (Test-Path $srcPublicDriver) {
    Remove-Item -Recurse -Force $srcPublicDriver
}

# 3. Build the static export with API base baked in
Write-Host "[3/5] Installing source/ dependencies..." -ForegroundColor Yellow
Push-Location $srcRoot
try {
    if (Test-Path "node_modules") {
        Write-Host "    (node_modules exists, skipping install)"
    } else {
        & pnpm install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    }

    Write-Host ""
    Write-Host "[4/5] Running next build (output: 'export')..." -ForegroundColor Yellow
    $env:NEXT_PUBLIC_API_BASE_URL = $ApiBase
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw "next build failed" }
} finally {
    Pop-Location
}

# 4. Copy out/ over ../www/ — preserve offline.html (still useful for any
#    transient WebView crash) but wipe stale assets.
Write-Host "[5/5] Copying out/ -> www/ and syncing Capacitor..." -ForegroundColor Yellow
$wwwDir = Join-Path $scriptDir "www"
$outDir = Join-Path $srcRoot "out"
$preservedOffline = Join-Path $scriptDir "_offline.html.tmp"
if (Test-Path (Join-Path $wwwDir "offline.html")) {
    Copy-Item -Force (Join-Path $wwwDir "offline.html") $preservedOffline
}
if (Test-Path $wwwDir) { Remove-Item -Recurse -Force $wwwDir }
Copy-Item -Recurse -Force $outDir $wwwDir
if (Test-Path $preservedOffline) {
    Move-Item -Force $preservedOffline (Join-Path $wwwDir "offline.html")
}

# 5. cap sync android — registers www/ assets with the Android scaffold
Push-Location $scriptDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "    (running npm install for Capacitor deps first)"
        & npm install
    }
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync android failed" }
} finally {
    Pop-Location
}

if ($Build) {
    Write-Host ""
    Write-Host "[+] Building release APK (gradle)..." -ForegroundColor Cyan
    Push-Location (Join-Path $scriptDir "android")
    try {
        & .\gradlew.bat assembleRelease
        if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease failed" }
    } finally {
        Pop-Location
    }
    $apk = Join-Path $scriptDir "android\app\build\outputs\apk\release\app-release.apk"
    if (Test-Path $apk) {
        Write-Host ""
        Write-Host "✓ APK ready: $apk" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "✓ driver-mobile-2 build complete" -ForegroundColor Green
