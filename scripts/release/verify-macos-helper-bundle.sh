#!/bin/bash

set -euo pipefail

app_path="${1:?Usage: verify-macos-helper-bundle.sh /path/to/Trace.app}"
test "$(/usr/bin/id -u)" -ne 0 || {
  echo "The helper relocation fixture must run as a non-root user." >&2
  exit 1
}
test -d "$app_path" || {
  echo "Trace app bundle does not exist: $app_path" >&2
  exit 1
}

fixture_root="$(/usr/bin/mktemp -d "${TMPDIR:-/private/tmp}/trace-helper-fixture.XXXXXX")"
cleanup() {
  /bin/chmod -R u+w "$fixture_root" 2>/dev/null || true
  /bin/rm -rf "$fixture_root"
}
trap cleanup EXIT

helper_bundle="$fixture_root/Library/PrivilegedHelperTools/com.isaiahw.matchlens.capture-helper.app"
/bin/mkdir -p "$(/usr/bin/dirname "$helper_bundle")"
/usr/bin/ditto "$app_path" "$helper_bundle"
/bin/chmod -R go-w "$helper_bundle"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$helper_bundle"

executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
  "$helper_bundle/Contents/Info.plist")"
helper_executable="$helper_bundle/Contents/MacOS/$executable_name"
helper_log="$fixture_root/helper.log"

"$helper_executable" --match-lens-capture-helper "$(/usr/bin/id -u)" \
  >"$helper_log" 2>&1
/usr/bin/grep -Fq \
  'Trace capture helper: The capture helper must run as root through launchd.' \
  "$helper_log"

echo "macOS signed helper bundle relocation fixture passed."
