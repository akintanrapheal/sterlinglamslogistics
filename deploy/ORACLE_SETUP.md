# Hosting sterlinglamslogistics on Oracle Cloud (Always Free)

A one-time setup to run this Next.js app for free, forever, on an Oracle "Always Free"
ARM VM. You manage a small Linux server; after this, deploys are one command.

**You'll need:** an Oracle Cloud account, a domain you can edit DNS for, and the env
values from your current Vercel project (Settings → Environment Variables).

---

## 1. Create the VM (Oracle console)

1. Sign up at **cloud.oracle.com** (a card is required for identity verification; the
   Always Free resources are never charged). Pick a home region close to Nigeria
   (e.g. **UK South (London)** or **Germany Central (Frankfurt)**).
2. **Menu → Compute → Instances → Create instance.**
   - **Image:** Canonical **Ubuntu 22.04**.
   - **Shape:** Change shape → **Ampere (ARM) → VM.Standard.A1.Flex**, set **2 OCPU /
     12 GB** (well inside Always Free; the 12 GB is needed so the Next build doesn't run
     out of memory). *If you see "out of capacity", try another Availability Domain or
     region — A1 capacity comes and goes.*
   - **SSH keys:** let it generate a key pair and **download the private key** (you'll
     use it to connect).
   - Create. Note the instance's **Public IP address**.

## 2. Open the firewall (two places — both are required)

**a) Oracle VCN security list:** Instance → its **Subnet** → **Security List** →
**Add Ingress Rules**, source `0.0.0.0/0`, for **TCP 80** and **TCP 443**.

**b) The VM's own firewall** (Oracle's Ubuntu image blocks ports by default). SSH in
(next step) and run:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Connect

From your PC (PowerShell), with the key you downloaded:
```bash
ssh -i path\to\your-key.key ubuntu@YOUR_PUBLIC_IP
```

## 4. Install Node 22, pnpm, Caddy, git

```bash
sudo apt update && sudo apt -y upgrade
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
# pnpm (matches the repo's packageManager)
sudo corepack enable && corepack prepare pnpm@9.15.4 --activate
# Caddy (reverse proxy + automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 5. Get the code and configure it

```bash
cd ~
git clone https://github.com/akintanrapheal/sterlinglamslogistics.git
cd sterlinglamslogistics
cp .env.example .env
nano .env          # paste every value from Vercel (see .env.example for the list)
```
Set `NEXT_PUBLIC_SITE_ORIGIN` / `NEXT_PUBLIC_API_BASE_URL` to your real domain
(`https://your-domain.com`). `FIREBASE_SERVICE_ACCOUNT_KEY` goes on **one line**.

## 6. Build and run

```bash
pnpm install --no-frozen-lockfile
pnpm build                         # public NEXT_PUBLIC_* vars are baked in here
# install the service
sudo cp deploy/sterlinglamslogistics.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sterlinglamslogistics
sudo systemctl status sterlinglamslogistics   # should be "active (running)"
```
The app is now listening on `localhost:3000`.

## 7. Domain + HTTPS (Caddy)

1. At your DNS provider, add an **A record** for your domain → the VM's **Public IP**.
2. Point Caddy at it:
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo nano /etc/caddy/Caddyfile     # replace your-domain.com with your real domain
   sudo systemctl reload caddy
   ```
Caddy fetches and auto-renews the HTTPS certificate. Open `https://your-domain.com`.

## 8. The daily cron (replaces the Vercel cron)

The app used a Vercel cron to prune audit logs daily. Recreate it as a system cron that
calls the same endpoint with your `CRON_SECRET`:
```bash
( crontab -l 2>/dev/null; echo '0 3 * * * curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain.com/api/admin/prune-audit-logs >/dev/null' ) | crontab -
```
Use the same `CRON_SECRET` value you put in `.env`.

---

## Updating later

```bash
cd ~/sterlinglamslogistics && bash deploy/deploy.sh
```
(pulls, installs, builds, restarts the service.)

## Troubleshooting

- **Build killed / out of memory:** add swap, then rebuild:
  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **Site unreachable:** re-check both firewalls in step 2 and that the A record points
  at the right IP (`dig your-domain.com`).
- **Logs:** `journalctl -u sterlinglamslogistics -f` (app) and `journalctl -u caddy -f` (proxy).
