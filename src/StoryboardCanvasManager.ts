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
import { formatAbstractDate, calculateDateInterval } from './dateFormatter';
import { calculateLayout, compareAbstractDates } from './layoutEngine';

// ─── Helpers ─────────────────────────────────────────────────

function randomId(length: number = 16): string {
  return Math.random().toString(36).substring(2, 2 + length / 2)
    + Math.random().toString(36).substring(2, 2 + length / 2);
}

// ─── Manager ─────────────────────────────────────────────────

export class StoryboardCanvasManager {
  private app: App;
  public dateSettings: DateFormatSettings;
  public layoutConfig: LayoutConfig;

  constructor(
    app: App,
    dateSettings: DateFormatSettings = DEFAULT_DATE_FORMAT_SETTINGS,
    layoutConfig: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  ) {
    this.app = app;
    this.layoutConfig = layoutConfig;
    this.dateSettings = dateSettings;
  }

  // ─── Canvas Access ───────────────────────────────────────

  getActiveCanvas(): Canvas | null {
    // Find all canvas leaves
    const leaves = this.app.workspace.getLeavesOfType('canvas');
    if (leaves.length === 0) return null;

    // Default to the first open canvas we can find
    // (If the user has multiple canvases open, they might need to click the canvas first to make it recent, 
    // but typically there is only one canvas active at a time)
    const view = leaves[0].view as any;
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
      if (!metadata) {
        console.warn(`[Storyboard] No metadata cache for: ${file.path}`);
        continue;
      }

      // Debug: log what we see in frontmatter
      const rawDate = metadata.frontmatter?.['story-date'];
      if (rawDate === undefined || rawDate === null) {
        console.log(`[Storyboard] Skipping ${file.basename}: no story-date in frontmatter`);
        continue;
      }

      console.log(`[Storyboard] ${file.basename}: story-date raw =`, rawDate, `(type: ${typeof rawDate}, isDate: ${rawDate instanceof Date})`);

      const date = getAbstractDateFromMetadata(
        metadata, 'story-date', this.dateSettings,
      );
      if (!date) {
        console.warn(`[Storyboard] FAILED to parse story-date for: ${file.basename}, raw value:`, rawDate);
        continue;
      }

      const endDate = getAbstractDateFromMetadata(
        metadata, 'story-end-date', this.dateSettings,
      );
      const arc = getArcFromMetadata(metadata);
      const title = getTitleFromMetadata(metadata) || file.basename;

      // Extract dependencies
      const rawDeps = metadata.frontmatter?.['story-deps'] as string[] | undefined;
      const deps: { basename: string, type: 'before' | 'after' }[] = [];
      if (Array.isArray(rawDeps)) {
        for (const dep of rawDeps) {
          if (typeof dep === 'string') {
            const parts = dep.split(':');
            if (parts.length === 2 && (parts[1] === 'before' || parts[1] === 'after')) {
              deps.push({ basename: parts[0], type: parts[1] as 'before' | 'after' });
            }
          }
        }
      }

      console.log(`[Storyboard] ✓ ${file.basename}: date=[${date}], arc="${arc}"`);
      events.push({ nodeId: id, file, date, endDate, arc, title, deps });
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

        const label = calculateDateInterval(from.date, to.date);
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
   * add cross-link edges from [[wikilinks]], and add visual markers.
   */
  async buildStoryboard(canvas: Canvas): Promise<void> {
    // Diagnostics
    const totalNodes = canvas.nodes.size;
    const scenes = await this.extractScenes(canvas);
    const skipped = totalNodes - scenes.length;

    if (scenes.length === 0) {
      new Notice(
        `No scenes found. ${totalNodes} nodes on canvas but none have story-date frontmatter. ` +
        `Use "Tag scene" command on each note first.`
      );
      return;
    }

    if (skipped > 0) {
      new Notice(`Found ${scenes.length} tagged scenes (${skipped} nodes skipped — no story-date).`);
    }

    // Clean old markers before rebuilding
    this.removeMarkerNodes(canvas);

    await this.sortStoryboard(canvas);
    await this.connectChronologically(canvas);
    await this.connectByLinks(canvas);
    this.addVisualMarkers(canvas, scenes);

    new Notice(`Storyboard built: ${scenes.length} scenes, sorted + connected + labelled.`);
  }

  // ─── Visual Markers ──────────────────────────────────────

  private readonly MARKER_PREFIX = 'storyboard-marker-';

  /**
   * Remove previously generated marker text nodes.
   */
  private removeMarkerNodes(canvas: Canvas): void {
    const canvasData = canvas.getData();
    canvasData.nodes = canvasData.nodes.filter(
      (n: any) => !n.id?.startsWith(this.MARKER_PREFIX),
    );
    canvas.setData(canvasData);
    canvas.requestSave();
  }

  /**
   * Add arc lane labels on the left and date markers along the top.
   */
  private addVisualMarkers(canvas: Canvas, scenes: StoryEvent[]): void {
    const canvasData = canvas.getData();

    // Discover arc lanes and their Y positions from current node positions
    const arcYPositions = new Map<string, number>();
    const dateXPositions = new Map<string, number>(); // date label → X

    for (const scene of scenes) {
      const node = canvas.nodes.get(scene.nodeId);
      if (!node) continue;
      const data = node.getData();

      // Track arc Y (use first occurrence)
      if (!arcYPositions.has(scene.arc)) {
        arcYPositions.set(scene.arc, data.y);
      }

      // Track unique dates and their X positions
      const dateLabel = formatAbstractDate(scene.date, this.dateSettings);
      if (!dateXPositions.has(dateLabel)) {
        dateXPositions.set(dateLabel, data.x);
      }
    }

    const labelWidth = 200;
    const labelHeight = 60;
    const headerY = Math.min(...arcYPositions.values()) - labelHeight - 80;

    // Add arc lane labels (left side)
    const minX = Math.min(...dateXPositions.values());
    const labelX = minX - labelWidth - 60;
    let arcIndex = 0;
    for (const [arcName, y] of arcYPositions) {
      const colors = ['1', '2', '3', '4', '5', '6']; // Obsidian canvas colors
      canvasData.nodes.push({
        id: `${this.MARKER_PREFIX}arc-${arcIndex}`,
        type: 'text',
        text: `## ${arcName}`,
        x: labelX,
        y: y + (this.layoutConfig.nodeHeight / 2) - (labelHeight / 2),
        width: labelWidth,
        height: labelHeight,
        color: colors[arcIndex % colors.length],
      } as any);
      arcIndex++;
    }

    // Add date markers (top row)
    let dateIndex = 0;
    for (const [dateLabel, x] of dateXPositions) {
      canvasData.nodes.push({
        id: `${this.MARKER_PREFIX}date-${dateIndex}`,
        type: 'text',
        text: `**${dateLabel}**`,
        x: x + (this.layoutConfig.nodeWidth / 2) - (labelWidth / 2),
        y: headerY,
        width: labelWidth,
        height: labelHeight,
        color: '0',
      } as any);
      dateIndex++;
    }

    // Add per-node date labels (directly above each file node)
    const nodeLabelHeight = 40;
    for (const scene of scenes) {
      const node = canvas.nodes.get(scene.nodeId);
      if (!node) continue;
      const data = node.getData();
      const dateLabel = formatAbstractDate(scene.date, this.dateSettings);

      canvasData.nodes.push({
        id: `${this.MARKER_PREFIX}nodelabel-${scene.nodeId}`,
        type: 'text',
        text: dateLabel,
        x: data.x,
        y: data.y - nodeLabelHeight - 10,
        width: this.layoutConfig.nodeWidth,
        height: nodeLabelHeight,
        color: '0',
      } as any);
    }

    canvas.setData(canvasData);
    canvas.requestSave();
  }

  // ─── Sync ────────────────────────────────────────────────
  
  async syncStoryboard(canvas: Canvas): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length === 0) {
      new Notice('No scenes with story-date found.');
      return;
    }
    
    const { calculateSyncChanges, SyncConfirmationModal } = await import('./syncEngine');
    const changes = await calculateSyncChanges(this.app, canvas, scenes, this.layoutConfig, this.dateSettings);
    
    if (changes.length === 0) {
      new Notice('No drag-and-drop changes detected.');
      return;
    }
    
    new SyncConfirmationModal(this.app, changes, this.dateSettings, () => {
      // Rebuild the sorted storyboard after applying changes
      this.buildStoryboard(canvas);
    }).open();
  }

  // ─── Playback ────────────────────────────────────────────

  async playStoryboard(
    canvas: Canvas,
    delayMs?: number,
  ): Promise<void> {
    const delay = delayMs ?? this.layoutConfig.playbackSpeed ?? 1500;
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
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    new Notice('Playback complete.');
  }
}
