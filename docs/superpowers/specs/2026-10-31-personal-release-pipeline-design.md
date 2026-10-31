# Personal Release Pipeline — Local Builds, Fork Distribution, Self-Update

Date: 2026-10-31
Branch: `personal` (fork `snatvb/Handy`, upstream `cjpais/Handy`)
Status: approved design, pending implementation plan

## Context

The `personal` branch carries features upstream does not want (per-prompt
post-processing shortcuts with provider/model overrides, shared custom-words
correction, shortcut conflict detection). Today distribution is split:

- Windows: CI workflow `.github/workflows/personal-release.yml` publishes an
  unsigned NSIS x64 installer to the fork's Releases on `personal-v*` tags.
- macOS: local-only install via `scripts/install-macos-local.sh` (local signing
  identity "Handy Local Signing"), never published.
- Updater: hard-disabled for personal builds (`personal-build` Cargo feature
  forces update checks off in `src-tauri/src/settings.rs`).

The owner wants **no CI**: all personal releases built locally on this Mac
(aarch64) and published to `https://github.com/snatvb/Handy/releases`, with
in-app self-update served from the fork. The proven pattern already exists in
`/Users/snatvb/projects/delta-review` (`scripts/build-release.sh`,
`scripts/publish-release.sh`, `scripts/gen-latest-json.mjs`) — this design ports
it to Handy.

## Goals

1. One command builds, one command publishes; both run on this Mac, no CI.
2. Artifacts per release: macOS arm64 `.dmg` + updater `.app.tar.gz` + `.sig`;
   Windows x64 NSIS setup `.exe` + updater `.nsis.zip` + `.sig`; `latest.json`;
   `SHA256SUMS.txt`.
3. In-app updater points at fork releases only; upstream artifacts are
   cryptographically rejected (fork minisign key).
4. The owner's own Mac keeps its privacy grants (microphone, accessibility)
   across self-updates.
5. Friends on Windows/macOS can install and self-update with minimal friction
   (one Gatekeeper bypass note, one unknown-publisher warning).

## Non-goals

- Linux artifacts (add later if requested).
- Intel macOS (`x86_64-apple-darwin`) and Windows ARM64.
- MSI packaging, app stores, Apple Developer ID signing/notarization.
- Publishing upstream's `main` mirror or touching upstream release flows.

## Users

- Owner: Windows x64 machine + Apple Silicon Mac(s).
- Friends: mixed Windows x64 / Apple Silicon macOS.

## Components

### 1. `scripts/build-release.sh` (new, ported from delta-review)

- Args: `--version X.Y.Z-snatvb.N | --bump-personal | --no-bump`,
  `--only mac|windows`, `--skip-checks`. `--bump-personal` increments the
  trailing personal component (`0.9.8-snatvb.2` → `0.9.8-snatvb.3`); the
  `X.Y.Z` base is changed only by explicit `--version` (typically after an
  upstream merge).
- Version source of truth: `version` field in `src-tauri/tauri.personal.conf.json`
  (Handy has no package.json version; tag scheme stays `personal-v<version>`).
  Bump is done in place with `git checkout --` revert on failure (ERR trap),
  mirroring delta-review.
- Pre-build checks (skipped with `--skip-checks`): `bunx tsc --noEmit`,
  `bun test`, `cd src-tauri && cargo test`.
- macOS (aarch64): `bun run tauri build --bundles app,dmg --features
personal-build --config src-tauri/tauri.personal.conf.json`, then:
  - collect `Handy_<v>_aarch64.dmg`;
  - sign `.app` with the existing "Handy Local Signing" identity (same
    entitlements as `install-macos-local.sh`) **before** tarballing, so the
    owner's TCC grants survive self-updates;
  - repack updater tarball without AppleDouble members
    (`COPYFILE_DISABLE=1 tar --no-mac-metadata`), sign with
    `bunx tauri signer sign` using the fork updater key.
- Windows (x64): `rustup target add x86_64-pc-windows-gnu` (already installed),
  `bun run tauri build --target x86_64-pc-windows-gnu --bundles nsis --features
personal-build --no-sign --config <personal conf overlaid with
createUpdaterArtifacts:true>`; collect setup `.exe` + `.nsis.zip` + `.sig`.
  Requires `x86_64-w64-mingw32-gcc` (present: GCC 14.2.0) and `makensis`
  (present).
- Updater key: `~/.tauri/handy-updater.key`, generated once via
  `bunx tauri signer generate -w ~/.tauri/handy-updater.key -p ""`.
  Exported as `TAURI_SIGNING_PRIVATE_KEY` (content only, not `_PATH`) during
  builds. Missing key → updater artifacts skipped with a warning.
- Staging: `release/<version>/`, plus `SHA256SUMS.txt` (`shasum -a 256`).

### 2. Updater rewiring

