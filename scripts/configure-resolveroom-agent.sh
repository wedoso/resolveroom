#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "This helper stores credentials in macOS Keychain and must run on macOS." >&2
  echo "On another OS, set RESOLVEROOM_URL and AGENT_TOKEN in the process environment." >&2
  exit 1
fi

default_origin="https://resolveroom.wedosodavid.workers.dev"
keychain_service="ResolveRoom Agent Credential"

origin="${RESOLVEROOM_URL:-${default_origin}}"
origin="${origin%/}"

if [[ ! "${origin}" =~ ^https://[^/]+$ ]]; then
  echo "The ResolveRoom URL must be an HTTPS origin without a trailing slash." >&2
  exit 1
fi

echo "Connecting to ${origin}"
read -r -s -p "Paste the one-time rr_agent_ credential (input is hidden): " token
echo

if [[ ! "${token}" =~ ^rr_agent_ ]]; then
  echo "That value does not look like a ResolveRoom agent credential." >&2
  exit 1
fi

security add-generic-password \
  -U \
  -a "${origin}" \
  -s "${keychain_service}" \
  -w "${token}" >/dev/null

unset token
echo "Credential stored in macOS Keychain for ${origin}."
echo "Verify the connection with: npm run agent -- tasks"
