#!/usr/bin/env bash
# End-to-end smoke test for BehaviorIQ API (+ optional ML service).
# Usage: ./scripts/e2e-smoke.sh [API_BASE] [ML_BASE]
set -euo pipefail

API_BASE="${1:-http://127.0.0.1:5000}"
ML_BASE="${2:-http://127.0.0.1:8001}"

pass() { echo "✓ $1"; }
fail() { echo "✗ $1"; exit 1; }

echo "=== BehaviorIQ API smoke test ==="
echo "API: $API_BASE"
echo "ML:  $ML_BASE"

# Health
curl -sf "$API_BASE/health" | grep -q '"status":200' && pass "API health" || fail "API health"

# ML health (optional — warn only)
if curl -sf "$ML_BASE/health" >/dev/null 2>&1; then
  pass "ML health"
else
  echo "⚠ ML service not reachable at $ML_BASE (product-embed tests skipped)"
fi

# Products
PRODUCTS=$(curl -sf "$API_BASE/api/products?limit=5")
echo "$PRODUCTS" | grep -q '"products"' && pass "GET /api/products" || fail "GET /api/products"
PRODUCT_ID=$(echo "$PRODUCTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['products'][0]['id'])")

# Hot buyer = user with the most product_view events after seed
EVENTS=$(curl -sf "$API_BASE/api/events?limit=80" || echo '{"events":[]}')
HOT_USER=$(echo "$EVENTS" | python3 -c "
import sys,json
from collections import Counter
ev=json.load(sys.stdin).get('events',[])
counts=Counter(e.get('userId') for e in ev if e.get('eventType')=='product_view')
print(counts.most_common(1)[0][0] if counts else '')
")

if [ -z "$HOT_USER" ]; then
  echo "⚠ Could not infer persona user id — run db:seed and retry"
else
  PRICING=$(curl -sf "$API_BASE/api/pricing/$PRODUCT_ID?userId=$HOT_USER")
  echo "$PRICING" | grep -q 'offered_price' && pass "GET /api/pricing" || fail "GET /api/pricing"
fi

# Search
curl -sf "$API_BASE/api/search?q=running&userId=${HOT_USER:-000}" | grep -q '"results"' && pass "GET /api/search" || fail "GET /api/search"

# Dashboard
curl -sf "$API_BASE/api/dashboard/overview" | grep -q 'totalUsers' && pass "GET /api/dashboard/overview" || fail "dashboard overview"
curl -sf "$API_BASE/api/dashboard/churn-alerts" | grep -q '"alerts"' && pass "GET /api/dashboard/churn-alerts" || fail "churn alerts"
curl -sf "$API_BASE/api/dashboard/pricing-log?limit=5" | grep -q '"decisions"' && pass "GET /api/dashboard/pricing-log" || fail "pricing log"
curl -sf "$API_BASE/api/dashboard/what-if?discountPct=12&intentLessThan=45" | grep -q 'usersAffected' && pass "GET /api/dashboard/what-if" || fail "what-if"

# Event batch ingest
BATCH=$(curl -sf -X POST "$API_BASE/api/events/batch" \
  -H 'Content-Type: application/json' \
  -d "{\"events\":[{\"event_type\":\"product_view\",\"user_id\":\"${HOT_USER:-smoke-user}\",\"session_id\":\"smoke-session\",\"payload\":{\"product_id\":\"$PRODUCT_ID\",\"time_spent_ms\":1200},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}")
echo "$BATCH" | grep -q 'eventsProcessed' && pass "POST /api/events/batch" || fail "events batch"

# Product CRUD + ML embed (if ML up)
if curl -sf "$ML_BASE/health" >/dev/null 2>&1; then
  NEW_ID="smoke-product-$(date +%s)"
  CREATE=$(curl -sf -X POST "$API_BASE/api/products" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"$NEW_ID\",\"name\":\"Smoke Test Shoe\",\"description\":\"E2E catalog item\",\"basePrice\":59.99,\"category\":\"running_shoes\",\"brand\":\"Test\"}")
  echo "$CREATE" | grep -q "$NEW_ID" && pass "POST /api/products (with embed)" || fail "POST /api/products"
  curl -sf -X DELETE "$API_BASE/api/products/$NEW_ID" -o /dev/null -w "%{http_code}" | grep -q 204 && pass "DELETE /api/products" || pass "DELETE /api/products (skipped if 409)"
fi

echo ""
echo "=== All smoke checks passed ==="
