#!/bin/bash
# ============================================================================
# Clary Care — Post-deploy verification
# Usage:  ./verify-deployment.sh
#
# Returns 0 if all green, 1 if any check fails.
# ============================================================================
set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0
FAIL=0
WARN=0

check() {
  local name="$1"; local cmd="$2"; local expected="${3:-}"
  local out
  out=$(eval "$cmd" 2>&1)
  local rc=$?
  if [[ $rc -eq 0 ]] && [[ -z "$expected" || "$out" == *"$expected"* ]]; then
    echo -e "${GREEN}✓${NC} $name"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} $name"
    echo "    cmd: $cmd"
    echo "    out: ${out:0:200}"
    ((FAIL++))
  fi
}

warn_check() {
  local name="$1"; local cmd="$2"
  local out
  out=$(eval "$cmd" 2>&1)
  if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} $name"
    ((PASS++))
  else
    echo -e "${YELLOW}⚠${NC} $name (non-blocking)"
    ((WARN++))
  fi
}

echo "=== Clary Care — Post-deploy verification ==="
echo

# 1. DNS resolution
check "DNS: clary.uz resolves"        "getent hosts clary.uz"
check "DNS: app.clary.uz resolves"    "getent hosts app.clary.uz"
check "DNS: api.clary.uz resolves"    "getent hosts api.clary.uz"
check "DNS: patient.clary.uz resolves" "getent hosts patient.clary.uz"
check "DNS: admin.clary.uz resolves"  "getent hosts admin.clary.uz"

# 2. HTTPS reachable
check "HTTPS: clary.uz returns 2xx"           "curl -sf -o /dev/null -w '%{http_code}' https://clary.uz | grep -E '^(200|301|302)$'"
check "HTTPS: app.clary.uz returns 2xx"       "curl -sf -o /dev/null -w '%{http_code}' https://app.clary.uz | grep -E '^(200|301|302)$'"
check "HTTPS: patient.clary.uz returns 2xx"   "curl -sf -o /dev/null -w '%{http_code}' https://patient.clary.uz | grep -E '^(200|301|302)$'"

# 3. API health endpoint
check "API: /api/v1/health returns ok"   "curl -sf https://api.clary.uz/api/v1/health" "ok"

# 4. PM2 process status
check "pm2: clary-api online"            "pm2 list | grep clary-api | grep online"

# 5. Caddy running
check "systemd: caddy active"            "systemctl is-active caddy" "active"

# 6. Disk space (warn if < 10% free)
warn_check "Disk: > 10% free on /var"    "test \$(df /var | awk 'NR==2 {print 100-\$5+0}' | tr -d '%') -gt 10"

# 7. Memory (warn if < 200MB free)
warn_check "Memory: > 200MB free"        "test \$(free -m | awk 'NR==2 {print \$7}') -gt 200"

# 8. Recent api errors (last 100 log lines)
warn_check "PM2 logs: no recent ERROR"   "! pm2 logs clary-api --lines 100 --nostream --raw 2>/dev/null | grep -i 'fatal\\|exception' | grep -v 'getActiveShift'"

# 9. Static files served correctly
check "Static: clary.uz serves index.html"      "curl -sf https://clary.uz/ | grep -i '<html'"
check "Static: app.clary.uz serves index.html"  "curl -sf https://app.clary.uz/ | grep -i '<html'"

# 10. SSL cert valid (not expiring in <14 days)
warn_check "SSL: app.clary.uz cert > 14d valid" "echo | openssl s_client -servername app.clary.uz -connect app.clary.uz:443 2>/dev/null | openssl x509 -checkend 1209600 -noout"

echo
echo "=== Summary ==="
echo -e "${GREEN}Passed: $PASS${NC}"
[[ $WARN -gt 0 ]] && echo -e "${YELLOW}Warnings: $WARN${NC}"
[[ $FAIL -gt 0 ]] && echo -e "${RED}Failed: $FAIL${NC}"

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}✓ All critical checks passed${NC}"
  exit 0
else
  echo -e "${RED}✗ $FAIL critical check(s) failed${NC}"
  exit 1
fi
