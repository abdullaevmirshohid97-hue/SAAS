#!/bin/bash
# ============================================================================
# Clary Care — One-shot server bootstrap
# Usage:  ./bootstrap-server.sh
#
# What it does:
#   1. Pulls latest code
#   2. Installs deps
#   3. Validates required env vars in /opt/clary/.env.local
#   4. Patches /etc/caddy/Caddyfile (replaces 127.0.0.1 with current SSH client IP for admin block)
#   5. Builds + deploys all 4 web apps + api
#   6. Reloads Caddy
#   7. Restarts pm2 with new env
#   8. Runs verify-deployment.sh
# ============================================================================
set -euo pipefail

REPO_DIR="/opt/clary"
ENV_FILE="$REPO_DIR/.env.local"
CADDY_FILE="/etc/caddy/Caddyfile"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${BLUE}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

cd "$REPO_DIR" || err "REPO_DIR $REPO_DIR not found"

# 1. Pull latest -------------------------------------------------------------
log "Step 1/8 — Pulling latest from GitHub..."
git pull --ff-only origin main || err "git pull failed"
ok "Repo synced ($(git rev-parse --short HEAD))"

# 2. Install deps -----------------------------------------------------------
log "Step 2/8 — Installing dependencies..."
pnpm install --frozen-lockfile >/dev/null 2>&1 || err "pnpm install failed"
ok "Dependencies ready"

# 3. Validate env -----------------------------------------------------------
log "Step 3/8 — Validating $ENV_FILE..."
if [[ ! -f "$ENV_FILE" ]]; then
  err "$ENV_FILE missing. Create it first (see docs/PRODUCTION-CHECKLIST.md section 4)"
fi

REQUIRED_VARS=(
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_JWT_SECRET
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
)
OPTIONAL_VARS=(
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  ESKIZ_EMAIL
  ESKIZ_PASSWORD
  API_PUBLIC_URL
)
MISSING=()
for v in "${REQUIRED_VARS[@]}"; do
  if ! grep -qE "^${v}=.+" "$ENV_FILE"; then
    MISSING+=("$v")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  err "Missing/empty REQUIRED env vars in $ENV_FILE: ${MISSING[*]}"
fi
ok "All ${#REQUIRED_VARS[@]} required env vars present"

# Optional vars — warn only, don't block deploy
OPT_MISSING=()
for v in "${OPTIONAL_VARS[@]}"; do
  if ! grep -qE "^${v}=.+" "$ENV_FILE"; then
    OPT_MISSING+=("$v")
  fi
done
if [[ ${#OPT_MISSING[@]} -gt 0 ]]; then
  warn "Optional env vars missing (features disabled): ${OPT_MISSING[*]}"
fi

# 4. Patch Caddyfile admin IP -----------------------------------------------
log "Step 4/8 — Patching Caddyfile admin IP allowlist..."

# Admin allowlist IPs come from .env.local (ADMIN_ALLOWED_IPS, space or
# comma separated). SSH_CLIENT is unreliable behind NAT / proxies (it can
# report a link-local 169.254.x.x), so we never trust it.
ADMIN_IPS_RAW="$(grep -E '^ADMIN_ALLOWED_IPS=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' | tr ',' ' ')"
# Sanitize: keep only valid IPv4 tokens (0-255 octets). Drops garbage,
# newlines, sed-breaking characters, accidental shell text.
ADMIN_IPS=""
for tok in $ADMIN_IPS_RAW; do
  if [[ "$tok" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    ADMIN_IPS="${ADMIN_IPS:+$ADMIN_IPS }$tok"
  fi
done
if [[ -z "$ADMIN_IPS" ]]; then
  # Fallback to SSH_CLIENT, but skip link-local / private noise.
  SSH_IP="${SSH_CLIENT%% *}"
  if [[ "$SSH_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] && \
     [[ ! "$SSH_IP" =~ ^(169\.254\.|127\.|10\.|192\.168\.) ]]; then
    ADMIN_IPS="$SSH_IP"
    warn "ADMIN_ALLOWED_IPS not set in .env.local — using SSH_CLIENT IP $SSH_IP"
  else
    warn "ADMIN_ALLOWED_IPS not set and SSH_CLIENT unusable — admin.clary.uz will be 127.0.0.1 only"
  fi
fi

# Always copy fresh Caddyfile from repo, then patch
cp "$REPO_DIR/infra/caddy/Caddyfile" "$CADDY_FILE"

# Replace TODO line with actual IPs (idempotent — works even if already replaced)
if grep -q "127.0.0.1 # TODO: add YOUR_HOME_IP YOUR_OFFICE_IP here" "$CADDY_FILE"; then
  REPLACEMENT="127.0.0.1${ADMIN_IPS:+ $ADMIN_IPS}"
  sed -i "s|127\.0\.0\.1 # TODO: add YOUR_HOME_IP YOUR_OFFICE_IP here|${REPLACEMENT}|" "$CADDY_FILE"
  ok "admin.clary.uz allowed for: ${REPLACEMENT}"
else
  warn "Caddyfile admin block already patched or template changed"
fi

caddy validate --config "$CADDY_FILE" >/dev/null 2>&1 || err "Caddyfile validation failed"
ok "Caddyfile valid"

# 5. Build + deploy all -----------------------------------------------------
log "Step 5/8 — Building and deploying all apps..."
chmod +x ./deploy.sh
./deploy.sh all || err "deploy.sh failed"
ok "All apps deployed"

# 6. Caddy reload (deploy.sh does this, but ensure it stuck) -----------------
log "Step 6/8 — Reloading Caddy..."
caddy reload --config "$CADDY_FILE" 2>&1 | grep -v 'reload_signal' || true
ok "Caddy reloaded"

# 7. PM2 restart with fresh env ---------------------------------------------
log "Step 7/8 — Restarting pm2 with fresh env..."
pm2 restart clary-api --update-env >/dev/null
sleep 2
pm2 list | grep clary-api
ok "API restarted"

# 7b. Ensure pm2-logrotate is installed (production log discipline)
if ! pm2 list | grep -q pm2-logrotate; then
  log "Installing pm2-logrotate (one-time)..."
  pm2 install pm2-logrotate >/dev/null 2>&1 || warn "pm2-logrotate install skipped"
  pm2 set pm2-logrotate:max_size 10M >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:retain 14 >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:rotateInterval '0 0 * * *' >/dev/null 2>&1 || true
  ok "pm2-logrotate configured (10M files, 14 day retention, daily rotate)"
fi

# 8. Verify ------------------------------------------------------------------
log "Step 8/8 — Running verification..."
if [[ -x "$REPO_DIR/verify-deployment.sh" ]]; then
  "$REPO_DIR/verify-deployment.sh" || warn "Some verification checks failed — see output above"
else
  chmod +x "$REPO_DIR/verify-deployment.sh" 2>/dev/null && "$REPO_DIR/verify-deployment.sh" || true
fi

ok "🚀 Bootstrap complete"
echo
echo "Next steps:"
echo "  1. Open https://clary.uz in your browser"
echo "  2. Test Google Sign-In on https://app.clary.uz"
echo "  3. Tail logs: pm2 logs clary-api"
