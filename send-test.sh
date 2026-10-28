#!/bin/sh
# Posts a LeadSquared-shaped sample lead to the local n8n webhook.
# Usage: ./send-test.sh [payloads/closed-won.json]
cd "$(dirname "$0")" && . ./.env
curl -sS -w ' HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H "X-Handoff-Secret: $HANDOFF_SECRET" --data @"${1:-payloads/closed-won.json}" \
  http://localhost:5678/webhook/lsq-lead-stage
