#!/usr/bin/env bash
set -euo pipefail

# Personal release builder — builds macOS (arm64) and Windows (x64) artifacts
# locally on this Mac, no CI involved. Windows is cross-compiled with mingw-w64
# (Vulkan bits come from brew + a mingw import library, see docs in BUILD.md).
# Ported from the delta-review fork pipeline.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PERSONAL_CONF="src-tauri/tauri.personal.conf.json"
UPDATER_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/handy-updater.key}"
MACOS_SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:-Handy Local Signing}"
# Cross-Vulkan prerequisites (see BUILD.md "One-time setup"): a VULKAN_SDK-style
# prefix at ~/cross/vulkan-mingw/sdk with vulkan+spirv headers, the mingw
# vulkan-1 import library, glslc, and the SPIRV-Headers CMake config.
VULKAN_CROSS_SDK="${VULKAN_CROSS_SDK:-$HOME/cross/vulkan-mingw/sdk}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/build-release.sh --version X.Y.Z-snatvb.N | --bump-personal | --no-bump
                           [--only mac|windows] [--skip-checks]

Builds personal release artifacts into release/<version>/:
  mac      "Handy_<v>_aarch64.dmg" (+ "Handy.app.tar.gz" + .sig)
  windows  "Handy_<v>_x64-setup.exe" (+ .nsis.zip + .sig) — cross-compiled via mingw-w64

The macOS bundle is signed with the local signing identity so privacy grants
survive self-updates on the owner's machines. Updater artifacts are signed
with ~/.tauri/handy-updater.key (fork key; generate once, see BUILD.md).
USAGE
}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1 (see BUILD.md)"; }

personal_version() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('$PERSONAL_CONF','utf8')).version)"
}

product_name() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).productName)"
}

# Bump the trailing personal component (X.Y.Z-snatvb.N -> N+1), or set an
# explicit version. The X.Y.Z base is changed by hand after upstream merges.
bump_version() {
  node - "$1" "${2:-}" "$PERSONAL_CONF" <<'NODE'
const fs = require("fs");
const [bump, explicit, confPath] = process.argv.slice(2);
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
let next;
if (bump === "none") {
  next = conf.version;
} else if (bump === "version") {
  if (!/^\d+\.\d+\.\d+-snatvb\.\d+$/.test(explicit)) {
    throw new Error(`--version must be X.Y.Z-snatvb.N, got: ${explicit}`);
  }
  next = explicit;
} else if (bump === "personal") {
  const m = /^(\d+\.\d+\.\d+)-snatvb\.(\d+)$/.exec(conf.version);
  if (!m) throw new Error(`unsupported personal version: ${conf.version}`);
  next = `${m[1]}-snatvb.${Number(m[2]) + 1}`;
} else {
  throw new Error(`unknown bump: ${bump}`);
}
if (next !== conf.version) {
  conf.version = next;
  fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
}
console.log(next);
NODE
}

# Overlay createUpdaterArtifacts=true on top of the personal config so the
# Windows bundler emits the updater zip + signature. Written under release/;
# never committed.
win_release_config() {
  node - "$PERSONAL_CONF" "$1" <<'NODE'
const fs = require("fs");
const [confPath, outPath] = process.argv.slice(2);
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.bundle = conf.bundle || {};
conf.bundle.createUpdaterArtifacts = true;
fs.writeFileSync(outPath, JSON.stringify(conf, null, 2) + "\n");
NODE
}

bump=""
explicit_version=""
only=""
skip_checks=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bump-personal) [ -z "$bump" ] || die "choose only one version option"; bump="personal" ;;
    --version)
      [ -z "$bump" ] || die "choose only one version option"
      shift; [ "$#" -gt 0 ] || die "--version requires X.Y.Z-snatvb.N"
      bump="version"; explicit_version="$1" ;;
    --no-bump) [ -z "$bump" ] || die "choose only one version option"; bump="none" ;;
    --only)
      shift; [ "$#" -gt 0 ] || die "--only requires mac|windows"
      case "$1" in mac|windows) only="$1" ;; *) die "--only must be mac|windows" ;; esac ;;
    --skip-checks) skip_checks=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

[ -n "$bump" ] || { usage >&2; die "choose --bump-personal, --version X.Y.Z-snatvb.N, or --no-bump"; }

require_cmd git
require_cmd node
require_cmd bun
require_cmd cargo

build_mac=0
build_windows=0
case "$only" in
  "")     build_mac=1; build_windows=1 ;;
  mac)    build_mac=1 ;;
  windows) build_windows=1 ;;
esac
if [ "$build_windows" -eq 1 ]; then
  require_cmd x86_64-w64-mingw32-gcc
  [ -f "$VULKAN_CROSS_SDK/lib/libvulkan-1.a" ] || die "missing $VULKAN_CROSS_SDK — see BUILD.md 'One-time setup'"
fi

old_version="$(personal_version)"
product="$(product_name)"

if [ "$skip_checks" -eq 0 ]; then
  printf 'Validating current tree...\n'
  bunx tsc --noEmit -p .
  # Unit tests only: tests/ holds Playwright e2e specs that cannot run under
  # bun test (they need the Playwright runner).
  bun test src scripts
  (cd src-tauri && CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}" cargo test --quiet)
fi

new_version="$(bump_version "$bump" "$explicit_version")"
printf 'Version: %s -> %s\n' "$old_version" "$new_version"

