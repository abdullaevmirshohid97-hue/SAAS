#!/bin/bash
# ============================================================================
# Clary v2 — Docker production deploy script (Hostinger VPS)
# Usage:
#   ./deploy-docker.sh             # full deploy (pull + build + restart)
#   ./deploy-docker.sh logs [svc]  # tail logs (default: all)
#   ./deploy-docker.sh status      # container health
#   ./deploy-docker.sh stop        # stop the stack
#   ./deploy-docker.sh restart [svc]
#   ./deploy-docker.sh rebuild [svc]
# ============================================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$REPO_DIR/infra/docker/docker-compose.prod.yml"
ENV_FILE="$REPO_DIR/.env.production"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${BLUE}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

dc() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

require_env() {
  [[ -f "$ENV_FILE" ]] || err ".env.production not found. Copy .env.production.example and fill in values."
}

cmd_deploy() {
  require_env

  log "Pulling latest from origin/main..."
  cd "$REPO_DIR"
  git fetch origin main
  git reset --hard origin/main
  ok "Repo synced to $(git rev-parse --short HEAD)"

  log "Building images..."
  dc build --pull
  ok "Build complete"

  log "Starting stack..."
  dc up -d --remove-orphans
  ok "Stack up"

  log "Waiting for API health (max 60s)..."
  for i in {1..30}; do
    if dc exec -T api wget -qO- http://localhost:4000/health 2>/dev/null | grep -q '"status"'; then
      ok "API healthy"
      break
    fi
    if [[ $i -eq 30 ]]; then
      warn "API health check did not pass within 60s — check ./deploy-docker.sh logs api"
      break
    fi
    sleep 2
  done

  log "Pruning old images..."
  docker image prune -f >/dev/null
  ok "Pruned"

  echo
  ok "🚀 Deploy complete"
  echo
  cmd_status
}

cmd_logs() {
  require_env
  if [[ $# -gt 0 ]]; then
    dc logs -f --tail=200 "$@"
  else
    dc logs -f --tail=100
  fi
}

cmd_status() {
  require_env
  echo
  echo "=== Containers ==="
  dc ps
  echo
  echo "=== Disk ==="
  docker system df
}

cmd_stop() {
  require_env
  log "Stopping stack..."
  dc down
  ok "Stopped"
}

cmd_restart() {
  require_env
  if [[ $# -gt 0 ]]; then
    log "Restarting $1..."
    dc restart "$1"
  else
    log "Restarting all services..."
    dc restart
  fi
  ok "Restarted"
}

cmd_rebuild() {
  require_env
  if [[ $# -gt 0 ]]; then
    log "Rebuilding $1..."
    dc build --no-cache "$1"
    dc up -d "$1"
  else
    log "Rebuilding all services (no cache)..."
    dc build --no-cache --pull
    dc up -d --remove-orphans
  fi
  ok "Rebuild complete"
}

# ----- Dispatch -------------------------------------------------------------
ACTION="${1:-deploy}"
shift || true

case "$ACTION" in
  deploy)  cmd_deploy ;;
  logs)    cmd_logs "$@" ;;
  status)  cmd_status ;;
  stop)    cmd_stop ;;
  restart) cmd_restart "$@" ;;
  rebuild) cmd_rebuild "$@" ;;
  *)
    cat <<EOF
Usage: $0 [deploy|logs|status|stop|restart|rebuild] [service]

Examples:
  $0                       # full deploy (default)
  $0 logs api              # tail api logs
  $0 logs                  # tail all logs
  $0 status                # show container health
  $0 restart caddy         # restart just caddy
  $0 rebuild web-clinic    # rebuild & restart web-clinic from scratch
  $0 stop                  # stop everything
EOF
    exit 1
    ;;
esac
