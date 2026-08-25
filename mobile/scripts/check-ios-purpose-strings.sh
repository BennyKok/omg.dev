#!/usr/bin/env bash
# Assert the GENERATED Info.plist, not app.json.
#
# WHY THIS EXISTS. Build 34 shipped
# "Allow $(PRODUCT_NAME) to access your microphone" and was rejected under
# guideline 5.1.1(ii) -- twice. app.json held a long, specific string the
# whole time. The @siteed/audio-studio config plugin overwrites
# NSMicrophoneUsageDescription with its own default, because the value from
# `ios.infoPlist` is not yet in modResults when that plugin's mod runs. Reading
# app.json therefore proves nothing. Only the prebuild output does.
#
# Runs prebuild in a THROWAWAY COPY. A leftover `ios/` directory in the real
# tree would flip EAS to the bare workflow and ignore app.json entirely.
set -euo pipefail

MIN_LEN=${MIN_LEN:-80}
KEYS=(NSMicrophoneUsageDescription NSCameraUsageDescription NSPhotoLibraryUsageDescription NSUserNotificationsUsageDescription)

here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# node_modules is needed for the config plugins to resolve, and copying it is
# far slower than linking it.
tar -c --exclude=node_modules --exclude=ios --exclude=android --exclude=.git -C "$here" . | tar -x -C "$tmp"
ln -s "$here/node_modules" "$tmp/node_modules"

( cd "$tmp" && npx --yes expo prebuild --platform ios --no-install >/dev/null 2>&1 )

plist=$(find "$tmp/ios" -name Info.plist -not -path '*/Pods/*' | head -1)
if [ -z "$plist" ]; then
  echo "::error::prebuild produced no Info.plist" >&2
  exit 1
fi

fail=0
for key in "${KEYS[@]}"; do
  value=$(/usr/bin/env python3 - "$plist" "$key" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as fh:
    print(plistlib.load(fh).get(sys.argv[2], ''))
PY
)
  if [ -z "$value" ]; then
    echo "::error::$key is missing from the generated Info.plist" >&2
    fail=1
    continue
  fi
  # The two known-bad shapes: a config plugin's generic default, and anything
  # too short to name the data, the recipient and an example.
  if [[ "$value" == *'$(PRODUCT_NAME)'* ]] || [[ "$value" == Allow\ * ]]; then
    echo "::error::$key is a config plugin default, not ours: $value" >&2
    fail=1
    continue
  fi
  if [ "${#value}" -lt "$MIN_LEN" ]; then
    echo "::error::$key is only ${#value} chars, under $MIN_LEN: $value" >&2
    fail=1
    continue
  fi
  echo "ok  $key  (${#value} chars)"
done

exit $fail
