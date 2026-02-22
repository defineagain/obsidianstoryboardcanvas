import { App, Notice, Modal, Setting, TFile } from 'obsidian';
import type { Canvas } from './Canvas';
import type { StoryEvent, LayoutConfig, DateFormatSettings, AbstractDate } from './canvasTypes';
import { formatAbstractDate } from './dateFormatter';
import { compareAbstractDates } from './layoutEngine';
import { setFrontmatterKey } from './utils';

interface SyncChange {
  scene: StoryEvent;
  newArc?: string;
  newDate?: AbstractDate;
  description: string;
}

export async function calculateSyncChanges(
  app: App,
  canvas: Canvas,
  scenes: StoryEvent[],
  layoutConfig: LayoutConfig,
  dateSettings: DateFormatSettings
): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];

  // 1. Determine Y-lanes (Arcs) from existing scenes
  // Map arc names to average Y, and Y to arc names
  const arcY = new Map<string, number[]>();
  for (const scene of scenes) {
    const node = canvas.nodes.get(scene.nodeId);
    if (!node) continue;
    if (!arcY.has(scene.arc)) arcY.set(scene.arc, []);
    arcY.get(scene.arc)!.push(node.getData().y);
  }

  const arcCentroids = new Map<string, number>();
  for (const [arc, yVals] of arcY.entries()) {
    const avg = yVals.reduce((a, b) => a + b, 0) / yVals.length;
    arcCentroids.set(arc, avg);
  }

  // 2. Sort all canvas file nodes by X to get visual sequence
  const fileNodesHtml = Array.from(canvas.nodes.entries())
    .map(([id, n]) => ({ id, data: n.getData() }))
    .filter(n => n.data.type === 'file' && n.data.file)
    .sort((a, b) => a.data.x - b.data.x);

  // Map visual index
  const visualSequence = fileNodesHtml.map(n => n.id);

  for (const scene of scenes) {
    const node = canvas.nodes.get(scene.nodeId);
    if (!node) continue;
    const data = node.getData();

    let didChange = false;
    let newArc: string | undefined;
    let newDate: AbstractDate | undefined;
    const reasons: string[] = [];

    // --- Check Arc changes (Y-axis) ---
    // Find closest arc centroid
    let closestArc = scene.arc;
    let minDistance = Infinity;
    for (const [arc, centroid] of arcCentroids.entries()) {
      const dist = Math.abs(data.y - centroid);
      if (dist < minDistance) {
        minDistance = dist;
        closestArc = arc;
      }
    }

    if (closestArc !== scene.arc && minDistance < layoutConfig.arcSpacing / 2) {
      newArc = closestArc;
      reasons.push(`Arc changed from "${scene.arc}" to "${newArc}"`);
      didChange = true;
    }

    // --- Check Date/Sequence changes (X-axis) ---
    const visualNodeIndex = visualSequence.indexOf(scene.nodeId);
    
    // Find previous and next scenes in the visual sequence that HAVEN'T moved significantly
    // To simplify: we just ensure the date is between the previous and next nodes.
    const prevNodeId = visualSequence[visualNodeIndex - 1];
    const nextNodeId = visualSequence[visualNodeIndex + 1];

    const prevScene = scenes.find(s => s.nodeId === prevNodeId);
    const nextScene = scenes.find(s => s.nodeId === nextNodeId);

    // If visually it's before prevScene's date, or after nextScene's date, we need a new date
    let needsNewDate = false;
    if (prevScene && compareAbstractDates(scene.date, prevScene.date) <= 0) {
        needsNewDate = true;
    }
    if (nextScene && compareAbstractDates(scene.date, nextScene.date) >= 0) {
        needsNewDate = true;
    }

    if (needsNewDate) {
      // Calculate a midpoint date. For simplicity, we just take the nearest valid date 
      // based on neighbors. Since dates can be complex (e.g. YYYY-MM-DD), we'll do a simple increment/decrement
      // on the most significant or least significant component that works.
      // Easiest approach for MVP string output: just prompt user. Abstract dates are arrays of numbers.
      
      const newD = [...scene.date];
      const lastIdx = newD.length - 1;

      if (prevScene && nextScene) {
        // Average the last date component
        newD[lastIdx] = Math.floor((prevScene.date[lastIdx] + nextScene.date[lastIdx]) / 2);
        // If they are the same, just use prev and add 1 (will be slightly messy but alerts user)
        if (newD[lastIdx] <= prevScene.date[lastIdx]) newD[lastIdx] = prevScene.date[lastIdx] + 1;
      } else if (prevScene) {
        newD[lastIdx] = prevScene.date[lastIdx] + 1;
      } else if (nextScene) {
        newD[lastIdx] = nextScene.date[lastIdx] - 1;
      }

      newDate = newD;
      reasons.push(`Sequence moved: expected bounds broken. Suggesting new date: ${formatAbstractDate(newDate, dateSettings)}`);
      didChange = true;
    }

    if (didChange) {
      changes.push({
        scene,
        newArc,
        newDate,
        description: reasons.join('; ')
      });
    }
  }

  return changes;
}

export class SyncConfirmationModal extends Modal {
  private changes: SyncChange[];
  private dateSettings: DateFormatSettings;
  private onConfirm: () => void;

  constructor(app: App, changes: SyncChange[], dateSettings: DateFormatSettings, onConfirm: () => void) {
    super(app);
    this.changes = changes;
    this.dateSettings = dateSettings;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: `Sync ${this.changes.length} Changes to Notes` });
    contentEl.createEl('p', { text: 'The following frontmatter updates will be applied based on your canvas dragging:' });

    const list = contentEl.createEl('ul', { cls: 'storyflow-sync-list' });
    
    for (const change of this.changes) {
      const li = list.createEl('li');
      li.createEl('strong', { text: change.scene.title + ': ' });
      li.createEl('span', { text: change.description });
    }

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText('Apply Changes')
        .setCta()
        .onClick(async () => {
          this.close();
          let count = 0;
          for (const change of this.changes) {
             if (change.newArc) {
                await setFrontmatterKey(this.app, change.scene.file, 'story-arc', change.newArc);
             }
             if (change.newDate) {
                // Must convert abstract date back to string format using configured display
                // Note: to strictly adhere to formatting we just dump it out
                const dateStr = formatAbstractDate(change.newDate, this.dateSettings);
                await setFrontmatterKey(this.app, change.scene.file, 'story-date', dateStr);
             }
             count++;
          }
          new Notice(`Successfully synced ${count} notes from canvas.`);
          this.onConfirm();
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
