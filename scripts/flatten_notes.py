#!/usr/bin/env python3

import argparse
import re
import sys
from collections import deque
from pathlib import Path

SKIP_DIRS = {".git", ".obsidian", ".trash"}
FRONT = re.compile(r"\A---\n.*?\n---\n", re.S)
LINK = re.compile(r"(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")

def index_vault(vault):
    idx = {}
    for p in vault.rglob("*.md"):
        if SKIP_DIRS & set(p.relative_to(vault).parts):
            continue
        idx.setdefault(p.stem.lower(), p)
    return idx

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("start", help="name of the starting note (without .md)")
    ap.add_argument("-d", "--depth", type=int, default=3)
    ap.add_argument("--no-frontmatter", action="store_true", help="strip the YAML frontmatter")
    ap.add_argument("--vault", default=".")
    a = ap.parse_args()

    vault = Path(a.vault)
    idx = index_vault(vault)
    start = idx.get(a.start.lower())
    if not start:
        sys.exit(f"Note not found: {a.start}")

    seen = {start}
    queue = deque([(start, 0)])
    while queue:
        path, level = queue.popleft()
        text = path.read_text(encoding="utf-8", errors="replace")
        body = FRONT.sub("", text, count=1) if a.no_frontmatter else text
        print(f"\n# ===== {path.stem} (level {level}) =====\n\n{body.strip()}\n")
        if level >= a.depth:
            continue
        for name in LINK.findall(text):
            target = idx.get(name.strip().lower())
            if target and target not in seen:
                seen.add(target)
                queue.append((target, level + 1))

    print(f"{len(seen)} notes", file=sys.stderr)

if __name__ == "__main__":
    main()
