#!/usr/bin/env bash
# Builds (and optionally pushes) the four VRT images. Repo prefix is
# parameterized; push emits name@sha256:digest lines for overlay use.
#
# Usage:
#   VRT_REGISTRY=<registry> ./scripts/vrt-build-images.sh
#       [--push] [--workerd-sha256 <hex>] [--tag <tag>] [--allow-dirty]
#
# Requires: docker buildx, git, node; run from the repo root.
# WORKERD_SHA256 is mandatory when vrt-host is built with the `file`
# workerd source (default). Never builds with :latest.
#
# RV-R83 provenance rules (fail closed):
#   - the build context ($OPENFLARE_DIR, default ../openflare) must be a clean
#     git tree; --allow-dirty is the only override and forces a
#     `-dirty` tag suffix so such an image can never pass for a commit.
#   - no git HEAD and no explicit tag => refuse (no `dev` fallback).
#   - the pushed digest comes from this build's --metadata-file, never
#     from re-reading a mutable tag after the push.
#   - VRT_PLATFORM must be linux/amd64 or linux/arm64; the Dockerfile
#     verifies the workerd ELF architecture against it.
#
# RV-R25 supply-chain pins (fail closed; ALLOW_UNPINNED=1 is the only
# override and is meant for local, never-pushed builds):
#   - VRT_RUST_IMAGE / VRT_DEBIAN_IMAGE (build-arg RUST_IMAGE /
#     DEBIAN_IMAGE) must be pinned `name@sha256:<64 hex>`.
#   - WORKERD_SOURCE=image requires WORKERD_IMAGE pinned by digest.
#   - WORKERD_SOURCE=file: the caller-supplied --workerd-sha256 must equal
#     the in-repo per-arch `binarySha256` in deploy/docker/workerd.lock;
#     a missing lock entry is refused (a caller-supplied checksum alone
#     proves nothing).
set -euo pipefail

# H2: no default registry — this repo does not own one. Operators
# must pass VRT_REGISTRY explicitly; a silent default would push to
# (or reference) a registry we do not control.
if [ -z "${VRT_REGISTRY:-}" ]; then
  echo "ERROR: VRT_REGISTRY is required (e.g. VRT_REGISTRY=registry.example.com/vibeploy)." >&2
  exit 2
fi
REGISTRY="$VRT_REGISTRY"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUSH=0
ALLOW_DIRTY=0
TAG="${VRT_IMAGE_TAG:-}"
WORKERD_SHA256="${WORKERD_SHA256:-}"
CTX="${OPENFLARE_DIR:-../openflare}"

while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1 ;;
    --tag) TAG="$2"; shift ;;
    --workerd-sha256) WORKERD_SHA256="$2"; shift ;;
    --registry) REGISTRY="$2"; shift ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    *) echo "FATAL: unknown arg $1" >&2; exit 2 ;;
  esac
  shift
done

# Provenance: refuse an unverifiable or dirty source tree.
if ! HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null)"; then
  if [ -z "$TAG" ]; then
    echo "FATAL: cannot resolve git HEAD and no --tag/VRT_IMAGE_TAG given (no 'dev' fallback)" >&2
    exit 2
  fi
  HEAD_SHA=""
fi
if ! DIRTY="$(git -C "$CTX" status --porcelain --untracked-files=all 2>/dev/null)"; then
  echo "FATAL: cannot determine git working-tree state of ${CTX}" >&2
  exit 2
fi
DIRTY_SUFFIX=""
if [ -n "$DIRTY" ]; then
  if [ "$ALLOW_DIRTY" -ne 1 ]; then
    echo "FATAL: ${CTX} has uncommitted changes; commit them or pass --allow-dirty (adds -dirty tag suffix)" >&2
    exit 2
  fi
  DIRTY_SUFFIX="-dirty"
fi
if [ -z "$TAG" ]; then TAG="vrt-${HEAD_SHA}"; fi
case "$TAG" in *-dirty) ;; *) TAG="${TAG}${DIRTY_SUFFIX}" ;; esac

case "$TAG" in latest|*:*|"")
  echo "FATAL: tag must be a plain name, never latest" >&2; exit 2 ;;
esac
PLATFORM="${VRT_PLATFORM:-linux/amd64}"
case "$PLATFORM" in linux/amd64|linux/arm64) ;; *)
  echo "FATAL: VRT_PLATFORM must be linux/amd64 or linux/arm64 (got ${PLATFORM})" >&2; exit 2 ;;
esac
if [ "${WORKERD_SOURCE:-file}" = "file" ] && [ -z "$WORKERD_SHA256" ]; then
  echo "FATAL: --workerd-sha256 required (run scripts/vrt-fetch-workerd.mjs first)" >&2
  exit 2
fi

