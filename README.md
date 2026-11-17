# obsidian-flatten-notes

Flatten an Obsidian note and every note it links to (up to N levels of `[[wikilinks]]`) into a single Markdown file. The goal is to give an LLM the full context of a topic in one paste or one attachment.

Two tools, same result:

- an **Obsidian plugin** (command + small window to pick the depth)
- a **Python script** for the terminal

Typical use: point it at a hub note (a map of content, an index, a project page) and get everything it links to as one file.

## How it works

1. Start from a note (level 0).
2. Follow its `[[links]]` to get level 1, then follow the links of those notes for level 2, and so on.
3. Each note is included only once.
4. Everything is written in one file: an intro for the LLM (goal, parameters, size estimate), then the notes ordered by level, each one under a `===== Name (niveau N) =====` header.

Links are resolved by file name anywhere in the vault, like Obsidian does. Links to notes that do not exist are ignored.

## Install the Obsidian plugin

Requirements: Obsidian 1.0.0 or newer. No build step, the plugin is plain JavaScript.

```bash
git clone <this repo> obsidian-flatten-notes
cd obsidian-flatten-notes
./install.sh /path/to/your/vault
```

`install.sh` copies the `plugin/` folder to `<vault>/.obsidian/plugins/flatten-notes`. Use `--link` instead of copying if you want to edit the plugin and see the changes after a reload:

```bash
./install.sh /path/to/your/vault --link
```

Manual install: copy `plugin/manifest.json`, `plugin/main.js` and `plugin/styles.css` into `<vault>/.obsidian/plugins/flatten-notes/`.

Then in Obsidian: **Settings > Community plugins**, reload the list, and enable **Flatten Notes**.

### Use it

1. Open the starting note.
2. Open the command palette (`Ctrl/Cmd + P`) and run **Flatten the active note and its links** (or right click the note and pick **Aplatir avec les notes liees**).
3. Click a row of the table to choose the depth (1 to 6). It shows the number of notes and an estimate of the tokens.
4. Optional: strip the frontmatter, add or remove the intro block.
5. Click **Copier** (clipboard), **Enregistrer une note** (creates `flattened/contexte_<note>_<N>niveaux.md` in the vault) or **Les deux**.

The output folder can be changed in the plugin settings (default: `flattened`).

## Use the Python script

Requirements: Python 3.9 or newer, no dependencies.

```bash
python3 scripts/flatten_notes.py "Project Index" --vault ~/MyVault -d 3 --no-frontmatter
```

| Option | Meaning |
|---|---|
| `start` | name of the starting note, without `.md` |
| `-d`, `--depth` | levels of links to follow (default 3) |
| `--vault` | vault root (default: `$OBSIDIAN_VAULT`, or the current folder) |
| `-o`, `--output` | output file (default: `<vault>/flattened/contexte_<note>_<N>niveaux.md`) |
| `--no-frontmatter` | strip the YAML frontmatter of each note |
| `--no-intro` | do not add the intro block |

You can export `OBSIDIAN_VAULT` once so you do not have to pass `--vault`:

```bash
export OBSIDIAN_VAULT=~/MyVault
python3 scripts/flatten_notes.py "Project Index" -d 2
```

## Good to know

- Token counts are rough estimates (characters / 4), not a real tokenizer.
- The generated file is a normal note when it lands in the vault: it contains the wikilinks of all the included notes, so it can show up in search and add backlinks in the graph. Change the output folder (or exclude it from search) if that bothers you.
- Depth grows fast: on a large vault, 5 levels can pull in hundreds of notes. Check the estimate first.
- The intro block is written in French. Edit the `INTRO` text in `scripts/flatten_notes.py` and the `INTRO` constant in `plugin/main.js` to change it.

## Troubleshooting

- **The plugin does not appear:** check that the folder is `<vault>/.obsidian/plugins/flatten-notes/` and contains `manifest.json`, then reload the plugin list.
- **Nothing happens when running the command:** open the developer console (`Ctrl+Shift+I`) and look for an error from `flatten-notes`.
- **`Note not found` in the script:** pass the exact file name without `.md`, and check `--vault` points to the vault root.
