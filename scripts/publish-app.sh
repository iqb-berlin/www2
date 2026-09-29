#!/usr/bin/env bash
# Publish a ClickOnce app to the www2 /it/ section (Linux/macOS variant of publish-app.ps1).
#
#   scripts/publish-app.sh <App> <publish-dir> [server]
#
# Token: environment variable WWW2_UPLOAD_TOKEN.
# Set FORCE=1 to upload even if the manifest's deploymentProvider points elsewhere.
set -euo pipefail

app="${1:-}"
dir="${2:-}"
server="${3:-https://www2.iqb.hu-berlin.de}"
server="${server%/}"
token="${WWW2_UPLOAD_TOKEN:-}"

if [[ -z "$app" || -z "$dir" ]]; then
  echo "usage: $0 <App> <publish-dir> [server]" >&2
  exit 2
fi
[[ "$app" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || { echo "invalid app id '$app'" >&2; exit 2; }
[[ -n "$token" ]] || { echo "WWW2_UPLOAD_TOKEN is not set" >&2; exit 2; }
[[ -f "$dir/setup.exe" ]] || { echo "setup.exe not found in $dir" >&2; exit 1; }
[[ -d "$dir/Application Files" ]] || { echo "'Application Files' folder not found in $dir" >&2; exit 1; }
mapfile -t manifests < <(find "$dir" -maxdepth 1 -type f -iname '*.application')
[[ ${#manifests[@]} -eq 1 ]] || { echo "expected exactly one *.application in $dir, found ${#manifests[@]}" >&2; exit 1; }
if ! command -v zip >/dev/null && ! command -v python3 >/dev/null; then
  echo "either zip or python3 is required" >&2; exit 1
fi
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

version=$(grep -o '<assemblyIdentity[^>]*version="[0-9.]*"' "${manifests[0]}" | head -1 | grep -o 'version="[^"]*"' | cut -d'"' -f2)
provider=$(grep -o '<deploymentProvider[^>]*codebase="[^"]*"' "${manifests[0]}" | sed 's/.*codebase="//;s/"$//' || true)
expected="$server/it/dl/$app/"
echo "App:      $app"
echo "Version:  $version"
echo "Provider: ${provider:-<none>}"
if [[ -n "$provider" && "${provider,,}" != "${expected,,}"* ]]; then
  if [[ "${FORCE:-0}" == "1" ]]; then
    echo "warning: deploymentProvider does not start with $expected (continuing because FORCE=1)" >&2
  else
    echo "deploymentProvider must start with $expected - fix the publish settings or set FORCE=1" >&2
    exit 1
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
zipfile="$tmp/$app.zip"
if command -v zip >/dev/null; then
  (cd "$dir" && zip -qr "$zipfile" .)
else
  (cd "$dir" && python3 -c 'import sys,os,zipfile
z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)
for root,dirs,files in os.walk("."):
    for f in files:
        p=os.path.join(root,f); z.write(p,os.path.relpath(p,"."))
z.close()' "$zipfile")
fi
echo "Uploading $(du -h "$zipfile" | cut -f1) to $server/it/api/apps/$app ..."
http_code=$(curl -sS -o "$tmp/response.json" -w '%{http_code}' \
  -X PUT "$server/it/api/apps/$app" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/zip" \
  --data-binary "@$zipfile")
cat "$tmp/response.json"; echo
if [[ "$http_code" != "200" && "$http_code" != "201" ]]; then
  echo "upload failed with HTTP $http_code" >&2
  exit 1
fi
