#!/usr/bin/env bash
set -euo pipefail

# Publishes the personal release: commits the version bump if needed, tags
# personal-v<version>, pushes, and creates a GitHub release on snatvb/Handy
# with every artifact from release/<version>/ (built by
# scripts/build-release.sh) plus a multi-platform latest.json for the in-app
# updater.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPO_SLUG="snatvb/Handy"
PERSONAL_CONF="src-tauri/tauri.personal.conf.json"

usage() {
  cat <<'USAGE'
Usage:
  scripts/publish-release.sh [--remote origin]

Publishes release/<version>/ artifacts for the current personal-config
version. If tauri.personal.conf.json has an uncommitted version bump, this
commits it before tagging.
USAGE
}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

personal_version() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('$PERSONAL_CONF','utf8')).version)"
}

product_name() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).productName)"
}

ensure_publishable_worktree() {
  local status
  status="$(git status --porcelain --untracked-files=no)"
  if [ -z "$status" ]; then
    return
  fi
  local unexpected
  unexpected="$(printf '%s\n' "$status" | awk -v conf="$PERSONAL_CONF" '$2 != conf { print }')"
  if [ -n "$unexpected" ]; then
    printf '%s\n' "$status" >&2
    die "only $PERSONAL_CONF may be changed when publishing (commit or stash the rest)"
  fi
}

commit_version_bump_if_needed() {
  local version="$1"
  if git diff --quiet -- "$PERSONAL_CONF" && git diff --cached --quiet -- "$PERSONAL_CONF"; then
    printf 'No uncommitted version bump; publishing current HEAD as personal-v%s.\n' "$version"
    return
  fi
  git add "$PERSONAL_CONF"
  git commit -m "chore(release): personal-v${version}"
}

# latest.json platform key for an updater artifact, or empty if the file is
# not an updater artifact (e.g. the raw .exe or .dmg).
platform_for_asset() {
  case "$1" in
    *.app.tar.gz) printf 'darwin-aarch64\n' ;;
    *.nsis.zip)   printf 'windows-x86_64\n' ;;
    *-setup.exe)  printf 'windows-x86_64\n' ;;
    *)            printf '' ;;
  esac
}

release_notes() {
  cat <<NOTES
Personal Handy build — upstream \$UPSTREAM_BASE plus fork features.

**Fork features**
- Per-prompt post-processing shortcuts with provider and model overrides.
- Shared preferred spellings and recognition variants (custom words), corrected locally before optional LLM post-processing.
- Shortcut binding conflict detection and resolution.

**Install**
- Windows x64: run the \`${product}_\${version}_x64-setup.exe\` installer (normal or portable). Unsigned: Windows may show an unknown-publisher warning.
- macOS (Apple Silicon): open the \`.dmg\` and drag Handy to Applications. The app is not notarized — on first launch right-click → Open, or run \`xattr -d com.apple.quarantine /Applications/Handy.app\`.

In-app updates are served from this fork only; official upstream builds cannot replace these features.

SHA-256 checksums: see \`SHA256SUMS.txt\`.
NOTES
}

remote="origin"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      shift; [ "$#" -gt 0 ] || die "--remote requires a remote name"; remote="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

require_cmd git
require_cmd gh
require_cmd node
require_cmd shasum

version="$(personal_version)"
product="$(product_name)"
tag="personal-v${version}"
staging="release/${version}"

[ -d "$staging" ] || die "no staging directory at $staging (run scripts/build-release.sh first)"
[ -f "${staging}/SHA256SUMS.txt" ] || die "SHA256SUMS.txt missing from $staging (run scripts/build-release.sh again)"

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  die "local tag already exists: ${tag}"
fi
if git ls-remote --exit-code --tags "$remote" "refs/tags/${tag}" >/dev/null 2>&1; then
  die "remote tag already exists: ${tag}"
fi

ensure_publishable_worktree
commit_version_bump_if_needed "$version"

git tag "$tag"
git push "$remote" HEAD
git push "$remote" "$tag"

base_url="https://github.com/${REPO_SLUG}/releases/download/${tag}"

# Assemble the updater manifest from whatever signed updater artifacts exist.
latest_args=()
for sig in "$staging"/*.sig; do
  [ -f "$sig" ] || continue
  asset="$(basename "$sig" .sig)"
  key="$(platform_for_asset "$asset")"
  [ -n "$key" ] || continue
  # Prefer the wrapped (v1) artifact for Windows when both forms are present.
  if [ "$key" = "windows-x86_64" ] && [ "$asset" = "${product}_${version}_x64-setup.exe" ] \
     && [ -f "$staging/${asset}.nsis.zip.sig" ]; then
    continue
  fi
  latest_args+=(--sig "${key}=${sig}" --url "${key}=${base_url}/${asset// /.}")
done

UPSTREAM_BASE="$(git log --oneline --ancestry-path "${tag}"..upstream/main 2>/dev/null | tail -1 | cut -c1-7)"
export UPSTREAM_BASE
notes_file="$(mktemp)"
latest_json="$(mktemp -d)/latest.json"
trap 'rm -f "$notes_file"; rm -rf "$(dirname "$latest_json")"' EXIT
release_notes > "$notes_file"

if [ "${#latest_args[@]}" -gt 0 ]; then
  node scripts/gen-latest-json.mjs \
    --version "$version" \
    --pub-date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --notes "Personal Handy update. See the release page for details." \
    "${latest_args[@]}" > "$latest_json"
else
  printf 'warning: no signed updater artifacts found — publishing without latest.json.\n' >&2
fi

assets=()
for f in "$staging"/*; do
  case "$(basename "$f")" in
    latest.json|SHA256SUMS.txt) ;;
    *) assets+=("$f") ;;
  esac
done
assets+=("${staging}/SHA256SUMS.txt")
if [ -s "$latest_json" ]; then
  assets+=("$latest_json")
fi

gh release create "$tag" "${assets[@]}" \
  --repo "$REPO_SLUG" \
  --title "Handy ${version}" \
  --notes-file "$notes_file"

printf '\nPublished %s on %s with %s assets.\n' "$tag" "$REPO_SLUG" "$((${#assets[@]}))"
printf 'SHA-256 checksums are in SHA256SUMS.txt on the release page.\n'
