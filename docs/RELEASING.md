# Building and releasing the Android APK

The phone app is built and published entirely from GitHub Actions. Two workflows do it:

| Workflow | Runs on | Produces |
|---|---|---|
| [`android-apk.yml`](../.github/workflows/android-apk.yml) | every push to `master`, every pull request, or manually | the APK as a run artifact (30 days) |
| [`android-release.yml`](../.github/workflows/android-release.yml) | a `v*` tag, or manually | a GitHub Release with the signed APK, its `.sha256` and `.idsig` |

They are deliberately separate. The build has to be reachable from a pull request, which means
it must work without the signing key — GitHub does not hand secrets to a workflow running on a
fork's PR. The release is the only place the key is ever read, and it refuses to run without
one, because an unsigned APK installs on nothing.

This replaces the upstream GitLab job (`.gitlab-ci.yml` → `build:apk`) for this fork: the
GitLab pipeline publishes to GitLab's package registry and needs GitLab's protected variables,
neither of which exists here.

## One-time setup: the signing key

Android will not install an update signed by a different key than the version already on a
device. That is the whole reason this has to be done once and then kept.

### 1. Make the keystore

```sh
keytool -genkeypair \
  -keystore getgoodbody.jks \
  -alias getgoodbody \
  -keyalg RSA -keysize 2048 -validity 10950
```

`-validity 10950` is 30 years — the Play Store's minimum is 25, and an expired key cannot sign.
Answer the prompts; the `CN` is what shows in Android's install dialog.

> **Back this file up somewhere you will still have in five years** (a password manager, an
> encrypted backup). Losing it means every installed copy has to be uninstalled and reinstalled
> to move to a new key — there is no recovery, by design.

### 2. Add the three secrets

Under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | the keystore, base64-encoded (below) |
| `ANDROID_KEYSTORE_PASSWORD` | the store password you chose |
| `ANDROID_KEY_ALIAS` | the alias, `getgoodbody` above |

Encode the keystore — one line, no wrapping, because the workflow decodes it with `base64 -d`:

```sh
# macOS
base64 -i getgoodbody.jks | tr -d '\n' | pbcopy

# Linux
base64 -w0 getgoodbody.jks | xclip -selection clipboard
```

Paste that into `ANDROID_KEYSTORE_B64`. Windows users: `certutil -encode` writes a header and
footer that `base64 -d` will reject — use Git Bash or WSL for the command above.

## Releasing

A release is a tag, and the tag has to agree with the version in the packages:

```sh
# bump frontend/package.json and api/package.json first, commit, then:
git tag v1.4.1
git push origin v1.4.1
```

The workflow checks the tag against `frontend/package.json` and `api/package.json` and stops
with a one-line reason if they disagree — a publish that reports a version its own download
page contradicts is the one mistake a release cannot take back.

What lands on the Release page:

- `GetGoodBody-<version>.apk` — signed, ready to sideload
- `GetGoodBody-<version>.apk.sha256` — the digest, so a download from anywhere else can be checked
- `GetGoodBody-<version>.apk.idsig` — APK Signature Scheme v4, used by `adb install --incremental`

### Re-running one

**Actions → Release → Run workflow**, enter the existing tag. Useful when a build failed for
infrastructure reasons rather than a code problem.

### Building without releasing

**Actions → Android APK → Run workflow**, or just push to `master`. The APK is attached to the
run (not to a Release) and expires after 30 days. Without the signing secrets this still builds
and uploads, but the file is named `-unsigned` and will not install — only the release workflow
insists on a key.

## How the build is put together

The steps that are easy to get wrong, and why they are written the way they are:

- **`cap sync android`, not `npm run build:mobile`.** That script runs a bare `cap sync`, which
  syncs `ios/` as well and needs CocoaPods — which no Linux runner has. The Android half is
  `VITE_MOBILE=1 vite build`, `stage-media`, `cap sync android`, `check-mobile-bundle.mjs`.
