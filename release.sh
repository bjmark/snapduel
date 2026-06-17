#!/usr/bin/env bash
set -euo pipefail

REMOTE_NAME="${REMOTE_NAME:-origin}"
RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
LOCAL_BRANCH="$(git branch --show-current)"

if [[ -z "${LOCAL_BRANCH}" ]]; then
  echo "not on a local git branch" >&2
  exit 1
fi

if [[ "${LOCAL_BRANCH}" != "${RELEASE_BRANCH}" ]]; then
  echo "current branch is '${LOCAL_BRANCH}', expected '${RELEASE_BRANCH}'" >&2
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "working tree is not clean; commit or stash changes before release" >&2
  exit 1
fi

git push "${REMOTE_NAME}" "${RELEASE_BRANCH}"

"$(dirname "$0")/deploy.sh"
