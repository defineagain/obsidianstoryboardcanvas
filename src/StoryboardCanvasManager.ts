// ═══════════════════════════════════════
// STORYBOARD CANVAS MANAGER
// ═══════════════════════════════════════
// Standalone bridge: reads [[wikilinks]] from notes on canvas,
// arranges linked documents on X=time, Y=arc, and draws
// chronological + cross-link edges.

import { App, Notice, TFile } from 'obsidian';
import type { Canvas, CanvasNode, CanvasEdgeData, CanvasNodeData } from './Canvas';
import type { StoryEvent, LayoutConfig, DateFormatSettings } from './canvasTypes';
import { DEFAULT_LAYOUT_CONFIG, DEFAULT_DATE_FORMAT_SETTINGS } from './canvasTypes';
import { getAbstractDateFromMetadata, getArcFromMetadata, getTitleFromMetadata } from './dateParser';
import { formatAbstractDate } from './dateFormatter';
import { calculateLayout, compareAbstractDates } from './layoutEngine';

// ─── Helpers ─────────────────────────────────────────────────

function randomId(length: number = 16): string {
  return Math.random().toString(36).substring(2, 2 + length / 2)
    + Math.random().toString(36).substring(2, 2 + length / 2);
}

// ─── Manager ─────────────────────────────────────────────────

export class StoryboardCanvasManager {
  private app: App;
  private layoutConfig: LayoutConfig;
  private dateSettings: DateFormatSettings;

  constructor(
    app: App,
    layoutConfig: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
    dateSettings: DateFormatSettings = DEFAULT_DATE_FORMAT_SETTINGS,
  ) {
    this.app = app;
    this.layoutConfig = layoutConfig;
    this.dateSettings = dateSettings;
  }

  // ─── Canvas Access ───────────────────────────────────────

  getActiveCanvas(): Canvas | null {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return null;
    const view = leaf.view as any;
    if (view?.getViewType?.() !== 'canvas') return null;
    return view.canvas as Canvas ?? null;
  }

  // ─── Scene Extraction ────────────────────────────────────

  /**
   * Extract StoryEvents from all file nodes on the canvas
   * that have `story-date` frontmatter.
   */
  async extractScenes(canvas: Canvas): Promise<StoryEvent[]> {
    const events: StoryEvent[] = [];

    for (const [id, node] of canvas.nodes) {
      const data = node.getData();
      if (data.type !== 'file' || !data.file) continue;

      const file = this.app.vault.getAbstractFileByPath(data.file);
      if (!(file instanceof TFile)) continue;

      const metadata = this.app.metadataCache.getFileCache(file);
      if (!metadata) continue;

      const date = getAbstractDateFromMetadata(
        metadata, 'story-date', this.dateSettings,
      );
      if (!date) continue;

      const endDate = getAbstractDateFromMetadata(
        metadata, 'story-end-date', this.dateSettings,
      );
      const arc = getArcFromMetadata(metadata);
      const title = getTitleFromMetadata(metadata) || file.basename;

      events.push({ nodeId: id, file, date, endDate, arc, title });
    }

    return events;
  }

  // ─── Sort / Layout ───────────────────────────────────────

