#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-yijv-server}"
REMOTE_SITE_DIR="${REMOTE_SITE_DIR:-/var/www/snapduel}"
REMOTE_BRANCH="${REMOTE_BRANCH:-main}"
SITE_URL="${SITE_URL:-https://snapduel.wenqing.online}"
LOCAL_BRANCH="$(git branch --show-current)"

if [[ -z "${LOCAL_BRANCH}" ]]; then
  echo "not on a local git branch" >&2
  exit 1
fi

if [[ "${LOCAL_BRANCH}" != "${REMOTE_BRANCH}" ]]; then
  echo "current branch is '${LOCAL_BRANCH}', expected '${REMOTE_BRANCH}'" >&2
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "working tree is not clean; commit or stash changes before deploy" >&2
  exit 1
fi

ssh "${SERVER_HOST}" \
  "REMOTE_SITE_DIR='${REMOTE_SITE_DIR}' REMOTE_BRANCH='${REMOTE_BRANCH}' bash -s" <<'EOF'
set -euo pipefail

if [[ ! -d "${REMOTE_SITE_DIR}/.git" ]]; then
  echo "missing git repo at ${REMOTE_SITE_DIR} — run setup-server.sh first" >&2
  exit 1
fi

git -C "${REMOTE_SITE_DIR}" fetch origin
git -C "${REMOTE_SITE_DIR}" pull --ff-only origin "${REMOTE_BRANCH}"
cd "${REMOTE_SITE_DIR}" && npm ci --omit=dev
pm2 restart snapduel
EOF

curl --fail --silent --show-error "${SITE_URL}" >/dev/null
echo "Deployed ${REMOTE_BRANCH} to ${SITE_URL}"
