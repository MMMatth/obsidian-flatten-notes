const { Plugin, Modal, Setting, Notice, PluginSettingTab, TFile, normalizePath } = require("obsidian");

const MAX_DEPTH = 6;
const DEFAULTS = { depth: 3, noFrontmatter: true, intro: true, outputDir: "flattened" };

const INTRO = (p) => `# CONTEXTE : base de connaissances a apprendre

## But de ce document
Ce fichier rassemble en un seul document la note **${p.start}** et toutes les notes
qui lui sont liees (via des [[wikilinks]] Obsidian) sur **${p.depth} niveaux**.
Ton role : **apprendre et memoriser ces notes** pour t'en servir comme base de
connaissances personnelle de l'utilisateur. Appuie-toi dessus en priorite pour
repondre, cite le nom de la note source quand c'est utile, et dis clairement
quand une information n'est pas dans ces notes plutot que de l'inventer.

## Parametres de cette extraction
- Note de depart : ${p.start}
- Profondeur : ${p.depth} niveau(x) de liens
- Notes incluses : ${p.notes} (${p.detail})
- Taille : ${p.chars} caracteres, environ ${p.tokens} tokens (estimation : caracteres / 4)
- Liens vers des notes inexistantes (ignores) : ${p.missing}
- Genere le : ${p.date}

## Structure
Les notes sont classees par niveau de profondeur (0 = note de depart, 1 = notes
liees directement, etc.). Chaque note commence par \`===== Nom (niveau N) =====\`
suivi de son chemin d'origine en commentaire. Une note n'apparait qu'une fois,
meme si plusieurs notes pointent vers elle.

---

`;

