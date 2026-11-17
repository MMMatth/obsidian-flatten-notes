#!/usr/bin/env bash
set -euo pipefail

vault="${1:?usage: ./install.sh /path/to/vault [--link]}"
dest="$vault/.obsidian/plugins/flatten-notes"
src="$(cd "$(dirname "$0")" && pwd)/plugin"

[ -d "$vault/.obsidian" ] || { echo "$vault does not look like an Obsidian vault (no .obsidian folder)"; exit 1; }

mkdir -p "$vault/.obsidian/plugins"
rm -rf "$dest"
if [ "${2:-}" = "--link" ]; then
  ln -s "$src" "$dest"
  echo "Linked $dest -> $src"
else
  cp -r "$src" "$dest"
  echo "Copied plugin to $dest"
fi
echo "Now enable \"Flatten Notes\" in Settings > Community plugins."
