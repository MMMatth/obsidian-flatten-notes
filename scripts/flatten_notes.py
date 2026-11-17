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

INTRO = """# CONTEXTE : base de connaissances a apprendre

## But de ce document
Ce fichier rassemble en un seul document la note **{start}** et toutes les notes
qui lui sont liees (via des [[wikilinks]] Obsidian) sur **{depth} niveaux**.
Ton role : **apprendre et memoriser ces notes** pour t'en servir comme base de
connaissances personnelle de l'utilisateur. Appuie-toi dessus en priorite pour
repondre, cite le nom de la note source quand c'est utile, et dis clairement
quand une information n'est pas dans ces notes plutot que de l'inventer.

## Parametres de cette extraction
- Note de depart : {start}
- Profondeur : {depth} niveau(x) de liens
- Notes incluses : {notes} ({detail})
- Taille : {chars} caracteres, environ {tokens} tokens (estimation : caracteres / 4)
- Liens vers des notes inexistantes (ignores) : {missing}
- Genere le : {date}

## Structure
Les notes sont classees par niveau de profondeur (0 = note de depart, 1 = notes
liees directement, etc.). Chaque note commence par `===== Nom (niveau N) =====`
suivi de son chemin d'origine en commentaire. Une note n'apparait qu'une fois,
meme si plusieurs notes pointent vers elle.

---

"""

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
    ap.add_argument("-o", "--output", help="output file (default: <vault>/flattened/contexte_<note>_<N>niveaux.md)")
    ap.add_argument("--no-frontmatter", action="store_true", help="strip the YAML frontmatter")
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
        parts.append(f"\n\n# ===== {path.stem} (niveau {level}) =====\n"
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
        detail = ", ".join(f"niveau {k} : {v}" for k, v in sorted(counts.items()))
        out = INTRO.format(
            start=start.stem, depth=a.depth, notes=len(seen), detail=detail,
            chars=len(body_out), tokens=len(body_out) // 4, missing=len(missing),
            date=date.today().isoformat(),
        ) + body_out

    target = Path(a.output) if a.output else vault / "flattened" / f"contexte_{start.stem}_{a.depth}niveaux.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(out, encoding="utf-8")
    print(f"{len(seen)} notes, {len(out)} chars (~{len(out)//4} tokens), "
          f"{len(missing)} links without a note -> {target}", file=sys.stderr)

if __name__ == "__main__":
    main()