# Revert the uncommitted version bump if anything below fails, so a failed run
# doesn't leave the personal config dirty for the next one.
trap 'git checkout -- "$PERSONAL_CONF" 2>/dev/null || true' ERR

staging="release/${new_version}"
mkdir -p "$staging"

# Updater signing: fork key generated once via
#   bunx tauri signer generate -w ~/.tauri/handy-updater.key -p ""
updater_ok=0
if [ -f "$UPDATER_KEY_PATH" ]; then
  # Export the key CONTENT only: the bundler's createUpdaterArtifacts path reads
  # TAURI_SIGNING_PRIVATE_KEY, and `tauri signer sign` rejects having both the
  # content and the _PATH variant set at once.
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  updater_ok=1
else
  printf 'warning: updater key not found at %s — updater artifacts will be skipped.\n' "$UPDATER_KEY_PATH" >&2
fi

collect() { # collect <bundle-subdir> <glob...>
  local dir="src-tauri/target/$1"
  shift
  local found=0 f pattern
  for pattern in "$@"; do
    while IFS= read -r -d '' f; do
      cp "$f" "$staging/"
      found=1
    done < <(find "$dir" -maxdepth 1 -type f -name "$pattern" -print0)
  done
  [ "$found" -eq 1 ] || die "no artifacts matched in $dir (patterns: $*)"
}

if [ "$build_mac" -eq 1 ]; then
  printf '\n=== macOS (aarch64) ===\n'
  # APPLE_SIGNING_IDENTITY makes the bundler sign the app during bundling, so
  # the .dmg carries the locally-signed app and the updater tarball below is
  # built from that same signed bundle.
  APPLE_SIGNING_IDENTITY="$MACOS_SIGN_IDENTITY" \
    CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}" \
    bun run tauri build --bundles app,dmg --features personal-build --config "$PERSONAL_CONF"
  collect release/bundle/dmg "${product}_${new_version}_aarch64.dmg"

  app_dir="src-tauri/target/release/bundle/macos"
  [ -d "$app_dir/${product}.app" ] || die "app bundle not found in $app_dir"
  codesign --verify --strict "$app_dir/${product}.app" \
    || die "bundled app failed codesign verification (identity: $MACOS_SIGN_IDENTITY)"

  if [ "$updater_ok" -eq 1 ]; then
    # Repack the updater tarball ourselves: macOS bsdtar would embed AppleDouble
    # `._*` members that the updater's Rust tar extractor chokes on.
    COPYFILE_DISABLE=1 tar --no-mac-metadata -C "$app_dir" -czf "$staging/${product}.app.tar.gz" "${product}.app"
    bunx tauri signer sign "$staging/${product}.app.tar.gz"
  fi
fi

if [ "$build_windows" -eq 1 ]; then
  printf '\n=== Windows (x64, cross via mingw-w64) ===\n'
  rustup target add x86_64-pc-windows-gnu
  win_conf="$staging/.tauri.personal.updater.conf.json"
  win_release_config "$win_conf"
  # mingw-built ggml/libtranscribe DLLs import libstdc++/libgcc/libwinpthread;
  # drop them into transcribe-cpp-sys's runtime dir (out/bin, published via
  # cargo:runtime_dir) so build.rs stages everything into transcribe-libs and
  # the NSIS bundle. The dir mtime bump also re-triggers build.rs staging.
  mingw_root="$(cd "$(dirname "$(realpath "$(x86_64-w64-mingw32-gcc -print-file-name=libstdc++-6.dll)")")/.." && pwd)"
  for bin_dir in src-tauri/target/x86_64-pc-windows-gnu/release/build/transcribe-cpp-sys-*/out/bin; do
    [ -d "$bin_dir" ] || continue
    cp "$mingw_root/lib/libstdc++-6.dll" "$mingw_root/lib/libgcc_s_seh-1.dll" "$bin_dir/"
    cp "$mingw_root/bin/libwinpthread-1.dll" "$bin_dir/"
  done
  # VULKAN_SDK points ggml's CMake at the cross SDK prefix (vulkan+spirv
  # headers, mingw vulkan-1 import lib, glslc, SPIRV-Headers config).
  # No --no-sign here: it would also skip the updater artifact; Authenticode
  # is already disabled via windows.signCommand=null in the personal config.
  VULKAN_SDK="$VULKAN_CROSS_SDK" \
    CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}" \
    bun run tauri build --target x86_64-pc-windows-gnu --bundles nsis \
    --features personal-build --config "$win_conf"
  collect x86_64-pc-windows-gnu/release/bundle/nsis "${product}_${new_version}_x64-setup.exe"
  rm -f "$win_conf"
  # Updater artifacts only exist when the fork updater key was available at
  # build time. Tauri v2 updater signs the raw installer (.exe.sig); older
  # wrapped .nsis.zip artifacts are picked up too if the bundler ever emits
  # them again.
  if [ "$updater_ok" -eq 1 ]; then
    for f in src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*-setup.exe.sig \
             src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.nsis.zip \
             src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.nsis.zip.sig; do
      [ -f "$f" ] || continue
      case "$f" in *"${new_version}"*) cp "$f" "$staging/" ;; esac
    done
  fi
fi

(
  cd "$staging"
  rm -f SHA256SUMS.txt
  shasum -a 256 -- * > SHA256SUMS.txt
)

printf '\nRelease candidate built into %s.\n' "$staging"
ls -la "$staging"
printf '\nTest the artifacts, then run scripts/publish-release.sh.\n'
