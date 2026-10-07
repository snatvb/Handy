#!/usr/bin/env bash
# Persistent local signing lets updates retain macOS privacy authorizations.
set -euo pipefail

task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
signing_name="Handy Local Signing"
bundle_path="$task_root/src-tauri/target/release/bundle/macos/Handy.app"
installed_path="/Applications/Handy.app"
setup_only=false
build_only=false
install_only=false
allow_signing_change=false

for argument in "$@"; do
  case "$argument" in
    --setup-signing) setup_only=true ;;
    --build-only) build_only=true ;;
    --install-only) install_only=true ;;
    --allow-signing-change) allow_signing_change=true ;;
    --help)
      printf '%s\n' \
        "Usage: $0 [--setup-signing | --build-only | --install-only] [--allow-signing-change]" \
        "Setup imports a local certificate into your login keychain once." \
        "Default: build, sign, install, and launch Handy." \
        "Changing the installed signer requires --allow-signing-change and a new privacy grant."
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' "This installer is for macOS." >&2
  exit 1
fi

identity_fingerprint() {
  security find-identity -v -p codesigning |
    awk -v name="$signing_name" 'index($0, "\"" name "\"") {print $2; exit}'
}

setup_signing() (
  if [[ -n "$(identity_fingerprint)" ]]; then
    printf 'Using existing signing identity: %s\n' "$signing_name"
    exit 0
  fi
  if security find-certificate -c "$signing_name" >/dev/null 2>&1; then
    printf '%s\n' "The signing certificate exists but is not usable. Restore its key/trust; do not replace it." >&2
    exit 1
  fi
  umask 077
  signing_tmp="$(mktemp -d "${TMPDIR:-/tmp}/handy-signing.XXXXXX")"
  trap 'rm -rf -- "$signing_tmp"' EXIT
  keychain_path="$(security default-keychain -d user 2>&1 | sed 's/^[[:space:]]*"//;s/"[[:space:]]*$//')"
  cat >"$signing_tmp/certificate.cnf" <<'CONFIG'
[req]
prompt = no
distinguished_name = subject
x509_extensions = signing
[subject]
CN = Handy Local Signing
[signing]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
CONFIG
  openssl req -new -newkey rsa:3072 -nodes -x509 -sha256 -days 3650 \
    -config "$signing_tmp/certificate.cnf" \
    -keyout "$signing_tmp/key.pem" -out "$signing_tmp/certificate.pem" \
    >/dev/null 2>&1
  # Keychain's PKCS#12 importer requires a nonempty wrapping passphrase.
  # This is a random one-use value, unrelated to the user's login password.
  p12_passphrase="$(openssl rand -hex 32)"
  printf '%s' "$p12_passphrase" >"$signing_tmp/passphrase"
  # The private temporary files are removed on exit. Import a non-extractable
  # key, allowing codesign access without granting every application access.
  openssl pkcs12 -export -name "$signing_name" \
    -inkey "$signing_tmp/key.pem" -in "$signing_tmp/certificate.pem" \
    -out "$signing_tmp/identity.p12" -passout "file:$signing_tmp/passphrase" \
    -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
  security import "$signing_tmp/identity.p12" -k "$keychain_path" \
    -f pkcs12 -P "$p12_passphrase" -x -T /usr/bin/codesign
  unset p12_passphrase
  # Trust this certificate only for code signing, not TLS or other policies.
  security add-trusted-cert -r trustRoot -p codeSign -k "$keychain_path" \
    "$signing_tmp/certificate.pem"
  if [[ -z "$(identity_fingerprint)" ]]; then
    printf '%s\n' "The local signing identity is not available." >&2
    exit 1
  fi
  printf 'Created persistent signing identity: %s\n' "$signing_name"
)

if "$setup_only"; then
  if "$build_only" || "$install_only"; then
    printf '%s\n' "Use --setup-signing on its own." >&2
    exit 1
  fi
  setup_signing
  exit 0
fi

if "$build_only" && "$install_only"; then
  printf '%s\n' "Choose either --build-only or --install-only." >&2
  exit 1
fi
if ! "$build_only"; then
  fingerprint="$(identity_fingerprint)"
  if [[ -z "$fingerprint" ]]; then
    printf '%s\n' "Run bun run setup:macos-signing once before installing." >&2
    exit 1
  fi
fi

if ! "$install_only"; then
  cd "$task_root"
  CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}" \
    bun run tauri build --bundles app --no-sign \
    --config '{"bundle":{"createUpdaterArtifacts":false}}'
fi
if "$build_only"; then
  printf 'Built for review; installed app is unchanged: %s\n' "$bundle_path"
  exit 0
fi

if [[ ! -d "$bundle_path" ]]; then
  printf 'No built bundle at %s\n' "$bundle_path" >&2
  exit 1
fi
codesign --force --sign "$fingerprint" --timestamp=none --options runtime \
  --entitlements "$task_root/src-tauri/Entitlements.plist" "$bundle_path"
codesign --verify --deep --strict "$bundle_path"

if [[ -d "$installed_path" ]] && ! "$allow_signing_change"; then
  previous_requirement="$(codesign -dr - "$installed_path" 2>&1 |
    sed -n 's/.*designated => //p')"
  # The '=' prefix passes a requirement expression rather than a filename.
  if [[ -z "$previous_requirement" ]] ||
    ! codesign --verify --strict -R "=$previous_requirement" "$bundle_path"; then
    printf '%s\n' \
      "Stopped: this build does not satisfy the installed app's signing identity." \
      "The first transition needs --allow-signing-change and one new privacy grant." \
      "The installed app and its privacy records are unchanged." >&2
    exit 2
  fi
fi

# Keep the previous bundle only during the replacement. The EXIT trap removes
# it after success or restores it if installation fails.
update_dir="$(mktemp -d /Applications/.Handy-update.XXXXXX)"
install_succeeded=false
cleanup_install() {
  local status=$?
  if [[ -d "$update_dir/previous.app" ]] && ! "$install_succeeded"; then
    if [[ -d "$installed_path" ]]; then
      mv "$installed_path" "$update_dir/failed.app"
    fi
    if ! mv "$update_dir/previous.app" "$installed_path"; then
      printf 'Restore the previous app from %s\n' "$update_dir/previous.app" >&2
      return "$status"
    fi
  fi
  rm -rf -- "$update_dir"
  return "$status"
}
trap cleanup_install EXIT
ditto "$bundle_path" "$update_dir/Handy.app"
codesign --verify --deep --strict "$update_dir/Handy.app"

# Signal only this installed app, avoiding Apple Events permission prompts.
process_pattern='^/Applications/Handy[.]app/Contents/MacOS/handy([[:space:]]|$)'
pkill -TERM -f "$process_pattern" 2>/dev/null || true
for ((attempt = 0; attempt < 40; attempt++)); do
  if ! pgrep -f "$process_pattern" >/dev/null; then
    break
  fi
  sleep 0.25
done
if pgrep -f "$process_pattern" >/dev/null; then
  printf '%s\n' "Handy is still running; installation stopped." >&2
  exit 1
fi
if [[ -d "$installed_path" ]]; then
  mv "$installed_path" "$update_dir/previous.app"
fi
mv "$update_dir/Handy.app" "$installed_path"
codesign --verify --deep --strict "$installed_path"
install_succeeded=true
printf 'Installed %s\n' "$installed_path"
open "$installed_path"
