// ═══════════════════════════════════════
// STORYBOARD CANVAS — Plugin Entry Point
// ═══════════════════════════════════════
// Standalone Obsidian plugin for BRAT distribution.
// Arranges linked documents on Canvas: X=time, Y=arc,
// with cross-link edges from [[wikilinks]].

import { Plugin, TFile } from 'obsidian';
import { StoryboardCanvasManager } from './src/StoryboardCanvasManager';
import { SetDateModal, SetArcModal, tagScene } from './src/taggingModals';
import { DEFAULT_SETTINGS, StoryboardSettingTab, type StoryboardSettings } from './src/settings';

export default class StoryboardCanvasPlugin extends Plugin {
  canvasManager: StoryboardCanvasManager;
  settings: StoryboardSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.canvasManager = new StoryboardCanvasManager(this.app, this.settings.dateSettings, this.settings.layoutConfig);
    this.addSettingTab(new StoryboardSettingTab(this.app, this));

    // ─── Tagging Commands (work on active markdown file) ──

    this.addCommand({
      id: 'storyboard-set-date',
      name: 'Set story date on current note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) new SetDateModal(this, file).open();
        return true;
      },
    });

    this.addCommand({
      id: 'storyboard-set-arc',
      name: 'Set story arc on current note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) new SetArcModal(this, file).open();
        return true;
      },
    });

    this.addCommand({
      id: 'storyboard-tag-scene',
      name: 'Tag scene (set date + arc)',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) tagScene(this, file);
        return true;
      },
    });

    // ─── Canvas Commands (require active canvas view) ─────

    this.addCommand({
      id: 'storyboard-build',
      name: 'Build storyboard (sort + connect + cross-link)',
      checkCallback: (checking: boolean) => {
        const canvas = this.canvasManager.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.canvasManager.buildStoryboard(canvas);
        return true;
      },
    });

    this.addCommand({
      id: 'storyboard-sort',
      name: 'Sort storyboard by date',
      checkCallback: (checking: boolean) => {
        const canvas = this.canvasManager.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.canvasManager.sortStoryboard(canvas);
        return true;
      },
    });

    this.addCommand({
      id: 'storyboard-connect',
      name: 'Connect scenes chronologically',
      checkCallback: (checking: boolean) => {
        const canvas = this.canvasManager.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.canvasManager.connectChronologically(canvas);
        return true;
      },
    });

    this.addCommand({
      id: 'storyboard-crosslink',
      name: 'Add cross-link edges from [[wikilinks]]',
      checkCallback: (checking: boolean) => {
        const canvas = this.canvasManager.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.canvasManager.connectByLinks(canvas);
        return true;
      },
    });

    this.addCommand({
      id: 'storyboard-play',
      name: 'Play storyboard',
      checkCallback: (checking: boolean) => {
        const canvas = this.canvasManager.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.canvasManager.playStoryboard(canvas);
        return true;
      },
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    
    // Update canvas manager config
    if (this.canvasManager) {
      this.canvasManager.dateSettings = this.settings.dateSettings;
      this.canvasManager.layoutConfig = this.settings.layoutConfig;
    }
  }
}
