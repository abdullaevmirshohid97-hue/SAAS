#!/bin/bash
# ============================================================================
# Clary v2 — One-click production deploy
# Usage: ./deploy.sh [api|web|all]   (default: all)
# ============================================================================
set -euo pipefail

REPO_DIR="/opt/clary"
WEB_CLINIC_DIST="/var/www/app"
WEB_PATIENT_DIST="/var/www/patient"
WEB_ADMIN_DIST="/var/www/admin"
WEB_LANDING_DIST="/var/www/landing"

TARGET="${1:-all}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

cd "$REPO_DIR"

log "Pulling latest from GitHub..."
git pull --ff-only origin main
ok "Repo synced"

log "Installing dependencies..."
pnpm install --frozen-lockfile
ok "Dependencies ready"

deploy_api() {
  log "Building API..."
  pnpm --filter api build
  ok "API built"

  log "Restarting clary-api (pm2)..."
  pm2 restart clary-api --update-env
  ok "API restarted"
}

deploy_web_clinic() {
  log "Building web-clinic..."
  pnpm --filter web-clinic build

  log "Deploying to $WEB_CLINIC_DIST..."
  mkdir -p "$WEB_CLINIC_DIST"
  rm -rf "$WEB_CLINIC_DIST"/*
  cp -r apps/web-clinic/dist/* "$WEB_CLINIC_DIST/"
  ok "web-clinic deployed → app.clary.uz"
}

deploy_web_patient() {
  log "Building web-patient..."
  pnpm --filter web-patient build

  log "Deploying to $WEB_PATIENT_DIST..."
  mkdir -p "$WEB_PATIENT_DIST"
  rm -rf "$WEB_PATIENT_DIST"/*
  cp -r apps/web-patient/dist/* "$WEB_PATIENT_DIST/"
  ok "web-patient deployed → patient.clary.uz"
}

deploy_web_admin() {
  if [[ -d "apps/web-admin" ]]; then
    log "Building web-admin..."
    pnpm --filter web-admin build

    log "Deploying to $WEB_ADMIN_DIST..."
    mkdir -p "$WEB_ADMIN_DIST"
    rm -rf "$WEB_ADMIN_DIST"/*
    cp -r apps/web-admin/dist/* "$WEB_ADMIN_DIST/"
    ok "web-admin deployed → admin.clary.uz"
  else
    warn "web-admin not found, skipping"
  fi
}

reload_caddy() {
  if command -v caddy &> /dev/null; then
    log "Validating Caddyfile..."
    caddy validate --config /etc/caddy/Caddyfile && \
      caddy reload --config /etc/caddy/Caddyfile && \
      ok "Caddy reloaded" || warn "Caddy reload failed (check Caddyfile)"
  fi
}

case "$TARGET" in
  api)
    deploy_api
    ;;
  web|web-clinic)
    deploy_web_clinic
    ;;
  patient|web-patient)
    deploy_web_patient
    ;;
  admin|web-admin)
    deploy_web_admin
    ;;
  caddy)
    reload_caddy
    ;;
  all)
    deploy_api
    deploy_web_clinic
    deploy_web_patient
    deploy_web_admin
    reload_caddy
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: ./deploy.sh [api|web|patient|admin|caddy|all]"
    exit 1
    ;;
esac

ok "🚀 Deploy completed successfully"
