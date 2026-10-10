# Branches, versions and releases

## The two long-lived branches

| Branch | What it is | What runs on it |
|---|---|---|
| `develop` | the integration branch — everything lands here first | `Tests`, `Catalogue` |
| `master` | what is released | everything above, plus the **APK build** |

Day-to-day work happens on `develop` (or a short-lived branch merged into it). `master` only
moves when `develop` is merged into it, and that merge is what produces an APK.

```sh
git checkout develop
git pull
# ...work, commit...

git checkout master
git merge --no-ff develop      # the APK build starts here
git push origin master
```

`--no-ff` is worth the habit: it leaves a merge commit, so `git log --first-parent master` reads
as the list of things that were released, rather than a flat run of unrelated commits.

`develop` pushes deliberately build no APK. It is the branch that moves many times a day, and
building a 220 MB artifact on every push buys nothing — nothing is installable until it is on
`master`. What `develop` does get is the full test suite and the catalogue check, so a merge into
`master` is not the first time anything looked at the code.

A pull request **into `master`** runs a fast Android check (`deps` job): the `VITE_MOBILE` bundle
plus `cap sync android` and the shell check, with no media and no Gradle. It takes about a
minute. The point is that a PR which cannot build is rejected while it is still a PR.

## Versions

`1.0.0` is this fork's first release. Upstream was at `1.4.0`; the numbering starts fresh here so
that a version never implies a set of upstream changes it does not carry.

Three files carry the version and have to agree, because `android-release.yml` checks the tag
against them:

| File | Field |
|---|---|
| `frontend/package.json` | `version` — also what the app displays, via `__APP_VERSION__` |
| `api/package.json` | `version` |
| `frontend/android/app/build.gradle` | `versionName` (same string) and `versionCode` (an integer) |

`versionCode` is what Android compares to decide whether a build is an update. It must go **up**
for every APK you expect to install over an existing one, and it is unrelated to `versionName`
except by convention.

> **A warning that only exists because this is a fork.** Upstream's `versionCode` reached 25.
> This fork starts at 1, so an official openGym APK cannot be upgraded over by a GetGoodBody APK
> — the `versionCode` is lower, and Android refuses. Uninstall the official app first. They are
> also signed with different keys, which Android would refuse anyway, so this changes nothing in
> practice; it is written down so the refusal is not a mystery later.

## Cutting a release

```sh
# 1. bump the three places above, on develop, and commit
# 2. merge develop into master
git checkout master && git merge --no-ff develop && git push origin master
# 3. tag the merge, and push the tag
git tag v1.0.0
git push origin v1.0.0
```

Pushing the tag is what publishes: `android-release.yml` verifies the tag against both
`package.json` files, builds, signs, and creates a GitHub Release with the APK, its `.sha256` and
its `.idsig`.

The tag must be `v<version>` and must match, so `v1.0.0` on a commit whose packages say `1.0.0`.
The workflow stops with a one-line reason otherwise — a release that reports a version its own
download page contradicts is the one mistake that cannot be taken back.

**Push tags one at a time** (`git push origin v1.0.0`), not `git push --tags`. This clone still
carries upstream's tags (`v1.4.0` and earlier); pushing them would create Releases for versions
this fork never built.

Upstream had a `v1.0.0` of its own as well (July 2026, its first public release), and it sat in
this clone's history, so the local tag had to be replaced rather than created. It still exists in
the `upstream` remote — `git fetch --tags upstream` brings it back if you ever want to compare
against it. `v1.0.0` on `origin` is this fork's, pointing at the merge commit below.

## Cutting 1.0.0, as it actually went

The order matters and is easy to get wrong:

```sh
git checkout -b develop                       # the integration branch
# ...commit the version bump to 1.0.0...
git push -u origin develop
git checkout master && git merge --no-ff develop
git push origin master                        # <- the APK build runs here
git tag -a v1.0.0 -m "…"                      # tag the merge, not the develop commit
git push origin v1.0.0                        # <- the Release runs here
```

The tag goes on the **merge commit**, so the Release and the APK build describe the same tree.
Tagging the `develop` commit instead would publish an artifact built from a tree that never
reached `master`.

The first run of the Release workflow stops at "Require the signing key" until the three secrets
exist — see [RELEASING.md](RELEASING.md). That is the intended failure, not a broken workflow: it
refuses to publish an APK that installs on nothing.

See [RELEASING.md](RELEASING.md) for the keystore, the signing secrets, and what the APK build
does step by step.
