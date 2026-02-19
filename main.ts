// ═══════════════════════════════════════
// STORYBOARD CANVAS — Plugin Entry Point
// ═══════════════════════════════════════
// Standalone Obsidian plugin for BRAT distribution.
// Arranges linked documents on Canvas: X=time, Y=arc,
// with cross-link edges from [[wikilinks]].

import { Plugin } from 'obsidian';
import { StoryboardCanvasManager } from './src/StoryboardCanvasManager';

export default class StoryboardCanvasPlugin extends Plugin {
  canvasManager: StoryboardCanvasManager;

  async onload(): Promise<void> {
    this.canvasManager = new StoryboardCanvasManager(this.app);

    // ─── Commands ──────────────────────────────────────────

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
}
