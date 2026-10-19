#!/usr/bin/env bash
set -euo pipefail

image=${1:?Pass a published immutable image tag}
deploy_path=${2:?Pass the existing deployment directory}
[[ "$image" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+:(sha-[a-f0-9]{40}|v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?)$ ]]
cd "$deploy_path"
test -f compose.production.yaml
test -f .env
test -f Caddyfile
command -v flock >/dev/null
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }

compose=(docker compose -p dg-lab-web-app -f compose.production.yaml)
previous_id=$("${compose[@]}" ps -q panel)
previous_image=''
if [[ -n "$previous_id" ]]; then previous_image=$(docker inspect --format '{{.Config.Image}}' "$previous_id"); fi
if [[ -z "$previous_image" ]]; then
  echo 'Initialize the deployment once before using the upgrade workflow.' >&2
  exit 1
fi

export PANEL_IMAGE="$image"
"${compose[@]}" pull panel
if ! "${compose[@]}" up -d --no-deps --wait --wait-timeout 90 panel; then
  echo 'Health check failed; restoring the previous image.' >&2
  export PANEL_IMAGE="$previous_image"
  "${compose[@]}" up -d --no-deps --wait --wait-timeout 90 panel
  exit 1
fi
# Persist only the selected image; never send the deployment's .env to CI.
temp_env=$(mktemp .env.deploy.XXXXXX)
trap 'rm -f "$temp_env"' EXIT
chmod 600 "$temp_env"
awk '!/^PANEL_IMAGE=/' .env > "$temp_env"
printf '\nPANEL_IMAGE=%s\n' "$image" >> "$temp_env"
mv "$temp_env" .env
printf 'Deployment healthy: %s\n' "$image"
