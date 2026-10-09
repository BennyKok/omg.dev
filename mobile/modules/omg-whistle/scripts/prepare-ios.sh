#!/bin/bash
set -euo pipefail
MODULE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$MODULE_ROOT/ios/vendor"
test -d "$VENDOR/NeedleEngine.xcframework" && exit 0
mkdir -p "$VENDOR/device" "$VENDOR/simulator"
BASE=https://huggingface.co/Cactus-Compute/needle3/resolve/2ae11323dc000f5e70c49f7403efa6af12ba9e67
curl --fail --location --retry 3 "$BASE/ios-arm64/libneedle.a" -o "$VENDOR/device/libneedle.a"
curl --fail --location --retry 3 "$BASE/ios-sim-arm64/libneedle.a" -o "$VENDOR/simulator/libneedle.a"
cd "$VENDOR"
printf '%s\n' '786dc45127b283c53a5d0a5f9764b21cab23be778630e9c0f1916460d7e33679  device/libneedle.a' 'ab96e33e501901ca22613219a5425eadfde7bdf04443ab263f5fd2287ee12823  simulator/libneedle.a' | shasum -a 256 --check
xcodebuild -create-xcframework -library "$VENDOR/device/libneedle.a" -headers "$MODULE_ROOT/ios/engine" -library "$VENDOR/simulator/libneedle.a" -headers "$MODULE_ROOT/ios/engine" -output "$VENDOR/NeedleEngine.xcframework"
