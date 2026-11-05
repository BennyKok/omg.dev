#!/usr/bin/env bash
# Read-only production report. No analytics credentials leave the server.
set -euo pipefail
DAYS="${1:-7}"
[[ "$DAYS" =~ ^[0-9]+$ ]] && (( DAYS >= 1 && DAYS <= 365 )) || {
  echo 'Usage: scripts/computer-resume-metrics.sh [days: 1-365]' >&2
  exit 1
}
: "${OMG_METRICS_SSH_TARGET:?Set OMG_METRICS_SSH_TARGET to the metrics host, for example root@<host>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$OMG_METRICS_SSH_TARGET" \
  "docker exec -i omg-controlplane-umami-db-1 psql -X -U umami -d umami -v ON_ERROR_STOP=1 -v days=$DAYS" \
  < "$ROOT/scripts/metrics/computer-resume.sql"
