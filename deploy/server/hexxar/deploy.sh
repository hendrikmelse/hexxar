#!/usr/bin/env bash
# Deploys one image: pull, restart, wait for health, roll back if the new version never
# becomes healthy. Called by CI over SSH, or by hand:
#   ./deploy.sh ghcr.io/hendrikmelse/hexxar:<commit-sha>
#
# Rolling back by hand is the same command with the previous tag.
# Matches in progress live in the server's memory, so a deploy ends them: players are
# reconnected to the menu. The site is one container, so there are also a few seconds
# of downtime (Caddy answers 502 while it restarts).
set -euo pipefail
cd "$(dirname "$0")"

NEW="${1:?usage: deploy.sh <image>}"
PREV="$(cat current-image 2>/dev/null || true)"
export IMAGE="$NEW"

# Waits up to ~60s for the container's healthcheck to pass.
wait_healthy() {
  local status="none"
  for _ in $(seq 1 30); do
    status="$(docker inspect -f '{{.State.Health.Status}}' hexxar 2>/dev/null || echo none)"
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "unhealthy" ] && return 1
    sleep 2
  done
  return 1
}

echo "==> pulling $NEW"
docker compose pull game

echo "==> starting $NEW"
docker compose up -d --no-deps game

if ! wait_healthy; then
  echo "!! $NEW did not become healthy" >&2
  docker compose logs --tail 50 game >&2 || true
  if [ -n "$PREV" ]; then
    echo "==> rolling back to $PREV" >&2
    IMAGE="$PREV" docker compose up -d --no-deps game
    if wait_healthy; then
      echo "==> rollback succeeded: $PREV is healthy" >&2
    else
      echo "!! rollback FAILED: $PREV is not healthy either; investigate now" >&2
    fi
  else
    echo "!! no previous version recorded, so there is nothing to roll back to" >&2
  fi
  exit 1
fi

echo "$NEW" > current-image

# Keep the new and the previous image; remove older ones of this repository.
# Cleanup must never fail a deploy that already succeeded.
repo="${NEW%:*}"
keep=" $NEW ${PREV:-} "
{
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" | while read -r ref; do
    case "$keep" in
      *" $ref "*) ;;
      *) echo "==> removing old image $ref"; docker image rm "$ref" >/dev/null 2>&1 || true ;;
    esac
  done
  docker image prune -f >/dev/null
} || true

echo "==> deployed $NEW"
