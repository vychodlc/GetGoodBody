#!/usr/bin/env bash
# Makes the Android release keystore the GitHub Actions release workflow signs with, and prints
# the three repository secrets it needs.
#
#   scripts/make-android-keystore.sh [output-path]
#
# Run this ONCE. The keystore is the app's signing identity: Android refuses to install an update
# signed by a different key, so every future APK has to be signed with this same file. Back it up
# somewhere you will still have in five years before doing anything else with it.
#
# It refuses to overwrite an existing keystore — replacing one silently would orphan every install
# that already exists.
set -eu

OUT="${1:-$HOME/getgoodbody-release.jks}"
ALIAS="${KEY_ALIAS:-getgoodbody}"
# The certificate's subject. Only the CN is really visible (Android's install dialog); the rest is
# boilerplate. -dname is what keeps keytool from asking six questions interactively.
DNAME="${KEY_DNAME:-CN=GetGoodBody, OU=Android, O=GetGoodBody, C=CN}"

# --- find a keytool that actually runs ------------------------------------------------------
# macOS has a /usr/bin/keytool, but it is a stub that fails with "Unable to locate a Java Runtime"
# unless a JDK is registered with java_home — which is exactly the trap this script avoids.
find_keytool() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
    printf '%s\n' "$JAVA_HOME/bin/keytool"; return 0
  fi
  local bundled
  for bundled in "$HOME"/android-tools/jdk/*/Contents/Home/bin/keytool; do
    [ -x "$bundled" ] && { printf '%s\n' "$bundled"; return 0; }
  done
  if command -v keytool >/dev/null 2>&1 && keytool -help >/dev/null 2>&1; then
    printf 'keytool\n'; return 0
  fi
  return 1
}

if ! KEYTOOL="$(find_keytool)"; then
  cat >&2 <<'EOF'
No working keytool found.

macOS's /usr/bin/keytool is a stub and does not count. Either install a JDK, or use the one this
workspace already has for the Android build:

  JAVA_HOME=~/android-tools/jdk/*/Contents/Home scripts/make-android-keystore.sh
EOF
  exit 1
fi
echo "keytool: $KEYTOOL"

if [ -e "$OUT" ]; then
  cat >&2 <<EOF

Refusing to overwrite $OUT

This file is the app's signing identity. Replacing it orphans every install already out there —
those devices could only take an update by uninstalling first. Move it aside deliberately if that
is really what you want, then run this again.
EOF
  exit 1
fi

# --- the store password ---------------------------------------------------------------------
# Taken from KEYSTORE_PASSWORD when set, so the whole thing can run unattended; otherwise it is
# prompted for. Either way it is never echoed and never appears on a command line.
if [ -n "${KEYSTORE_PASSWORD:-}" ]; then
  PASS="$KEYSTORE_PASSWORD"
else
  printf 'Choose a store password (min 6 characters). Store it in your password manager: it goes\n'
  printf 'into a GitHub secret, and losing it means losing the ability to sign updates.\n\n'
  printf 'Store password: '
  read -rs PASS; printf '\n'
  printf 'Again:          '
  read -rs PASS2; printf '\n'
  [ "$PASS" = "$PASS2" ] || { echo "Passwords did not match." >&2; exit 1; }
fi
[ ${#PASS} -ge 6 ] || { echo "keytool requires at least 6 characters." >&2; exit 1; }

echo
echo "Creating $OUT (alias: $ALIAS)"
# -validity 10950 is 30 years: the Play Store's minimum is 25 and an expired key cannot sign.
# The password goes through the environment, not the command line, so it stays out of ps.
KEYTOOL_PASS="$PASS" "$KEYTOOL" -genkeypair \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10950 \
  -dname "$DNAME" \
  -storepass:env KEYTOOL_PASS

echo
echo "Certificate:"
# -J-Duser.language=en because keytool localises its labels, and "Alias name"/"Owner:"/"Valid
# from" are the English ones; on a Chinese system this grep would otherwise match nothing and
# the summary would print an empty list.
KEYTOOL_PASS="$PASS" "$KEYTOOL" -J-Duser.language=en -list -v \
  -keystore "$OUT" -alias "$ALIAS" -storepass:env KEYTOOL_PASS \
  | grep -E "Alias name|Owner:|Valid from" | sed 's/^/  /'

# --- the base64 form the workflow decodes ---------------------------------------------------
B64_FILE="$OUT.b64"
if base64 -i "$OUT" >/dev/null 2>&1; then
  base64 -i "$OUT" | tr -d '\n' > "$B64_FILE"     # macOS
else
  base64 -w0 "$OUT" > "$B64_FILE"                 # GNU coreutils
fi
pbcopy < "$B64_FILE" 2>/dev/null || true

cat <<EOF

$(printf '=%.0s' $(seq 1 74))
Keystore:  $OUT
Base64:    $B64_FILE$([ -n "${KEYSTORE_PASSWORD:-}" ] || printf '  (also on your clipboard)')
Alias:     $ALIAS

Add these three at
  https://github.com/vychodlc/GetGoodBody/settings/secrets/actions
  (Settings -> Secrets and variables -> Actions -> New repository secret)

  ANDROID_KEYSTORE_B64       the whole contents of the .b64 file, one line
  ANDROID_KEYSTORE_PASSWORD  the password you just chose
  ANDROID_KEY_ALIAS          $ALIAS

Then re-run the Release — Actions -> Release -> Run workflow -> tag: v1.0.0

BACK UP $OUT NOW. Without it you cannot sign an update for any device that
already has the app; each one would have to be uninstalled and reinstalled.
$(printf '=%.0s' $(seq 1 74))
EOF
