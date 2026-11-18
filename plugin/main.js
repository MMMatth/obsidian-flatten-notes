const { Plugin, Modal, Setting, Notice, PluginSettingTab, TFile, normalizePath } = require("obsidian");

const MAX_DEPTH = 6;
const DEFAULTS = { depth: 3, noFrontmatter: true, intro: true, outputDir: "flattened", replyLang: "none", template: "" };

const DEFAULT_INTRO = `# CONTEXT: knowledge base to learn

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
notes, and so on). Each note starts with \`===== Name (level N) =====\`
followed by its original path as a comment. A note appears only once, even if
several notes link to it.`;

const REPLY = {
  none: { name: "No instruction", line: "" },
  en: { name: "English", line: "Always reply in English." },
  fr: { name: "French", line: "Always reply in French." },
};

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

module.exports = class FlattenNotesPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());

    this.addCommand({
      id: "flatten-active-note",
      name: "Flatten the active note and its links",
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
            i.setTitle("Flatten with linked notes").setIcon("files").onClick(() => new FlattenModal(this.app, this, file).open())
          );
        }
      })
    );

    this.addSettingTab(new FlattenSettingTab(this.app, this));
  }

  saveSettings() { return this.saveData(this.settings); }

  template() {
    return this.settings.template || DEFAULT_INTRO;
  }

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
      parts.push(`\n\n# ===== ${file.basename} (level ${level}) =====\n<!-- ${file.path} -->\n\n${text.trim()}\n`);
    }
    const body = parts.join("").replace(/^\s+/, "");
    if (!intro) return { text: body, notes: list.length };
    const counts = {};
    list.forEach((x) => (counts[x.level] = (counts[x.level] || 0) + 1));
    const detail = Object.keys(counts).map((k) => `level ${k}: ${counts[k]}`).join(", ");
    const text = fill(this.template(), {
      start: start.basename, depth, notes: list.length, detail,
      chars: body.length, tokens: Math.round(body.length / 4), missing,
      date: new Date().toISOString().slice(0, 10),
    });
    const reply = (REPLY[this.settings.replyLang] || REPLY.none).line;
    const head = text.trimEnd() + (reply ? `\n\n${reply}` : "") + "\n\n---\n\n";
    return { text: head + body, notes: list.length };
  }

  async saveToVault(text, name, depth) {
    const dir = normalizePath(this.settings.outputDir || "flattened");
    if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.createFolder(dir);
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    const path = normalizePath(`${dir}/context_${safe}_${depth}levels.md`);
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
    contentEl.createEl("h3", { text: `Flatten: ${this.file.basename}` });
    this.rows = this.plugin.stats(this.file);

    contentEl.createEl("p", { text: "Click a row to choose the depth (estimate: file size / 4)." });
    const table = contentEl.createEl("table", { cls: "flatten-stats" });
    const head = table.createEl("tr");
    ["Levels", "Notes", "Tokens (~)"].forEach((t) => head.createEl("th", { text: t }));
    this.trs = {};
    for (const r of this.rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: String(r.depth) });
      tr.createEl("td", { text: String(r.notes) });
      tr.createEl("td", { text: r.tokens.toLocaleString("en-US") });
      tr.onclick = () => this.select(r.depth);
      this.trs[r.depth] = tr;
    }
    this.select(Math.min(this.s.depth, MAX_DEPTH));

    new Setting(contentEl)
      .setName("Reply language")
      .setDesc("Adds a last line to the prompt telling the AI which language to answer in.")
      .addDropdown((d) => {
        Object.keys(REPLY).forEach((k) => d.addOption(k, REPLY[k].name));
        d.setValue(this.s.replyLang).onChange(async (v) => { this.s.replyLang = v; await this.plugin.saveSettings(); });
      });
    new Setting(contentEl).setName("Strip frontmatter").addToggle((t) =>
      t.setValue(this.s.noFrontmatter).onChange(async (v) => { this.s.noFrontmatter = v; await this.plugin.saveSettings(); })
    );
    new Setting(contentEl).setName("Add the intro block (goal, parameters, estimates)").addToggle((t) =>
      t.setValue(this.s.intro).onChange(async (v) => { this.s.intro = v; await this.plugin.saveSettings(); })
    );

    const buttons = new Setting(contentEl);
    buttons.addButton((b) => b.setButtonText("Copy").setCta().onClick(() => this.run("copy")));
    buttons.addButton((b) => b.setButtonText("Save as a note").onClick(() => this.run("file")));
    buttons.addButton((b) => b.setButtonText("Both").onClick(() => this.run("both")));
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
        msgs.push("copied to the clipboard");
      }
      if (mode === "file" || mode === "both") {
        const p = await this.plugin.saveToVault(text, this.file.basename, this.s.depth);
        msgs.push(`note created: ${p}`);
      }
      new Notice(`${notes} notes (~${Math.round(text.length / 4).toLocaleString("en-US")} tokens): ${msgs.join(" and ")}`, 8000);
      this.close();
    } catch (e) {
      console.error(e);
      new Notice("Flatten Notes: error, see the console (" + e.message + ")");
    }
  }

  onClose() { this.contentEl.empty(); }
}

class FlattenSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Output folder (inside the vault)")
      .setDesc("Vault folder where the flattened note is created. Default: +")
      .addText((t) =>
        t.setPlaceholder("flattened").setValue(settings.outputDir).onChange(async (v) => {
          settings.outputDir = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default reply language")
      .setDesc("Adds a last line at the end of the intro, e.g. \"Always reply in French.\" Can also be changed in the window.")
      .addDropdown((d) => {
        Object.keys(REPLY).forEach((k) => d.addOption(k, REPLY[k].name));
        d.setValue(settings.replyLang).onChange(async (v) => { settings.replyLang = v; await this.plugin.saveSettings(); });
      });

    const setting = new Setting(containerEl)
      .setName("Intro block (the context given to the AI)")
      .setDesc("Placeholders: {start} {depth} {notes} {detail} {chars} {tokens} {missing} {date}")
      .setClass("flatten-template-setting");
    let area;
    setting.addTextArea((ta) => {
      area = ta;
      ta.setValue(this.plugin.template()).onChange(async (v) => {
        settings.template = v === DEFAULT_INTRO ? "" : v;
        await this.plugin.saveSettings();
      });
      ta.inputEl.addClass("flatten-template");
    });
    setting.addExtraButton((b) =>
      b.setIcon("reset").setTooltip("Reset to the default text").onClick(async () => {
        settings.template = "";
        await this.plugin.saveSettings();
        area.setValue(DEFAULT_INTRO);
      })
    );
  }
}