- **`assembleRelease` writes an *unsigned* APK.** `frontend/android/app/build.gradle` has no
  `signingConfig`, on purpose: the key stays in a secret and never in a checked-in file. The
  workflow aligns and signs with the SDK's own `zipalign`/`apksigner`, the same way
  `.gitlab-ci.yml` does it.
- **The exercise media are bundled, not fetched.** `scripts/catalogue/stage-media.mjs` copies the
  180 px stills and clips from `catalogue/media` into the bundle on every build — they are
  ordinary files in the repository (not symlinks, not LFS), so a plain checkout has them. This
  is what makes the phone app work offline, and it is also why the APK is ~220 MB.
- **`compileSdk`/`targetSdk` 35**, so `build-tools;35.0.0` is required for `zipalign`/`apksigner`;
  Gradle 8.11.1 (the wrapper) needs JDK 17+, and 21 is what this is verified against.
- **Node 22**, matching `node:22-alpine` in `web/Dockerfile` and `.github/workflows/test.yml`.

## The APK is large on purpose (and can be made smaller)

About 220 MB, almost all of it media: ~157 MB of animation clips plus ~33 MB of stills for
6,554 exercises. That is the trade for an app that works with no network at all.

Upstream's published APK is far smaller because its release build sets `APP_MEDIA_DIR` to a
private directory of higher-resolution media and serves the animations from a CDN — that
directory is licensed to the upstream project and is not in this repository, so a fork cannot
reproduce that build. Setting `APP_MEDIA_DIR` here does nothing but point at missing files.

If the size matters, the honest options are:

- **Point the app at a CDN** with `VITE_IMG_BASE` / `VITE_GIF_BASE` (read in
  `frontend/src/lib/exercises.js`; baked in at build time, so they are workflow env vars, not
  runtime settings). `stage-media` still copies the files in, so also drop that step and the
  movement library becomes network-only — no offline use.
- **Ship fewer exercises.** The catalogue is the source; trimming it is a content decision.
- **Leave it.** 220 MB is a one-time download and everything works on a plane.

## Other workflows on this fork

The branch name is the thing to watch: upstream releases from `main`, this repository uses
`master`, and a workflow whose `on.push.branches` says `main` simply never fires here.

| Workflow | Upstream trigger | State on this fork |
|---|---|---|
| `test.yml` | `push` on `main, coach` | **fixed** — `master` added, so the suite that gates a release runs on the branch it is tagged from |
| `catalogue.yml` | `push` on `main` | **fixed** — `master` added |
| `mirror.yml` | `push` on `main` | guarded by `if: github.repository == 'DuarteSantos8/openGym'`, so it reports **skipped** |
| `docker-publish.yml` | `push` on `main`, `release: published` | fires when a Release is published |
| `pages.yml` | `push` on `main` | only runs when dispatched by hand |

`docker-publish.yml` is worth knowing about: publishing a Release (which `android-release.yml`
does) triggers it, and it builds the api and web images and pushes them to
`ghcr.io/<your-owner>/opengym-api` and `-web`. It is not guarded to upstream, so it will run
here — successfully, using the automatic `GITHUB_TOKEN`, but it spends build minutes on every
release. Disable it in the Actions tab if you do not use those images.

`pages.yml` (the demo site) additionally needs **Settings → Pages → Build and deployment →
Source: GitHub Actions** before it will succeed.

## Why this fork needed its own release workflow

Upstream builds the APK in GitLab CI (`.gitlab-ci.yml` → `build:apk`), which signs with
protected GitLab variables, uploads to GitLab's generic package registry and attaches the file
to a GitLab Release. None of that is reachable from here, so `android-apk.yml` and
`android-release.yml` reproduce it with GitHub Actions and GitHub Releases. The signing steps
are copied from the upstream job deliberately, so both produce the same kind of artifact.

