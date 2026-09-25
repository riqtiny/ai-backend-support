#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-demo-org-key}"
RUN_DOCKER_NLP="${RUN_DOCKER_NLP:-true}"
CLEANUP="${CLEANUP:-true}"

TEMP_DIR="$(mktemp -d)"
TICKET_ID=""
SMOKE_ORG_ID=""
CREATED_SMOKE_ORG=false

cleanup() {
  if [[ "$CLEANUP" != "true" || -z "$TICKET_ID" ]]; then
    rm -rf "$TEMP_DIR"
    return
  fi

  if command -v docker >/dev/null 2>&1 && docker compose ps --services 2>/dev/null | grep -qx db; then
    if [[ "$CREATED_SMOKE_ORG" == "true" && -n "$SMOKE_ORG_ID" ]]; then
      docker compose exec -T db psql -U postgres -d goodeva_desk -v ON_ERROR_STOP=1 \
        -c "DELETE FROM organizations WHERE id = '$SMOKE_ORG_ID';" >/dev/null 2>&1 || true
    fi
    docker compose exec -T db psql -U postgres -d goodeva_desk -v ON_ERROR_STOP=1 \
      -c "DELETE FROM tickets WHERE id = '$TICKET_ID';" >/dev/null 2>&1 || true
  fi

  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

pass() {
  printf '✅ %s\n' "$1"
}

warn() {
  printf '⚠️  %s\n' "$1"
}

die() {
  printf '❌ %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Command tidak ditemukan: $1"
}

http_call() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local api_key="${4:-}"
  local output_file="$TEMP_DIR/response.json"
  local -a args

  args=(-sS -o "$output_file" -w "%{http_code}" -X "$method" "$url")
  if [[ -n "$api_key" ]]; then
    args+=(-H "x-api-key: $api_key")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H "content-type: application/json" --data "$body")
  fi

  HTTP_STATUS="$(curl "${args[@]}" || true)"
  HTTP_BODY="$(cat "$output_file" 2>/dev/null || true)"
}

expect_status() {
  local expected="$1"
  local label="$2"
  if [[ "$HTTP_STATUS" != "$expected" ]]; then
    die "$label: expected HTTP $expected, got $HTTP_STATUS. Response: ${HTTP_BODY:0:500}"
  fi
}

json_field() {
  local path="$1"
  python3 -c '
import json
import sys

value = json.load(sys.stdin)
for part in sys.argv[1].split("."):
    value = value[int(part)] if isinstance(value, list) else value[part]
if value is None:
    print("")
elif isinstance(value, bool):
    print("true" if value else "false")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False))
else:
    print(value)
' "$path" <<<"$HTTP_BODY"
}

json_list_contains_id() {
  local target_id="$1"
  python3 -c '
import json
import sys

items = json.load(sys.stdin)
target = sys.argv[1]
raise SystemExit(0 if any(str(item.get("id")) == target for item in items) else 1)
' "$target_id" <<<"$HTTP_BODY"
}

assert_json_id_in_list() {
  local target_id="$1"
  local label="$2"
  if json_list_contains_id "$target_id"; then
    pass "$label"
  else
    die "$label: ticket $target_id tidak ditemukan di response list"
  fi
}

assert_json_id_not_in_list() {
  local target_id="$1"
  local label="$2"
  if json_list_contains_id "$target_id"; then
    die "$label: tenant lain berhasil melihat ticket $target_id"
  else
    pass "$label"
  fi
}

compose_service_running() {
  command -v docker >/dev/null 2>&1 && docker compose ps --services 2>/dev/null | grep -qx "$1"
}

require_command curl
require_command python3

printf 'GoodevaDesk smoke test\n'
printf 'Base URL: %s\n' "$BASE_URL"
printf '\n'

# 1. Health check.
http_call GET "$BASE_URL/health"
expect_status 200 "Health check"
pass "Health check"

