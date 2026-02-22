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

      // Extract tension heatmap
      const tensionRaw = metadata.frontmatter?.['tension'];
      let tension: number | undefined = undefined;
      if (typeof tensionRaw === 'number' && tensionRaw >= 1 && tensionRaw <= 10) {
        tension = tensionRaw;
      }

      console.log(`[Storyboard] ✓ ${file.basename}: date=[${date}], arc="${arc}", tension=${tension}`);
      events.push({ nodeId: id, file, date, endDate, arc, title, tension, deps });
    }

    return events;
  }

  // ─── Sort / Layout ───────────────────────────────────────

  /**
   * Sort: compute layout and mutate canvas nodes in memory.
   */
  async sortStoryboard(canvas: Canvas): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length === 0) {
      new Notice('No scenes with story-date found on this canvas.');
      return;
    }

    const canvasData = canvas.getData();
    this.applySortToData(canvasData, scenes);
    
    canvas.setData(canvasData);
    canvas.requestSave();
    
    // Defer pushing CSS DOM classes slightly to allow the React layer to reconstruct nodes
    this.applyTensionClasses(canvas, scenes);
    new Notice(`Sorted ${scenes.length} scenes by date.`);
  }

  private applySortToData(canvasData: any, scenes: StoryEvent[]): void {
    const positions = calculateLayout(scenes, this.layoutConfig);
    for (const [nodeId, pos] of positions) {
      const node = canvasData.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
        node.width = this.layoutConfig.nodeWidth;
        node.height = this.layoutConfig.nodeHeight;
      }
    }
  }

  private applyTensionClasses(canvas: Canvas, scenes: StoryEvent[]): void {
    setTimeout(() => {
      for (const scene of scenes) {
        const node = canvas.nodes.get(scene.nodeId);
        if (node?.nodeEl) {
          for (let t = 1; t <= 10; t++) node.nodeEl.classList.remove(`storyboard-tension-${t}`);
          if (scene.tension) Object.keys(node.nodeEl.classList).length; // flush
          if (scene.tension) node.nodeEl.classList.add(`storyboard-tension-${Math.floor(scene.tension)}`);
        }
      }
    }, 150);
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

    const canvasData = canvas.getData();
    const count = this.applyChronologicalEdgesToData(canvasData, scenes);

    if (count > 0) {
      canvas.setData(canvasData);
      canvas.requestSave();
    }
    new Notice(`Connected ${count} chronological scene pairs.`);
  }

  private applyChronologicalEdgesToData(canvasData: any, scenes: StoryEvent[]): number {
    const arcGroups = new Map<string, StoryEvent[]>();
    for (const scene of scenes) {
      const group = arcGroups.get(scene.arc) ?? [];
      group.push(scene);
      arcGroups.set(scene.arc, group);
    }

    let edgeCount = 0;
    
    // Purge any old generated chrono edges to prevent overlaps when switching layouts
    canvasData.edges = canvasData.edges.filter((e: any) => !e.id?.startsWith(`${this.MARKER_PREFIX}edge-chrono`));

    for (const [, group] of arcGroups) {
      group.sort((a, b) => compareAbstractDates(a.date, b.date));
      for (let i = 0; i < group.length - 1; i++) {
        const from = group[i];
        const to = group[i + 1];
        
        // Skip if user manually created an edge identical to this
        const existsUser = canvasData.edges.some(
          (e: any) => e.fromNode === from.nodeId && e.toNode === to.nodeId && !e.id?.startsWith(this.MARKER_PREFIX)
        );
        if (existsUser) continue;

        const label = calculateDateInterval(from.date, to.date);
        canvasData.edges.push({
          id: `${this.MARKER_PREFIX}edge-chrono-${randomId()}`,
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
    return edgeCount;
  }

  // ─── Cross-Link Edges (from [[wikilinks]]) ───────────────

  /**
   * Scan resolved links between file nodes on the canvas and create
   * cross-link edges for any [[wikilinks]] found in note content.
   * This follows the enhanced-canvas "Add edges according to links" pattern.
   */
  async connectByLinks(canvas: Canvas): Promise<void> {
    const canvasData = canvas.getData();
    const count = this.applyCrossLinksToData(canvasData, this.app.metadataCache.resolvedLinks);

    if (count > 0) {
      canvas.setData(canvasData);
      canvas.requestSave();
    }
    new Notice(`Created ${count} cross-link edges from [[wikilinks]].`);
  }

  private applyCrossLinksToData(canvasData: any, resolvedLinks: Record<string, Record<string, number>>): number {
    const pathToNodeId = new Map<string, string>();
    for (const node of canvasData.nodes) {
      if (node.type === 'file' && node.file) {
        pathToNodeId.set(node.file, node.id);
      }
    }
    
    // Purge any old generated link edges
    canvasData.edges = canvasData.edges.filter((e: any) => !e.id?.startsWith(`${this.MARKER_PREFIX}edge-link`));

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
          id: `${this.MARKER_PREFIX}edge-link-${randomId()}`,
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
    return edgeCount;
  }

  // ─── Full Storyboard (sort + connect all) ────────────────

  /**
   * One-shot: arrange by date/arc, connect chronologically, then
   * add cross-link edges from [[wikilinks]], and add visual markers.
   */
  async buildStoryboard(canvas: Canvas): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length === 0) {
      new Notice('No scenes with story-date found on this canvas. Use "Tag scene" command on each note first.');
      return;
    }

    // 1. Physically destroy all marker nodes directly on the canvas instance
    for (const [id, node] of canvas.nodes.entries()) {
      if (node.getData().type !== 'file') {
        canvas.removeNode(node);
      }
    }

    // 2. Physically destroy all edges directly on the canvas instance
    for (const [id, edge] of canvas.edges.entries()) {
      canvas.removeEdge(edge);
    }
    
    const canvasData = canvas.getData();

    // 3. Mutate payload simultaneously to bypass async React Node DOM recreation
    this.applySortToData(canvasData, scenes);
    this.applyChronologicalEdgesToData(canvasData, scenes);
    this.applyCrossLinksToData(canvasData, this.app.metadataCache.resolvedLinks);
    this.addVisualMarkersToData(canvasData, scenes);

    // 4. Exclusively commit state exactly once
    canvas.setData(canvasData);
    canvas.requestSave();

    this.applyTensionClasses(canvas, scenes);

    new Notice(`Storyboard built: ${scenes.length} scenes, sorted + connected + labelled.`);
  }

  // ─── Visual Markers (UI labels) ─────────────────────────

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
  private addVisualMarkersToData(canvasData: any, scenes: StoryEvent[]): void {
    // Discover arc lanes and their Y positions from current node positions
    const arcYPositions = new Map<string, number>();
    const dateXPositions = new Map<string, number>();

    for (const scene of scenes) {
      const node = canvasData.nodes.find((n: any) => n.id === scene.nodeId);
      if (!node) continue;

      if (!arcYPositions.has(scene.arc)) arcYPositions.set(scene.arc, node.y);

      const dateLabel = formatAbstractDate(scene.date, this.dateSettings);
      if (!dateXPositions.has(dateLabel)) dateXPositions.set(dateLabel, node.x);
    }

    const labelWidth = 200;
    const labelHeight = 60;
    
    // Safety fallback for empty layouts
    const arcVals = Array.from(arcYPositions.values());
    const headerY = arcVals.length > 0 ? Math.min(...arcVals) - labelHeight - 80 : 0;

    const xVals = Array.from(dateXPositions.values());
    const minX = xVals.length > 0 ? Math.min(...xVals) : 0;
    const labelX = minX - labelWidth - 60;

    // Add arc lane labels
    let arcIndex = 0;
    for (const [arcName, y] of arcYPositions) {
      const colors = ['1', '2', '3', '4', '5', '6'];
      canvasData.nodes.push({
        id: `${this.MARKER_PREFIX}arc-${arcIndex}`,
        type: 'text',
        text: `## ${arcName}`,
        x: labelX,
        y: y + (this.layoutConfig.nodeHeight / 2) - (labelHeight / 2),
        width: labelWidth,
        height: labelHeight,
        color: colors[arcIndex % colors.length],
      });
      arcIndex++;
    }

    // Add date markers
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
      });
      dateIndex++;
    }

    // Add per-node date labels
    const nodeLabelHeight = 40;
    for (const scene of scenes) {
      const node = canvasData.nodes.find((n: any) => n.id === scene.nodeId);
      if (!node) continue;
      
      const dateLabel = formatAbstractDate(scene.date, this.dateSettings);
      canvasData.nodes.push({
        id: `${this.MARKER_PREFIX}nodelabel-${scene.nodeId}`,
        type: 'text',
        text: dateLabel,
        x: node.x,
        y: node.y - nodeLabelHeight - 10,
        width: this.layoutConfig.nodeWidth,
        height: nodeLabelHeight,
        color: '0',
      });
    }
  }

  // ─── Sync ────────────────────────────────────────────────
  
  async syncStoryboard(canvas: Canvas): Promise<void> {
    const scenes = await this.extractScenes(canvas);
    if (scenes.length === 0) {
      new Notice('No scenes with story-date found.');
      return;
    }
    
    const { calculateSyncChanges } = await import('./syncEngine');
    const { setFrontmatterKey } = await import('./taggingModals');
    const { formatAbstractDate } = await import('./dateFormatter');
    
    const changes = await calculateSyncChanges(this.app, canvas, scenes, this.layoutConfig, this.dateSettings);
    
    if (changes.length === 0) {
      new Notice('No drag-and-drop changes detected. Refreshing canvas layout from notes.');
      this.buildStoryboard(canvas);
      return;
    }
    
    let count = 0;
    for (const change of changes) {
       if (change.newArc) {
          await setFrontmatterKey(this.app, change.scene.file, 'story-arc', change.newArc);
       }
       if (change.newDate) {
          const dateStr = formatAbstractDate(change.newDate, this.dateSettings);
          await setFrontmatterKey(this.app, change.scene.file, 'story-date', dateStr);
       }
       count++;
    }
    
    new Notice(`Successfully auto-synced ${count} nodes to their frontmatter.`);
    this.buildStoryboard(canvas);
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