- `src-tauri/tauri.personal.conf.json`:
  - `plugins.updater.endpoints` →
    `["https://github.com/snatvb/Handy/releases/latest/download/latest.json"]`
    (was `[]`);
  - `plugins.updater.pubkey` → fork key public half (was absent — inherited
    upstream's);
  - `bundle.createUpdaterArtifacts` stays `false` in the file; the release
    script overlays `true` at build time (keeps dev builds light).
- `src-tauri/src/settings.rs`:
  - `update_checks_forced_disabled()` drops the `personal-build` clause;
    keeps `HANDY_DISABLE_UPDATER` (Nix/CI escape hatch).
  - Update the `personal_build_locks_updates_without_changing_stored_preference`
    test to assert updates are _enabled_ under `personal-build` and still
    forced off under the env var.
- Protection invariant: personal binaries embed the fork pubkey, so any
  upstream-signed `latest.json`/artifact fails signature verification even if
  an endpoint were forced. Official upstream builds are untouched (their config
  still carries their endpoint+key).

### 3. `scripts/publish-release.sh` (new, ported)

- Precheck: staging dir + `SHA256SUMS.txt` exist; local and remote tags
  `personal-v<version>` absent; worktree clean except the version bump.
- Commits version bump (`chore(release): personal-v<version>`), tags, pushes
  `personal` + tag to `origin`.
- Builds `latest.json` via ported `scripts/gen-latest-json.mjs` from `.sig`
  files (platform keys `darwin-aarch64`, `windows-x86_64`; prefer wrapped
  `.nsis.zip` over raw exe; GitHub space→dot asset-name rule respected —
  irrelevant for "Handy" but kept).
- `gh release create personal-v<version>` with all staged assets +
  `latest.json`, title `Handy <version>`, notes template: feature list,
  install instructions (Windows unknown-publisher note; macOS right-click →
  Open or `xattr -d com.apple.quarantine`), checksum pointer. Prerelease flag:
  not set (fork "Latest" should track personal releases).

### 4. Removal + docs

- Delete `.github/workflows/personal-release.yml` (replaced by local pipeline;
  fork Actions left unused for releases).
- Rewrite `BUILD.md` "Personal releases from this fork" section: local build
  flow, key generation, publish flow, self-update expectations, upstream-merge
  flow (unchanged), local Windows build instructions (`--only windows`).
- Keep `scripts/install-macos-local.sh` and `bun run install:macos` for dev
  installs; note in BUILD.md that first self-update from a locally-signed dev
  install is fine (same identity), from an unsigned source requires one
  permission re-grant.

## Data flow

```
build-release.sh          publish-release.sh
  checks (tsc/test)         prechecks (tag, staging, clean tree)
  bump version              commit bump + tag personal-v<v> + push
  mac: app,dmg + sign       gh release create (assets + SHA256SUMS)
  win: nsis (mingw)   -->   gen-latest-json -> latest.json asset
  updater .sig files        (release becomes "latest")
  staging release/<v>/
                                ^        |
                                |        v
              App update check: fork latest.json, fork pubkey verify, install
```

## Error handling

- Version bump reverted automatically on any build failure (ERR trap).
- Publish refuses: existing local/remote tag, dirty worktree (beyond bump),
  missing staging/SHA256SUMS.
- Missing updater key degrades to unsigned release (no latest.json) with
  warning, publish proceeds.
- Windows cross-build failure → fallback decision point (see Risks), not
  silent.

## Security

- Updater trust = fork minisign key only; upstream cannot push code to users.
- Release script never handles GitHub tokens itself; `gh` uses the owner's
  existing auth.
- Private key lives at `~/.tauri/handy-updater.key`, never committed.
- macOS app signed with local identity (not distributable trust, but stable
  for TCC continuity on the owner's machines).

## Testing

1. Spike (first implementation step): `cargo check --target
x86_64-pc-windows-gnu` in `src-tauri` — validates transcribe-cpp-sys /
   handy-recorder / cpal compile under mingw before any script work.
2. Unit: settings.rs updater tests updated; `bun test` suite; `cargo test`.
3. Script smoke: `build-release.sh --only mac --no-bump --skip-checks` on a
   throwaway version; verify staging contents + SHA256SUMS.
4. Live: publish `0.9.8-snatvb.2`, install dmg on this Mac, run app.
5. Self-update: publish `0.9.8-snatvb.3`, confirm in-app update offers and
   applies it (both platforms), TCC grants intact on Mac.

## Risks

| Risk                                                           | Mitigation                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| transcribe-cpp-sys / Vulkan / cpal fail on mingw               | Spike first; fallback cargo-xwin (MSVC cross); last resort keep CI for Windows only  |
| NSIS bundling quirks cross-host (resources, webview2 download) | Tauri supports NSIS cross-build; delta-review proves the path on this machine        |
| Updater replaces local-signed Mac app correctly                | Tarball signed after codesign; step 5 of testing verifies                            |
| `latest.json` "latest" pointer moves off old releases          | Fork has only personal releases; fine. Documented.                                   |
| First self-update from CI-era Windows build (0.9.8-snatvb.1)   | Old build has updater disabled — one manual install of `.2`, then self-update onward |

## Migration

- Existing release `personal-v0.9.8-snatvb.1` (CI, Windows) stays as-is.
- First local release: `0.9.8-snatvb.2`.
- Windows machines on `.1` reinstall `.2` manually once (their updater is
  disabled by the old `personal-build` lock).
