#!/bin/sh
set -eu

release_base="https://github.com/bharathgedela/Noteleaf/releases/latest/download"
release_api="https://api.github.com/repos/bharathgedela/Noteleaf/releases/latest"
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
download_pid=""

cleanup() {
  if [ -n "$download_pid" ]; then kill "$download_pid" >/dev/null 2>&1 || true; fi
  if [ "$mounted" -eq 1 ]; then hdiutil detach "$mount_path" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$temporary_dir"
}
trap cleanup EXIT INT TERM

download_with_percentage() {
  download_url="$1"
  output_path="$2"
  total_bytes="$(
    curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location "$release_api" 2>/dev/null |
      awk -v asset="$asset_name" '
        index($0, "\"name\": \"" asset "\"") { matching_asset = 1 }
        matching_asset && index($0, "\"size\":") {
          gsub(/[^0-9]/, "", $0)
          size = $0
          matching_asset = 0
        }
        END { print size }
      '
  )"

  case "$total_bytes" in
    ''|*[!0-9]*) total_bytes=0 ;;
  esac

  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "$download_url" --output "$output_path" &
  download_pid=$!

  if [ "$total_bytes" -gt 0 ]; then total_mb=$(( (total_bytes + 1048575) / 1048576 )); fi
  while kill -0 "$download_pid" 2>/dev/null; do
    if [ -f "$output_path" ]; then
      downloaded_bytes="$(wc -c < "$output_path" | tr -d ' ')"
    else
      downloaded_bytes=0
    fi
    downloaded_mb=$(( downloaded_bytes / 1048576 ))

    if [ "$total_bytes" -gt 0 ]; then
      percentage=$(( downloaded_bytes * 100 / total_bytes ))
      [ "$percentage" -lt 100 ] || percentage=99
      printf '\rDownloading: %3d%% (%d MB / %d MB)' "$percentage" "$downloaded_mb" "$total_mb"
    else
      printf '\rDownloaded: %d MB' "$downloaded_mb"
    fi
    sleep 1
  done

  if wait "$download_pid"; then
    download_pid=""
    if [ "$total_bytes" -gt 0 ]; then
      printf '\rDownloading: 100%% (%d MB / %d MB)\n' "$total_mb" "$total_mb"
    else
      downloaded_bytes="$(wc -c < "$output_path" | tr -d ' ')"
      downloaded_mb=$(( downloaded_bytes / 1048576 ))
      printf '\rDownloaded: %d MB (complete)\n' "$downloaded_mb"
    fi
    return 0
  fi

  download_pid=""
  printf '\n' >&2
  return 1
}

echo "Downloading the latest Noteleaf release ($asset_name)..."
if ! download_with_percentage "$release_base/$asset_name" "$dmg_path"; then
  echo "A published Noteleaf macOS release could not be downloaded. Check https://github.com/bharathgedela/Noteleaf/releases and try again." >&2
  exit 1
fi

echo "Downloading and verifying the release checksum..."
if ! curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  "$release_base/SHA256SUMS.txt" --output "$checksums_path"; then
  echo "The Noteleaf release checksum could not be downloaded. Check https://github.com/bharathgedela/Noteleaf/releases and try again." >&2
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

echo "Verifying the app signature and Apple notarization..."
codesign --verify --deep --strict "$source_app" || { echo "The Noteleaf app signature is invalid. Installation was stopped." >&2; exit 1; }
if ! assessment="$(spctl --assess --type execute --verbose=2 "$source_app" 2>&1)"; then
  printf '%s\n' "$assessment" >&2
  echo "Apple Gatekeeper did not accept this app. Installation was stopped." >&2
  exit 1
fi
case "$assessment" in
  *"source=Notarized Developer ID"*) ;;
  *) echo "This app is not verified as an Apple-notarized release. Installation was stopped." >&2; exit 1 ;;
esac

install_dir="$HOME/Applications"
mkdir -p "$install_dir"
ditto "$source_app" "$install_dir/Noteleaf.app"
hdiutil detach "$mount_path" -quiet
mounted=0

echo "Noteleaf was installed in $install_dir."
open "$install_dir/Noteleaf.app"