# 2. Authentication is required.
CREATE_BODY='{"customerEmail":"smoke@example.com","subject":"Smoke auth","message":"Please check this ticket."}'
http_call POST "$BASE_URL/tickets" "$CREATE_BODY" ""
expect_status 401 "Missing API key"
pass "Missing API key ditolak"

http_call POST "$BASE_URL/tickets" "$CREATE_BODY" "invalid-smoke-key"
expect_status 401 "Invalid API key"
pass "Invalid API key ditolak"

# 3. Create a unique ticket.
SUFFIX="$(date +%s)-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:8])')"
CREATE_BODY="$(SUFFIX="$SUFFIX" python3 - <<'PY'
import json
import os

suffix = os.environ["SUFFIX"]
print(
    json.dumps(
        {
            "customerEmail": "smoke@example.com",
            "subject": f"Smoke test {suffix}",
            "message": (
                f"Invoice INV-{suffix} is missing. Contact +62 812-3456-7890 "
                f"or smoke-{suffix}@example.com."
            ),
        }
    )
)
PY
)"

http_call POST "$BASE_URL/tickets" "$CREATE_BODY" "$API_KEY"
expect_status 201 "Create ticket"
TICKET_ID="$(json_field id)"
CREATED_CATEGORY="$(json_field category)"
CREATED_REPLY="$(json_field suggestedReply)"
[[ -n "$TICKET_ID" ]] || die "Create ticket tidak mengembalikan id"
[[ "$(json_field status)" == "open" ]] || die "Ticket baru harus berstatus open"
pass "Create ticket: $TICKET_ID"

if [[ -z "$CREATED_CATEGORY" ]]; then
  warn "LLM enrichment belum menghasilkan category; ticket tetap berhasil disimpan"
elif [[ "$CREATED_CATEGORY" == "billing" || "$CREATED_CATEGORY" == "technical" || "$CREATED_CATEGORY" == "general" ]]; then
  pass "LLM category valid: $CREATED_CATEGORY"
else
  die "LLM category tidak valid: $CREATED_CATEGORY"
fi

if [[ -z "$CREATED_REPLY" ]]; then
  warn "suggestedReply kosong; LLM mungkin belum dikonfigurasi"
else
  pass "suggestedReply tersedia"
fi

# 4. Identical subject/message should reuse the classification/cache result.
http_call POST "$BASE_URL/tickets" "$CREATE_BODY" "$API_KEY"
expect_status 201 "Create duplicate ticket"
DUPLICATE_CATEGORY="$(json_field category)"
DUPLICATE_REPLY="$(json_field suggestedReply)"
if [[ -n "$CREATED_CATEGORY" ]]; then
  [[ "$DUPLICATE_CATEGORY" == "$CREATED_CATEGORY" ]] || die "Duplicate ticket category tidak konsisten"
  [[ "$DUPLICATE_REPLY" == "$CREATED_REPLY" ]] || die "Duplicate ticket suggestedReply tidak konsisten"
  pass "Duplicate ticket memakai hasil klasifikasi yang sama"
else
  warn "Duplicate ticket tetap tersimpan; cache LLM result belum dapat diverifikasi"
fi

# 5. List, detail, and filters.
http_call GET "$BASE_URL/tickets?status=open" "" "$API_KEY"
expect_status 200 "List tickets"
assert_json_id_in_list "$TICKET_ID" "List open tickets scoped to tenant"

http_call GET "$BASE_URL/tickets/$TICKET_ID" "" "$API_KEY"
expect_status 200 "Get ticket detail"
[[ "$(json_field id)" == "$TICKET_ID" ]] || die "Detail ticket ID tidak cocok"
pass "Get ticket detail"

# 6. Update status.
http_call PATCH "$BASE_URL/tickets/$TICKET_ID/status" '{"status":"in_progress"}' "$API_KEY"
expect_status 200 "Update ticket status"
[[ "$(json_field status)" == "in_progress" ]] || die "Status ticket tidak berubah menjadi in_progress"
pass "Update status menjadi in_progress"

http_call GET "$BASE_URL/tickets?status=in_progress" "" "$API_KEY"
expect_status 200 "Filter status in_progress"
assert_json_id_in_list "$TICKET_ID" "Filter status scoped to tenant"

