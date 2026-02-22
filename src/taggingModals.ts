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
  value: any,
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
    
    const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
    if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
    
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
    
    const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
    if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
    
    this.onComplete();
  }
}

// ─── Set Dependencies Modal ────────────────────────────────────

export class SetDependenciesModal extends SuggestModal<TFile> {
  private file: TFile;
  private onComplete: () => void;
  private plugin: StoryboardCanvasPlugin;
  private allFiles: TFile[];

  constructor(plugin: StoryboardCanvasPlugin, file: TFile, onComplete: () => void = () => {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.onComplete = onComplete;
    this.allFiles = this.app.vault.getMarkdownFiles().filter(f => f.path !== file.path);
    this.setPlaceholder('Select a file to depend on (or ESC to skip)...');
  }

  getSuggestions(query: string): TFile[] {
    const lowerQuery = query.toLowerCase();
    return this.allFiles.filter(f => f.basename.toLowerCase().includes(lowerQuery));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path, cls: 'storyflow-subtext' });
  }

  async onChooseSuggestion(targetFile: TFile): Promise<void> {
    // Ask if it's before or after
    new DependencyTypeModal(this.plugin, this.file, targetFile.basename, () => {
      // Re-open self to allow adding more dependencies
      new SetDependenciesModal(this.plugin, this.file, this.onComplete).open();
    }).open();
  }

  onClose() {
    super.onClose();
    // Use setTimeout so if we are just switching to DependencyTypeModal, we don't fire Complete early
    setTimeout(() => {
        if (!document.querySelector('.modal-container')) {
            this.onComplete();
        }
    }, 100);
  }
}

class DependencyTypeModal extends Modal {
  private plugin: StoryboardCanvasPlugin;
  private file: TFile;
  private targetBasename: string;
  private onComplete: () => void;

  constructor(plugin: StoryboardCanvasPlugin, file: TFile, targetBasename: string, onComplete: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.targetBasename = targetBasename;
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: `Dependency: ${this.targetBasename}` });
    contentEl.createEl('p', { text: `Does "${this.targetBasename}" happen BEFORE or AFTER "${this.file.basename}"?` });

    const btnContainer = contentEl.createDiv({ cls: 'storyflow-flex-row' });
    
    const beforeBtn = btnContainer.createEl('button', { text: 'Happens BEFORE' });
    beforeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.saveDependency('before');
      this.close();
    });

    const afterBtn = btnContainer.createEl('button', { text: 'Happens AFTER' });
    afterBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.saveDependency('after');
      this.close();
    });
  }

  private async saveDependency(type: 'before' | 'after') {
    const depStr = `${this.targetBasename}:${type}`;
    await this.app.fileManager.processFrontMatter(this.file, (fm) => {
      let deps = fm['story-deps'] || [];
      if (!Array.isArray(deps)) deps = [deps];
      if (!deps.includes(depStr)) deps = [...deps, depStr];
      fm['story-deps'] = deps;
    });

    // Two-way data binding
    const inverseType = type === 'before' ? 'after' : 'before';
    const inverseDepStr = `${this.file.basename}:${inverseType}`;
    
    const targetFile = this.app.vault.getMarkdownFiles().find(f => f.basename === this.targetBasename);
    if (targetFile) {
      await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
        let deps = fm['story-deps'] || [];
        if (!Array.isArray(deps)) deps = [deps];
        if (!deps.includes(inverseDepStr)) deps = [...deps, inverseDepStr];
        fm['story-deps'] = deps;
      });
      new Notice(`Linked: ${this.file.basename} & ${this.targetBasename}`);
    } else {
      new Notice(`Added one-way dependency: ${depStr}`);
    }
    
    const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
    if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
  }

  onClose() {
    this.contentEl.empty();
    this.onComplete();
  }
}

// ─── Set Tension Modal ───────────────────────────────────────

export class SetTensionModal extends Modal {
  private file: TFile;
  private onComplete: () => void;
  private value: number = 5;
  private plugin: StoryboardCanvasPlugin;

  constructor(plugin: StoryboardCanvasPlugin, file: TFile, onComplete: () => void = () => {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.onComplete = onComplete;

    const cache = plugin.app.metadataCache.getFileCache(file);
    const existing = cache?.frontmatter?.['tension'];
    if (typeof existing === 'number' && existing >= 1 && existing <= 10) {
      this.value = existing;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: `Set tension: ${this.file.basename}` });

    const tensionDisplay = contentEl.createEl('div', { text: `Level: ${this.value}` });
    tensionDisplay.style.textAlign = 'center';
    tensionDisplay.style.fontSize = '1.2em';
    tensionDisplay.style.fontWeight = 'bold';
    tensionDisplay.style.marginBottom = '12px';

    new Setting(contentEl)
      .setName('Pacing / Dramatic Tension')
      .setDesc('1 (Calm) to 10 (High Action)')
      .addSlider(slider => {
        slider.setLimits(1, 10, 1)
          .setValue(this.value)
          .setDynamicTooltip()
          .onChange(v => {
            this.value = v;
            tensionDisplay.setText(`Level: ${v}`);
          });
      });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Save')
        .setCta()
        .onClick(() => this.save()));
  }

  private async save(): Promise<void> {
    await setFrontmatterKey(this.app, this.file, 'tension', this.value);
    new Notice(`Set tension: ${this.value}`);
    
    const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
    if (activeCanvas) await this.plugin.canvasManager.sortStoryboard(activeCanvas);
    
    this.close();
    this.onComplete();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── Combined Tag Scene Modal ────────────────────────────────

/**
 * Four-step tagging: date, arc, tension, then optional dependencies.
 */
export function tagScene(plugin: StoryboardCanvasPlugin, file: TFile): void {
  new SetDateModal(plugin, file, () => {
    new SetArcModal(plugin, file, () => {
      new SetTensionModal(plugin, file, () => {
        new SetDependenciesModal(plugin, file).open();
      }).open();
    }).open();
  }).open();
}
