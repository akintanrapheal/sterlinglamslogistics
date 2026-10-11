#!/usr/bin/env bash
# Pull the latest code and redeploy. Run from the repo on the server: bash deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Pulling latest…"
git pull --ff-only

echo "→ Installing deps…"
corepack enable
pnpm install --no-frozen-lockfile

echo "→ Building…"
pnpm build

echo "→ Restarting service…"
sudo systemctl restart sterlinglamslogistics

echo "✓ Deployed."
sudo systemctl --no-pager --lines=0 status sterlinglamslogistics | head -5
