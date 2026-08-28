#!/bin/sh
set -eu

release_base="https://github.com/bharathgedela/notes_app/releases/latest/download"
case "$(uname -m)" in
  arm64) asset_name="Noteleaf-arm64.dmg" ;;
  x86_64) asset_name="Noteleaf-x64.dmg" ;;
  *) echo "Noteleaf supports Apple Silicon and Intel Macs." >&2; exit 1 ;;
esac

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/noteleaf-install.XXXXXX")"
dmg_path="$temporary_dir/$asset_name"
checksums_path="$temporary_dir/SHA256SUMS.txt"
mount_path="$temporary_dir/mount"
mounted=0

cleanup() {
  if [ "$mounted" -eq 1 ]; then hdiutil detach "$mount_path" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$temporary_dir"
}
trap cleanup EXIT INT TERM

echo "Downloading the latest Noteleaf release..."
if ! curl --proto '=https' --tlsv1.2 -fsSL "$release_base/$asset_name" -o "$dmg_path" || \
   ! curl --proto '=https' --tlsv1.2 -fsSL "$release_base/SHA256SUMS.txt" -o "$checksums_path"; then
  echo "A published Noteleaf macOS release could not be downloaded. Check https://github.com/bharathgedela/notes_app/releases and try again." >&2
  exit 1
fi

expected_hash="$(awk -v name="$asset_name" '$2 == name || $2 == "*" name { print $1; exit }' "$checksums_path")"
[ -n "$expected_hash" ] || { echo "The release checksum for $asset_name is missing." >&2; exit 1; }
actual_hash="$(shasum -a 256 "$dmg_path" | awk '{ print $1 }')"
[ "$actual_hash" = "$expected_hash" ] || { echo "The Noteleaf installer checksum did not match. Installation was stopped." >&2; exit 1; }

echo "Checksum verified. Installing Noteleaf..."
mkdir -p "$mount_path"
hdiutil attach "$dmg_path" -nobrowse -quiet -mountpoint "$mount_path"
mounted=1
source_app="$(find "$mount_path" -maxdepth 1 -name 'Noteleaf.app' -print -quit)"
[ -n "$source_app" ] || { echo "Noteleaf.app was not found in the downloaded DMG." >&2; exit 1; }

install_dir="$HOME/Applications"
mkdir -p "$install_dir"
ditto "$source_app" "$install_dir/Noteleaf.app"
hdiutil detach "$mount_path" -quiet
mounted=0

echo "Noteleaf was installed in $install_dir."
open "$install_dir/Noteleaf.app"
