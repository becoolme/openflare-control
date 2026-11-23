#!/usr/bin/env bash
# Real Kubernetes e2e: kind cluster + Postgres + the plane image, then the same
# HTTP lifecycle as the Docker e2e through a port-forward.
#
#   PLANE_TOKEN=... PLANE_SIGNING_SECRET=... ./scripts/e2e-kind.sh
#
# Requires docker, kind, kubectl. CI installs kind/kubectl and runs this.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER="${KIND_CLUSTER:-openflare-e2e}"
IMAGE="${PLANE_IMAGE:-openflare-plane:e2e}"
CONSOLE_IMAGE="${CONSOLE_IMAGE:-openflare-console:e2e}"
CONSOLE_PORT="${CONSOLE_E2E_PORT:-18788}"
NS=openflare-plane-e2e
PORT="${PLANE_E2E_PORT:-18787}"
TOKEN="${PLANE_TOKEN:?set PLANE_TOKEN}"
SIGNING="${PLANE_SIGNING_SECRET:?set PLANE_SIGNING_SECRET}"

cleanup() {
  kill "${PF_PID:-}" "${CONSOLE_PF_PID:-}" 2>/dev/null || true
  kubectl --context "kind-${CLUSTER}" delete namespace "$NS" --ignore-not-found >/dev/null 2>&1 || true
  # Keep a pre-created CI cluster; only remove one this script created.
  if [[ "${CREATED_CLUSTER}" == "1" ]]; then
    kind delete cluster --name "$CLUSTER" >/dev/null 2>&1 || true
  fi
}
CREATED_CLUSTER=0
trap cleanup EXIT

cd "$ROOT"
docker build -q -t "$IMAGE" -f apps/plane/Dockerfile .
docker build -q -t "$CONSOLE_IMAGE" -f apps/console/Dockerfile .

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind create cluster --name "$CLUSTER" --wait 120s
  CREATED_CLUSTER=1
fi
kind load docker-image --name "$CLUSTER" "$IMAGE"
kind load docker-image --name "$CLUSTER" "$CONSOLE_IMAGE"

kubectl --context "kind-${CLUSTER}" apply -f deploy/k8s/e2e/plane.yaml
kubectl --context "kind-${CLUSTER}" -n "$NS" create secret generic plane-env \
  --from-literal=DATABASE_URL="postgresql://vrt:vrt@postgres:5432/vrt_plane" \
  --from-literal=PLANE_TOKEN="$TOKEN" \
  --from-literal=PLANE_ADMIN_TOKEN="${PLANE_ADMIN_TOKEN:-$TOKEN}" \
  --from-literal=PLANE_SIGNING_SECRET="$SIGNING" \
  --dry-run=client -o yaml | kubectl --context "kind-${CLUSTER}" apply -f -

kubectl --context "kind-${CLUSTER}" -n "$NS" rollout status deploy/postgres --timeout=120s
kubectl --context "kind-${CLUSTER}" -n "$NS" rollout status deploy/plane --timeout=180s
kubectl --context "kind-${CLUSTER}" -n "$NS" rollout status deploy/console --timeout=180s
kubectl --context "kind-${CLUSTER}" -n "$NS" port-forward svc/plane "${PORT}:8787" \
  >/tmp/openflare-plane-port-forward.log 2>&1 &
PF_PID=$!
kubectl --context "kind-${CLUSTER}" -n "$NS" port-forward svc/console "${CONSOLE_PORT}:8788" \
  >/tmp/openflare-console-port-forward.log 2>&1 &
CONSOLE_PF_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null

PLANE_BASE_URL="http://127.0.0.1:${PORT}" \
  CONSOLE_BASE_URL="http://127.0.0.1:${CONSOLE_PORT}" \
  PLANE_TOKEN="$TOKEN" node scripts/e2e-docker.mjs
echo "OK: kind e2e passed in cluster ${CLUSTER}"
