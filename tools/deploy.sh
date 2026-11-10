#!/usr/bin/env bash
# Deploys ONLY the site files — never the resources/ archive or agent tooling.
#
# WHY THIS EXISTS (read before changing):
#   netlify-cli's `netlify deploy --dir .` does NOT read .netlifyignore — that
#   file only applies to git-connected builds on Netlify's build system. The
#   CLI's own filter (getDeployFilesFilter in netlify-cli 26.2.0) skips only
#   dotfiles/dirs, node_modules, __MACOSX, _redirects and _headers. This repo
#   now carries an 88MB resources/ archive that must never be deployed, so we
#   stage the site files into a temp dir and deploy from there.
#
# USAGE (from anywhere):
#   bash tools/deploy.sh                 # production deploy
#   bash tools/deploy.sh --dry-run       # show what WOULD be deployed, deploy nothing
#   bash tools/deploy.sh [extra flags]   # extra flags pass through to netlify deploy
#
# Requires NETLIFY_AUTH_TOKEN in the environment (never committed — see
# PROJECT_BRAIN.md section 17). Site: premarket-india-report.netlify.app
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# Stage everything except the archive, agent tooling, UA scratch, git and local state.
tar cf - \
  --exclude=./resources \
  --exclude=./.claude \
  --exclude=./.ua \
  --exclude=./.git \
  --exclude=./node_modules \
  --exclude=./.netlify \
  . | tar -C "$STAGE" -xf -

COUNT=$(find "$STAGE" -type f | wc -l)
echo "Staged $COUNT site files (archive and tooling excluded)."

if [ "${1:-}" = "--dry-run" ]; then
  echo "--- DRY RUN: staged files ---"
  (cd "$STAGE" && find . -type f | sort)
  echo "--- end dry run (nothing deployed) ---"
  exit 0
fi

# Default to a production deploy; pass --prod explicitly for clarity in logs.
netlify deploy --prod --dir "$STAGE" --site d11ef229-c10a-4030-a70a-d2797720d626 "$@"