module.exports = class FlattenNotesPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());

    this.addCommand({
      id: "flatten-active-note",
      name: "Aplatir la note active et ses liens",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) new FlattenModal(this.app, this, f).open();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((i) =>
            i.setTitle("Aplatir avec les notes liees").setIcon("files").onClick(() => new FlattenModal(this.app, this, file).open())
          );
        }
      })
    );

    this.addSettingTab(new FlattenSettingTab(this.app, this));
  }

  saveSettings() { return this.saveData(this.settings); }

  collect(start, depth) {
    const seen = new Set([start.path]);
    const list = [{ file: start, level: 0 }];
    let missing = 0;
    for (let i = 0; i < list.length; i++) {
      const { file, level } = list[i];
      if (level >= depth) continue;
      const links = (this.app.metadataCache.getFileCache(file) || {}).links || [];
      for (const l of links) {
        const target = this.app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0], file.path);
        if (!target || target.extension !== "md") { missing++; continue; }
        if (seen.has(target.path)) continue;
        seen.add(target.path);
        list.push({ file: target, level: level + 1 });
      }
    }
    return { list, missing };
  }

  stats(start) {
    const { list } = this.collect(start, MAX_DEPTH);
    const rows = [];
    for (let d = 1; d <= MAX_DEPTH; d++) {
      const sel = list.filter((x) => x.level <= d);
      const bytes = sel.reduce((s, x) => s + x.file.stat.size, 0);
      rows.push({ depth: d, notes: sel.length, tokens: Math.round(bytes / 4) });
    }
    return rows;
  }

  async build(start, depth, noFrontmatter, intro) {
    const { list, missing } = this.collect(start, depth);
    const parts = [];
    for (const { file, level } of list) {
      let text = await this.app.vault.cachedRead(file);
      if (noFrontmatter) text = text.replace(/^---\n[\s\S]*?\n---\n/, "");
      parts.push(`\n\n# ===== ${file.basename} (niveau ${level}) =====\n<!-- ${file.path} -->\n\n${text.trim()}\n`);
    }
    const body = parts.join("").replace(/^\s+/, "");
    if (!intro) return { text: body, notes: list.length };
    const counts = {};
    list.forEach((x) => (counts[x.level] = (counts[x.level] || 0) + 1));
    const detail = Object.keys(counts).map((k) => `niveau ${k} : ${counts[k]}`).join(", ");
    const head = INTRO({
      start: start.basename, depth, notes: list.length, detail,
      chars: body.length, tokens: Math.round(body.length / 4), missing,
      date: new Date().toISOString().slice(0, 10),
    });
    return { text: head + body, notes: list.length };
  }

  async saveToVault(text, name, depth) {
    const dir = normalizePath(this.settings.outputDir || "flattened");
    if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.createFolder(dir);
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    const path = normalizePath(`${dir}/contexte_${safe}_${depth}niveaux.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, text);
    else await this.app.vault.create(path, text);
    return path;
  }
};

class FlattenModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.s = plugin.settings;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: `Aplatir : ${this.file.basename}` });
    this.rows = this.plugin.stats(this.file);

    contentEl.createEl("p", { text: "Clique une ligne pour choisir la profondeur (estimation : taille des fichiers / 4)." });
    const table = contentEl.createEl("table", { cls: "flatten-stats" });
    const head = table.createEl("tr");
    ["Niveaux", "Notes", "Tokens (~)"].forEach((t) => head.createEl("th", { text: t }));
    this.trs = {};
    for (const r of this.rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: String(r.depth) });
      tr.createEl("td", { text: String(r.notes) });
      tr.createEl("td", { text: r.tokens.toLocaleString("fr-FR") });
      tr.onclick = () => this.select(r.depth);
      this.trs[r.depth] = tr;
    }
    this.select(Math.min(this.s.depth, MAX_DEPTH));

    new Setting(contentEl).setName("Sans frontmatter").addToggle((t) =>
      t.setValue(this.s.noFrontmatter).onChange(async (v) => { this.s.noFrontmatter = v; await this.plugin.saveSettings(); })
    );
    new Setting(contentEl).setName("Ajouter l'introduction (but, parametres, estimations)").addToggle((t) =>
      t.setValue(this.s.intro).onChange(async (v) => { this.s.intro = v; await this.plugin.saveSettings(); })
    );

    const buttons = new Setting(contentEl);
    buttons.addButton((b) => b.setButtonText("Copier").setCta().onClick(() => this.run("copy")));
    buttons.addButton((b) => b.setButtonText("Enregistrer une note").onClick(() => this.run("file")));
    buttons.addButton((b) => b.setButtonText("Les deux").onClick(() => this.run("both")));
  }

  select(depth) {
    this.s.depth = depth;
    Object.values(this.trs).forEach((tr) => tr.removeClass("is-selected"));
    this.trs[depth].addClass("is-selected");
    this.plugin.saveSettings();
  }

  async run(mode) {
    try {
      const { text, notes } = await this.plugin.build(this.file, this.s.depth, this.s.noFrontmatter, this.s.intro);
      const msgs = [];
      if (mode === "copy" || mode === "both") {
        await navigator.clipboard.writeText(text);
        msgs.push("copie dans le presse-papier");
      }
      if (mode === "file" || mode === "both") {
        const p = await this.plugin.saveToVault(text, this.file.basename, this.s.depth);
        msgs.push(`note creee : ${p}`);
      }
      new Notice(`${notes} notes (~${Math.round(text.length / 4).toLocaleString("fr-FR")} tokens) : ${msgs.join(" et ")}`, 8000);
      this.close();
    } catch (e) {
      console.error(e);
      new Notice("Flatten Notes : erreur, voir la console (" + e.message + ")");
    }
  }

  onClose() { this.contentEl.empty(); }
}

class FlattenSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Dossier de sortie (dans le vault)")
      .setDesc("Dossier du vault ou la note aplatie est creee. Par defaut : +")
      .addText((t) =>
        t.setPlaceholder("flattened").setValue(this.plugin.settings.outputDir).onChange(async (v) => {
          this.plugin.settings.outputDir = v.trim();
          await this.plugin.saveSettings();
        })
      );
  }
}