# 7. Validation and UUID behavior.
http_call GET "$BASE_URL/tickets/not-a-uuid" "" "$API_KEY"
expect_status 400 "Invalid UUID validation"
pass "Invalid UUID ditolak"

http_call PATCH "$BASE_URL/tickets/$TICKET_ID/status" '{"status":"invalid"}' "$API_KEY"
expect_status 400 "Invalid status validation"
pass "Invalid status ditolak"

# 8. Tenant isolation. Use a temporary organization when Docker/Postgres is available.
if compose_service_running db; then
  SMOKE_ORG_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  SMOKE_ORG_KEY="smoke-org-${SUFFIX}"
  docker compose exec -T db psql -U postgres -d goodeva_desk -v ON_ERROR_STOP=1 \
    -c "INSERT INTO organizations (id, name, api_key, created_at) VALUES ('$SMOKE_ORG_ID', 'Smoke Test Organization', '$SMOKE_ORG_KEY', CURRENT_TIMESTAMP);" \
    >/dev/null
  CREATED_SMOKE_ORG=true

  http_call GET "$BASE_URL/tickets/$TICKET_ID" "" "$SMOKE_ORG_KEY"
  expect_status 404 "Cross-tenant detail isolation"
  pass "Cross-tenant detail isolation"

  http_call GET "$BASE_URL/tickets" "" "$SMOKE_ORG_KEY"
  expect_status 200 "Cross-tenant list isolation"
  assert_json_id_not_in_list "$TICKET_ID" "Cross-tenant list isolation"

  http_call PATCH "$BASE_URL/tickets/$TICKET_ID/status" '{"status":"closed"}' "$SMOKE_ORG_KEY"
  expect_status 404 "Cross-tenant update isolation"
  pass "Cross-tenant update isolation"
else
  warn "Tenant isolation via temporary organization dilewati karena service db Docker tidak berjalan"
fi

# 9. Local Python NLP extractor.
NLP_OUTPUT="$(python3 python/entity_extractor.py --pretty --text \
  'Contact smoke@example.com or +62 812-3456-7890. Invoice INV-2048 is missing.')"
grep -q "smoke@example.com" <<<"$NLP_OUTPUT" || die "Python NLP tidak menemukan email"
grep -q "INV-2048" <<<"$NLP_OUTPUT" || die "Python NLP tidak menemukan reference"
pass "Python NLP local extractor"

# 10. Optional Docker NLP smoke test.
if [[ "$RUN_DOCKER_NLP" == "true" ]] && compose_service_running db && compose_service_running api; then
  docker compose --profile nlp build nlp >/dev/null
  docker compose --profile nlp run --rm nlp --pretty --text \
    'Contact docker@example.com. Order ABC-123 is missing.' \
    >"$TEMP_DIR/nlp-docker.json"
  grep -q "docker@example.com" "$TEMP_DIR/nlp-docker.json" || die "Docker NLP tidak menemukan email"
  pass "Docker NLP raw-text mode"

  docker compose --profile nlp run --rm -e GOODEVA_API_KEY="$API_KEY" nlp \
    --ticket-id "$TICKET_ID" --pretty \
    >"$TEMP_DIR/nlp-api.json"
  grep -q "$TICKET_ID" "$TEMP_DIR/nlp-api.json" || die "Docker NLP tidak membaca ticket dari API"
  pass "Docker NLP API mode"
elif [[ "$RUN_DOCKER_NLP" == "true" ]]; then
  warn "Docker NLP smoke test dilewati karena stack Docker belum berjalan"
else
  warn "Docker NLP smoke test disabled via RUN_DOCKER_NLP=false"
fi

printf '\n✅ Semua smoke test scenario berhasil.\n'
if [[ "$CLEANUP" == "true" ]]; then
  printf 'Temporary ticket/organization data sudah dibersihkan pada container db.\n'
else
  printf 'CLEANUP=false: data smoke test dipertahankan.\n'
fi
