#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
K6_BIN="${K6_BIN:-k6}"

if ! command -v "$K6_BIN" >/dev/null 2>&1; then
  echo "[load-smoke] k6 is not installed. Install k6 or set K6_BIN."
  exit 1
fi

echo "[load-smoke] Profile B (availability polling)"
"$K6_BIN" run -e BASE_URL="$BASE_URL" perf/k6/profile-b-availability-polling.js

echo "[load-smoke] Profile C (booking contention)"
"$K6_BIN" run -e BASE_URL="$BASE_URL" perf/k6/profile-c-booking-contention.js

echo "[load-smoke] Profile D (quote burst)"
"$K6_BIN" run -e BASE_URL="$BASE_URL" perf/k6/profile-d-quote-burst.js

