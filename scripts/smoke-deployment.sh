#!/usr/bin/env bash
set -euo pipefail

deployment_origin="${PUBLIC_APP_URL:-}"
if [[ ! "${deployment_origin}" =~ ^https://[^/]+$ ]]; then
  echo "PUBLIC_APP_URL must be an HTTPS origin without a trailing slash." >&2
  exit 1
fi

retry_request() {
  local path="$1"
  local attempt
  for attempt in {1..8}; do
    if curl --fail --silent --show-error --max-time 20 "${deployment_origin}${path}" >/dev/null; then
      echo "Smoke check passed: ${path}"
      return 0
    fi
    if [[ "${attempt}" -lt 8 ]]; then
      sleep 5
    fi
  done
  echo "Smoke check failed after 8 attempts: ${path}" >&2
  return 1
}

retry_request "/health"
retry_request "/openapi.json"
retry_request "/"