  /**
   * Sort: read dates, compute layout, move nodes.
   */
  async sortStoryboard(canvas: Canvas): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length === 0) {
      new Notice('No scenes with story-date found on this canvas.');
      return;
    }

    const positions = calculateLayout(scenes, this.layoutConfig);

    for (const [nodeId, pos] of positions) {
      const node = canvas.nodes.get(nodeId);
      if (!node) continue;
      const data = node.getData();
      node.setData({
        ...data,
        x: pos.x,
        y: pos.y,
        width: this.layoutConfig.nodeWidth,
        height: this.layoutConfig.nodeHeight,
      });
    }

    canvas.requestSave();
    new Notice(`Sorted ${scenes.length} scenes by date.`);
  }

  // ─── Chronological Connections ───────────────────────────

  /**
   * Create edges between scenes in chronological order per arc.
   */
  async connectChronologically(canvas: Canvas): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length < 2) {
      new Notice('Need at least 2 scenes with story-date to connect.');
      return;
    }

    const arcGroups = new Map<string, StoryEvent[]>();
    for (const scene of scenes) {
      const group = arcGroups.get(scene.arc) ?? [];
      group.push(scene);
      arcGroups.set(scene.arc, group);
    }

    let edgeCount = 0;
    const canvasData = canvas.getData();

    for (const [, group] of arcGroups) {
      group.sort((a, b) => compareAbstractDates(a.date, b.date));
      for (let i = 0; i < group.length - 1; i++) {
        const from = group[i];
        const to = group[i + 1];
        const exists = canvasData.edges.some(
          (e) => e.fromNode === from.nodeId && e.toNode === to.nodeId,
        );
        if (exists) continue;

        const label = formatAbstractDate(to.date, this.dateSettings);
        canvasData.edges.push({
          id: randomId(),
          fromNode: from.nodeId,
          toNode: to.nodeId,
          fromSide: 'right',
          toSide: 'left',
          toEnd: 'arrow',
          label,
        });
        edgeCount++;
      }
    }

    if (edgeCount > 0) {
      canvas.setData(canvasData);
      canvas.requestSave();
    }
    new Notice(`Connected ${edgeCount} scene pairs across ${arcGroups.size} arc(s).`);
  }

  // ─── Cross-Link Edges (from [[wikilinks]]) ───────────────

  /**
   * Scan resolved links between file nodes on the canvas and create
   * cross-link edges for any [[wikilinks]] found in note content.
   * This follows the enhanced-canvas "Add edges according to links" pattern.
   */
  async connectByLinks(canvas: Canvas): Promise<void> {
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const canvasData = canvas.getData();

    // Build path→nodeId map for file nodes on canvas
    const pathToNodeId = new Map<string, string>();
    for (const [id, node] of canvas.nodes) {
      const data = node.getData();
      if (data.type === 'file' && data.file) {
        pathToNodeId.set(data.file, id);
      }
    }

    // Build existing edge set
    const existingEdges = new Set<string>();
    for (const edge of canvasData.edges) {
      existingEdges.add(`${edge.fromNode}->${edge.toNode}`);
    }

    let edgeCount = 0;

    for (const [sourcePath, sourceNodeId] of pathToNodeId) {
      const links = resolvedLinks[sourcePath];
      if (!links) continue;

      for (const targetPath in links) {
        const targetNodeId = pathToNodeId.get(targetPath);
        if (!targetNodeId || targetNodeId === sourceNodeId) continue;

        const edgeKey = `${sourceNodeId}->${targetNodeId}`;
        if (existingEdges.has(edgeKey)) continue;

        canvasData.edges.push({
          id: randomId(),
          fromNode: sourceNodeId,
          toNode: targetNodeId,
          fromSide: 'bottom',
          toSide: 'top',
          toEnd: 'arrow',
          styleAttributes: { 'edge-style': 'dotted' },
        });
        existingEdges.add(edgeKey);
        edgeCount++;
      }
    }

    if (edgeCount > 0) {
      canvas.setData(canvasData);
      canvas.requestSave();
    }
    new Notice(`Created ${edgeCount} cross-link edges from [[wikilinks]].`);
  }

  // ─── Full Storyboard (sort + connect all) ────────────────

  /**
   * One-shot: arrange by date/arc, connect chronologically, then
   * add cross-link edges from [[wikilinks]].
   */
  async buildStoryboard(canvas: Canvas): Promise<void> {
    await this.sortStoryboard(canvas);
    await this.connectChronologically(canvas);
    await this.connectByLinks(canvas);
    new Notice('Storyboard built: sorted, connected, cross-linked.');
  }

  // ─── Playback ────────────────────────────────────────────

  async playStoryboard(
    canvas: Canvas,
    delayMs: number = 1500,
  ): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length === 0) {
      new Notice('No scenes with story-date found.');
      return;
    }

    scenes.sort((a, b) => compareAbstractDates(a.date, b.date));
    new Notice(`Playing ${scenes.length} scenes...`);

    for (const scene of scenes) {
      const node = canvas.nodes.get(scene.nodeId);
      if (!node) continue;
      const data = node.getData();
      canvas.zoomToBbox({
        minX: data.x - 50,
        minY: data.y - 50,
        maxX: data.x + data.width + 50,
        maxY: data.y + data.height + 50,
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    new Notice('Playback complete.');
  }
}
