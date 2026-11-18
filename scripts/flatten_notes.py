#!/usr/bin/env python3

import argparse
import os
import re
import sys
from collections import deque
from datetime import date
from pathlib import Path

SKIP_DIRS = {".git", ".obsidian", ".trash"}
LINK = re.compile(r"(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
FRONT = re.compile(r"\A---\n.*?\n---\n", re.S)

INTRO = """# CONTEXT: knowledge base to learn

## Purpose of this document
This file gathers the note **{start}** and every note linked to it (through
Obsidian [[wikilinks]]) over **{depth} levels** into a single document.
Your role: **learn and memorize these notes** and use them as the user's
personal knowledge base. Rely on them first when answering, name the source
note when it helps, and say clearly when something is not in these notes
instead of making it up.

## Extraction parameters
- Starting note: {start}
- Depth: {depth} level(s) of links
- Notes included: {notes} ({detail})
- Size: {chars} characters, about {tokens} tokens (estimate: characters / 4)
- Links to missing notes (ignored): {missing}
- Generated on: {date}

## Structure
Notes are ordered by depth level (0 = starting note, 1 = directly linked
notes, and so on). Each note starts with `===== Name (level N) =====`
followed by its original path as a comment. A note appears only once, even if
several notes link to it."""

REPLY = {
    "none": "",
    "en": "Always reply in English.",
    "fr": "Always reply in French.",
}

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
    ap.add_argument("-d", "--depth", type=int, default=3, help="levels of links to follow (default 3)")
    ap.add_argument("-o", "--output", help="output file (default: <vault>/flattened/context_<note>_<N>levels.md)")
    ap.add_argument("--no-frontmatter", action="store_true", help="strip the YAML frontmatter")
    ap.add_argument("--reply-lang", choices=sorted(REPLY), default="none", help="add a last line telling the AI which language to answer in (default none)")
    ap.add_argument("--no-intro", action="store_true", help="do not add the intro block (goal, parameters, estimates)")
    ap.add_argument("--vault", default=os.environ.get("OBSIDIAN_VAULT", "."), help="vault root (or set OBSIDIAN_VAULT)")
    a = ap.parse_args()

    vault = Path(a.vault).expanduser()
    idx = index_vault(vault)
    start = idx.get(a.start.lower().removesuffix(".md"))
    if not start:
        sys.exit(f"Note not found: {a.start}")

    seen = {start}
    queue = deque([(start, 0)])
    parts, missing, counts = [], set(), {}
    while queue:
        path, level = queue.popleft()
        text = path.read_text(encoding="utf-8", errors="replace")
        body = FRONT.sub("", text, count=1) if a.no_frontmatter else text
        parts.append(f"\n\n# ===== {path.stem} (level {level}) =====\n"
                     f"<!-- {path.relative_to(vault)} -->\n\n{body.strip()}\n")
        counts[level] = counts.get(level, 0) + 1
        if level >= a.depth:
            continue
        for name in LINK.findall(text):
            target = idx.get(name.strip().lower())
            if target is None:
                missing.add(name.strip())
            elif target not in seen:
                seen.add(target)
                queue.append((target, level + 1))

    body_out = "".join(parts).lstrip()
    out = body_out
    if not a.no_intro:
        detail = ", ".join(f"level {k}: {v}" for k, v in sorted(counts.items()))
        text = INTRO.format(
            start=start.stem, depth=a.depth, notes=len(seen), detail=detail,
            chars=len(body_out), tokens=len(body_out) // 4, missing=len(missing),
            date=date.today().isoformat(),
        )
        reply = REPLY[a.reply_lang]
        out = text + (f"\n\n{reply}" if reply else "") + "\n\n---\n\n" + body_out

    target = Path(a.output) if a.output else vault / "flattened" / f"context_{start.stem}_{a.depth}levels.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(out, encoding="utf-8")
    print(f"{len(seen)} notes, {len(out)} chars (~{len(out)//4} tokens), "
          f"{len(missing)} links without a note -> {target}", file=sys.stderr)

if __name__ == "__main__":
    main()
