#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <registry> [backend|frontend|sample-app ...]" >&2
  echo "Example: $0 ghcr.io/your-org backend frontend" >&2
  exit 1
fi

REGISTRY="$1"
shift

if [[ -z "${REGISTRY}" ]]; then
  echo "Registry prefix must not be empty" >&2
  exit 1
fi

IMAGE_TAG="${IMAGE_TAG:-latest}"

declare -A CONTEXTS=(
  [backend]="backend"
  [frontend]="frontend"
  [sample-app]="sample-app"
)

declare -A IMAGE_NAMES=(
  [backend]="switchyard-backend"
  [frontend]="switchyard-frontend"
  [sample-app]="switchyard-sample"
)

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=(backend frontend sample-app)
fi

for target in "${targets[@]}"; do
  if [[ -z "${CONTEXTS[$target]:-}" ]]; then
    echo "Unknown target '$target'. Valid options: backend, frontend, sample-app" >&2
    exit 1
  fi
done

for target in "${targets[@]}"; do
  context="${CONTEXTS[$target]}"
  image_name="${IMAGE_NAMES[$target]}"
  full_tag="${REGISTRY}/${image_name}:${IMAGE_TAG}"
  echo "\n>>> Building ${full_tag} (${context})"
  docker build -t "${full_tag}" "${context}"
  echo "\n>>> Pushing ${full_tag}"
  docker push "${full_tag}"
done

echo "\n✅ Published images: ${targets[*]} (tag=${IMAGE_TAG})"
