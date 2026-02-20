// ═══════════════════════════════════════
// TAGGING MODALS — Set story-date & story-arc via UI
// ═══════════════════════════════════════

import { App, Modal, Notice, Setting, SuggestModal, TFile } from 'obsidian';
import type StoryboardCanvasPlugin from '../main';

// ─── Frontmatter Helpers ─────────────────────────────────────

/**
 * Update a single frontmatter key in a file.
 * Creates frontmatter block if none exists.
 */
export async function setFrontmatterKey(
  app: App,
  file: TFile,
  key: string,
  value: string,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[key] = value;
  });
}

/**
 * Scan vault for all unique values of a frontmatter key.
 */
export function collectFrontmatterValues(app: App, key: string): string[] {
  const values = new Set<string>();
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) continue;
    const val = cache.frontmatter[key];
    if (typeof val === 'string' && val.trim()) {
      values.add(val.trim());
    }
  }

  return [...values].sort();
}

// ─── Set Date Modal ──────────────────────────────────────────

export class SetDateModal extends Modal {
  private file: TFile;
  private onComplete: () => void;
  private value: string;
  private plugin: StoryboardCanvasPlugin;

  constructor(plugin: StoryboardCanvasPlugin, file: TFile, onComplete: () => void = () => {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.onComplete = onComplete;

    // Pre-populate from existing frontmatter
    const cache = plugin.app.metadataCache.getFileCache(file);
    this.value = cache?.frontmatter?.['story-date']?.toString() ?? '';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: `Set date: ${this.file.basename}` });

    new Setting(contentEl)
      .setName('Story date')
      .setDesc('Format: YYYY-MM-DD (e.g. 2024-06-15) or fantasy format')
      .addText(text => {
        text.setPlaceholder('1000-03-15')
          .setValue(this.value)
          .onChange(v => { this.value = v; });
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.save();
          }
        });
        // Auto-focus
        setTimeout(() => text.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Save')
        .setCta()
        .onClick(() => this.save()));
  }

  private async save(): Promise<void> {
    const trimmed = this.value.trim();
    if (!trimmed) {
      new Notice('Date cannot be empty.');
      return;
    }

    // Validate against parser regex
    const regex = this.plugin.settings.dateSettings.dateParserRegex;
    const match = new RegExp(regex).test(trimmed);
    if (!match) {
      new Notice(`Invalid date format. Needs to match regex:\n${regex}`);
      return;
    }

    await setFrontmatterKey(this.app, this.file, 'story-date', trimmed);
    new Notice(`Set story-date: ${trimmed}`);
    this.close();
    this.onComplete();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── Set Arc Modal (Suggest) ─────────────────────────────────

export class SetArcModal extends SuggestModal<string> {
  private file: TFile;
  private onComplete: () => void;
  private plugin: StoryboardCanvasPlugin;

  constructor(plugin: StoryboardCanvasPlugin, file: TFile, onComplete: () => void = () => {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.onComplete = onComplete;
    this.setPlaceholder('Type an arc name or select existing...');
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'select or create new' },
      { command: 'esc', purpose: 'cancel' },
    ]);
  }

  getSuggestions(query: string): string[] {
    const existing = collectFrontmatterValues(this.app, 'story-arc');
    const lowerQuery = query.toLowerCase().trim();

    const filtered = existing.filter(a => a.toLowerCase().includes(lowerQuery));

    // If typed text doesn't exactly match any existing arc, offer to create it
    if (lowerQuery && !existing.some(a => a.toLowerCase() === lowerQuery)) {
      filtered.unshift(`+ Create "${query.trim()}"`);
    }

    return filtered.length > 0 ? filtered : [`+ Create "${query.trim() || 'default'}"`];
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.createEl('span', { text: value });
  }

  async onChooseSuggestion(value: string): Promise<void> {
    let arcName = value;

    // Handle "create new" option
    const match = value.match(/^\+ Create "(.+)"$/);
    if (match) {
      arcName = match[1];
    }

    await setFrontmatterKey(this.app, this.file, 'story-arc', arcName);
    new Notice(`Set story-arc: ${arcName}`);
    this.onComplete();
  }
}

// ─── Combined Tag Scene Modal ────────────────────────────────

/**
 * Two-step tagging: date first, then arc.
 */
export function tagScene(plugin: StoryboardCanvasPlugin, file: TFile): void {
  new SetDateModal(plugin, file, () => {
    new SetArcModal(plugin, file).open();
  }).open();
}
