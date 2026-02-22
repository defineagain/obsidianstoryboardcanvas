// ═══════════════════════════════════════
// STORYBOARD CANVAS — Plugin Entry Point
// ═══════════════════════════════════════
// Standalone Obsidian plugin for BRAT distribution.
// Arranges linked documents on Canvas: X=time, Y=arc,
// with cross-link edges from [[wikilinks]].

import { Plugin, TFile, WorkspaceLeaf, Editor, MarkdownView } from 'obsidian';
import { StoryboardCanvasManager } from './src/StoryboardCanvasManager';
import { SetDateModal, SetArcModal, tagScene } from './src/taggingModals';
import { DEFAULT_SETTINGS, StoryboardSettingTab, type StoryboardSettings } from './src/settings';
import { StoryboardInspectorView, INSPECTOR_VIEW_TYPE } from './src/ui/StoryboardInspectorView';
import { registerCanvasHooks } from './src/canvasHooks';

export default class StoryboardCanvasPlugin extends Plugin {
  canvasManager: StoryboardCanvasManager;
  settings: StoryboardSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.canvasManager = new StoryboardCanvasManager(this.app, this.settings.dateSettings, this.settings.layoutConfig);
    this.addSettingTab(new StoryboardSettingTab(this.app, this));

    // ─── UI Enhancements ──
    this.registerView(
      INSPECTOR_VIEW_TYPE,
      (leaf) => new StoryboardInspectorView(leaf, this)
    );

    this.addRibbonIcon('list', 'Open Storyboard Inspector', () => {
      this.activateInspectorView();
    });

    // Native Obsidian Canvas Prototype Hooks (monkey-around)
    registerCanvasHooks(this);

    // ─── Tagging Commands (work on active markdown file) ──

    this.addCommand({
      id: 'storyboard-set-date',
      name: 'Set story date on current note',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          new SetDateModal(this, view.file).open();
        }
      },
    });

    this.addCommand({
      id: 'storyboard-set-arc',
      name: 'Set story arc on current note',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          new SetArcModal(this, view.file).open();
        }
      },
    });

    this.addCommand({
      id: 'storyboard-tag-scene',
      name: 'Tag scene (set date + arc)',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          tagScene(this, view.file);
        }
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

    this.addCommand({
      id: 'storyboard-sync',
      name: 'Sync canvas to notes',
      checkCallback: (checking: boolean) => {
        const canvas = this.canvasManager.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.canvasManager.syncStoryboard(canvas);
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

  async activateInspectorView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE);

    if (leaves.length > 0) {
      // A leaf with our view already exists, use that
      leaf = leaves[0];
    } else {
      // Create a new leaf in the right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: INSPECTOR_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  onunload() {
    // Note: Monkey-around hooks are automatically cleaned up 
    // because they are registered via this.register()
  }
}