PIN_RE='^[^[:space:]@]+@sha256:[0-9a-f]{64}$'
RUST_IMAGE_ARG="${VRT_RUST_IMAGE:-}"
DEBIAN_IMAGE_ARG="${VRT_DEBIAN_IMAGE:-}"
WORKERD_IMAGE_ARG="${WORKERD_IMAGE:-}"
ALLOW_UNPINNED="${ALLOW_UNPINNED:-0}"
require_pin() {
  local label="$1" value="$2"
  if printf '%s' "$value" | grep -Eq "$PIN_RE"; then return 0; fi
  if [ "$ALLOW_UNPINNED" = "1" ]; then
    echo "WARN: ${label} is not digest-pinned (ALLOW_UNPINNED=1); image is not reproducible" >&2
    return 0
  fi
  echo "FATAL: ${label} must be pinned as name@sha256:<64 hex> (got '${value}'); set ALLOW_UNPINNED=1 only for local builds" >&2
  exit 2
}
require_pin VRT_RUST_IMAGE "$RUST_IMAGE_ARG"
require_pin VRT_DEBIAN_IMAGE "$DEBIAN_IMAGE_ARG"
if [ "${WORKERD_SOURCE:-file}" = "image" ]; then
  require_pin WORKERD_IMAGE "$WORKERD_IMAGE_ARG"
fi
if [ "${WORKERD_SOURCE:-file}" = "file" ]; then
  LOCK="${REPO_ROOT}/${CTX}/deploy/docker/workerd.lock"
  LOCK_ARCH="${PLATFORM#linux/}"
  [ "$LOCK_ARCH" = "amd64" ] && LOCK_ARCH="x64"
  LOCK_SHA="$(node -e '
    try {
      const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(l.artifacts?.["linux-" + process.argv[2]]?.binarySha256 ?? ""));
    } catch { process.stdout.write(""); }
  ' "$LOCK" "$LOCK_ARCH")"
  # RV-R199: the fetched binary's ELF e_machine must match VRT_PLATFORM
  # (fetch with --arch linux-x64 <-> linux/amd64, linux-arm64 <-> linux/arm64).
  if ! node "${REPO_ROOT}/scripts/vrt-check-elf-arch.mjs" "${REPO_ROOT}/${CTX}/deploy/docker/workerd" "$PLATFORM"; then
    echo "FATAL: re-run scripts/vrt-fetch-workerd.mjs with the --arch matching ${PLATFORM}" >&2
    exit 2
  fi
  if printf '%s' "$LOCK_SHA" | grep -Eq '^[0-9a-f]{64}$'; then
    if [ "$WORKERD_SHA256" != "$LOCK_SHA" ]; then
      echo "FATAL: --workerd-sha256 does not match the in-repo pin for linux-${LOCK_ARCH} in workerd.lock" >&2
      exit 2
    fi
  elif [ "$ALLOW_UNPINNED" = "1" ]; then
    echo "WARN: workerd.lock has no binarySha256 for linux-${LOCK_ARCH}; trusting caller checksum (ALLOW_UNPINNED=1)" >&2
  else
    echo "FATAL: workerd.lock has no binarySha256 for linux-${LOCK_ARCH}; fill it from scripts/vrt-fetch-workerd.mjs output and commit" >&2
    exit 2
  fi
fi

META_DIR="$(mktemp -d)"
trap 'rm -rf "$META_DIR"' EXIT

build_one() {
  local name="$1" dockerfile="$2"; shift 2
  local image="${REGISTRY}/${name}:${TAG}"
  local meta="${META_DIR}/${name}.json"
  local args=(--platform "$PLATFORM" -f "${CTX}/deploy/docker/${dockerfile}" -t "$image" --metadata-file "$meta")
  if [ "$PUSH" -eq 1 ]; then args+=(--push); else args+=(--load); fi
  args+=("$@")
  [ -n "$RUST_IMAGE_ARG" ] && args+=(--build-arg "RUST_IMAGE=${RUST_IMAGE_ARG}")
  [ -n "$DEBIAN_IMAGE_ARG" ] && args+=(--build-arg "DEBIAN_IMAGE=${DEBIAN_IMAGE_ARG}")
  [ -n "$WORKERD_IMAGE_ARG" ] && args+=(--build-arg "WORKERD_IMAGE=${WORKERD_IMAGE_ARG}")
  docker buildx build "${args[@]}" "$CTX"
  if [ "$PUSH" -eq 1 ]; then
    # Digest of THIS build, from buildx's own metadata — a mutable tag
    # re-read after the push could name someone else's image.
    local digest
    digest="$(node -e '
      const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(m["containerimage.digest"] ?? ""));
    ' "$meta")"
    if ! printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
      echo "FATAL: build metadata for ${name} carries no valid containerimage.digest" >&2
      exit 1
    fi
    echo "IMAGE ${REGISTRY}/${name}@${digest}"
  fi
}

build_one openflare-cell-controller Dockerfile.cell-controller
build_one openflare-provider        Dockerfile.vrt-provider
build_one openflare-sql             Dockerfile.vrt-sql
build_one openflare-host            Dockerfile.vrt-host   --build-arg "WORKERD_SOURCE=${WORKERD_SOURCE:-file}"   --build-arg "WORKERD_SHA256=${WORKERD_SHA256:-unused}"
