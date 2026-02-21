import { ItemView, WorkspaceLeaf, Notice, Setting } from 'obsidian';
import type StoryboardCanvasPlugin from '../../main';
import { CanvasNode } from '../Canvas';
import { getAbstractDateFromMetadata } from '../dateParser';
import { formatAbstractDate } from '../dateFormatter';
import { setFrontmatterKey, collectFrontmatterValues, SetDependenciesModal } from '../taggingModals';

export const INSPECTOR_VIEW_TYPE = 'storyboard-inspector-view';

export class StoryboardInspectorView extends ItemView {
  plugin: StoryboardCanvasPlugin;
  pollInterval: number | null = null;
  activeNodeId: string | null = null;
  showConstraintWindow: boolean = false;

  container: HTMLDivElement;
  contentDiv: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf, plugin: StoryboardCanvasPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return INSPECTOR_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Storyboard Inspector';
  }

  getIcon() {
    return 'list';
  }

  async onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('storyboard-inspector-view');

    containerEl.createEl('h3', { text: 'Storyboard Inspector' });
    this.container = containerEl.createDiv({ cls: 'inspector-content' });

    this.renderEmptyState();

    // Poll selection every 300ms since Canvas API doesn't expose native selection events
    this.pollInterval = window.setInterval(() => this.pollSelection(), 300);
  }

  async onClose() {
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.container.empty();
  }

  renderEmptyState() {
    this.container.empty();
    this.container.createEl('p', { 
      text: 'Select a single file node on the canvas to inspect it.', 
      cls: 'empty-state' 
    });
    this.activeNodeId = null;
    this.showConstraintWindow = false;
    this.clearConstraintOverlays();
  }

  pollSelection() {
    // DO NOT re-render if the user is actively typing in one of our input fields!
    if (this.container?.contains(document.activeElement)) {
      return; 
    }

    const canvas = this.plugin.canvasManager.getActiveCanvas();
    if (!canvas) {
      if (this.activeNodeId !== null) this.renderEmptyState();
      return;
    }

    const selection = Array.from(canvas.selection);
    if (selection.length !== 1) {
      if (this.activeNodeId !== null) this.renderEmptyState();
      return;
    }

    const targetNode = selection[0] as CanvasNode;
    if (targetNode.getData().type !== 'file' || !targetNode.file) {
      if (this.activeNodeId !== null) this.renderEmptyState();
      return;
    }

    // Refresh if selection changed
    const nodeId = targetNode.getData().id;
    if (this.activeNodeId !== nodeId) {
      this.activeNodeId = nodeId;
      this.renderInspector(targetNode);
    }
  }

  async renderInspector(node: CanvasNode) {
    this.container.empty();
    this.clearConstraintOverlays();
    if (!node.file) return;

    this.container.createEl('h4', { text: node.file.basename });

    const cache = this.app.metadataCache.getFileCache(node.file);
    const fm: Record<string, any> = cache?.frontmatter || {};

    const currentArc = fm['story-arc']?.toString() || '';
    let currentDateRaw = fm['story-date']?.toString() || '';
    
    // Parse to nicely formatted string if possible
    const abstractDate = getAbstractDateFromMetadata(cache!, 'story-date', this.plugin.settings.dateSettings);
    if (abstractDate) {
      currentDateRaw = formatAbstractDate(abstractDate, this.plugin.settings.dateSettings);
    }

    const rawDeps = fm['story-deps'] as string[] | undefined;
    const currentDeps: { basename: string, type: 'before' | 'after' }[] = [];
    if (Array.isArray(rawDeps)) {
      for (const dep of rawDeps) {
        if (typeof dep === 'string') {
          const parts = dep.split(':');
          if (parts.length === 2 && (parts[1] === 'before' || parts[1] === 'after')) {
            currentDeps.push({ basename: parts[0], type: parts[1] as 'before' | 'after' });
          }
        }
      }
    }

    // ─── Phase 5: Calculate Bounding Dates ───
    let boundsStr = 'Format must match plugin settings regex.';
    const canvas = this.plugin.canvasManager.getActiveCanvas();
    try {
      if (currentArc && currentDateRaw && canvas) {
        const scenes = await this.plugin.canvasManager.extractScenes(canvas);
        const arcScenes = scenes
          .filter(s => s.arc === currentArc)
          .sort((a, b) => {
             // AbstractDate is number[] (e.g. [year, month, day])
             const len = Math.max(a.date.length, b.date.length);
             for (let i = 0; i < len; i++) {
                 const aVal = a.date[i] || 0;
                 const bVal = b.date[i] || 0;
                 if (aVal !== bVal) return aVal - bVal;
             }
             return 0;
          });
          
        const myIndex = arcScenes.findIndex(s => s.nodeId === node.getData().id);
        if (myIndex !== -1) {
          const prev = myIndex > 0 ? arcScenes[myIndex - 1] : null;
          const next = myIndex < arcScenes.length - 1 ? arcScenes[myIndex + 1] : null;
          
          const prevStr = prev ? `${prev.title} (${formatAbstractDate(prev.date, this.plugin.settings.dateSettings)})` : 'None';
          const nextStr = next ? `${next.title} (${formatAbstractDate(next.date, this.plugin.settings.dateSettings)})` : 'None';
          
          boundsStr = `Preceding: ${prevStr}\nProceeding: ${nextStr}`;
        }
      }
    } catch(e) { /* ignore extraction errors safely */ }

    // ─── Phase 6: Calculate Constraint Window ───
    let constraintEarliestX = -Infinity;
    let constraintLatestX = Infinity;
    let constraintStr = 'No constraints via dependencies.';

    if (currentDeps.length > 0 && canvas) {
        try {
            const scenes = await this.plugin.canvasManager.extractScenes(canvas);
            
            let maxBeforeDate: number[] | null = null;
            let minAfterDate: number[] | null = null;
            let maxBeforeScene: any = null;
            let minAfterScene: any = null;

            for (const dep of currentDeps) {
                const targetScene = scenes.find(s => s.file.basename === dep.basename);
                if (!targetScene) continue;

                if (dep.type === 'before') {
                    // This node must be BEFORE the target
                    // So the target is the LATEST possible boundary
                    if (!minAfterDate || this.compareAbstractDates(targetScene.date, minAfterDate) < 0) {
                        minAfterDate = targetScene.date;
                        minAfterScene = targetScene;
                    }
                } else if (dep.type === 'after') {
                    // This node must be AFTER the target
                    // So the target is the EARLIEST possible boundary
                    if (!maxBeforeDate || this.compareAbstractDates(targetScene.date, maxBeforeDate) > 0) {
                        maxBeforeDate = targetScene.date;
                        maxBeforeScene = targetScene;
                    }
                }
            }

            const eStr = maxBeforeScene ? formatAbstractDate(maxBeforeDate!, this.plugin.settings.dateSettings) : '-∞';
            const lStr = minAfterScene ? formatAbstractDate(minAfterDate!, this.plugin.settings.dateSettings) : '+∞';
            
            if (maxBeforeScene || minAfterScene) {
                constraintStr = `Calculated window:\n${eStr}  ➔  ${lStr}`;
            }

            // Calculate pixel coords for the canvas overlays
            if (maxBeforeScene) {
                const targetCanvasNode = Array.from(canvas.nodes.values()).find(n => n.getData().id === maxBeforeScene!.nodeId);
                if (targetCanvasNode) constraintEarliestX = targetCanvasNode.x;
            }
            if (minAfterScene) {
                const targetCanvasNode = Array.from(canvas.nodes.values()).find(n => n.getData().id === minAfterScene!.nodeId);
                if (targetCanvasNode) constraintLatestX = targetCanvasNode.x;
            }

        } catch(e) { /* fallback */ }
    }

    // --- Arc Editor ---
    const arcSetting = new Setting(this.container)
      .setName('Story Arc')
      .setDesc('Which lane or plotline this scene belongs to.');

    const renderArcDropdown = () => {
      arcSetting.clear();
      arcSetting.setName('Story Arc').setDesc('Which lane or plotline this scene belongs to.');
      arcSetting.addDropdown(drop => {
        const existingArcs = collectFrontmatterValues(this.app, 'story-arc');
        
        drop.addOption('', '-- Select an Arc --');
        existingArcs.forEach(a => drop.addOption(a, a));
        drop.addOption('__CREATE__', '+ Create New Arc...');

        if (existingArcs.includes(currentArc)) {
          drop.setValue(currentArc);
        } else if (currentArc) {
          drop.addOption(currentArc, currentArc);
          drop.setValue(currentArc);
        }

        drop.onChange(async (val) => {
          if (val === '__CREATE__') {
            renderArcTextInput(); // Morph into text input mode
            return;
          }
          if (val !== currentArc) {
            await setFrontmatterKey(this.app, node.file!, 'story-arc', val);
          }
        });
      });
    };

    const renderArcTextInput = () => {
      arcSetting.clear();
      arcSetting.setName('New Story Arc').setDesc('Type a new lane name, then press Enter.');
      arcSetting.addText(text => {
        text.setPlaceholder('e.g. Subplot B');
        const saveArc = async () => {
          const val = text.getValue().trim();
          if (val && val !== currentArc) {
            await setFrontmatterKey(this.app, node.file!, 'story-arc', val);
          }
        };
        text.inputEl.addEventListener('blur', saveArc);
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            saveArc();
            text.inputEl.blur(); 
            // Return to dropdown mode after saving
            setTimeout(() => { this.pollSelection(); }, 50); 
          }
          if (e.key === 'Escape') {
            renderArcDropdown(); // Cancel creation
          }
        });
        setTimeout(() => text.inputEl.focus(), 50);
      });
    };

    // Default to dropdown mode
    renderArcDropdown();

    // --- Date String Editor ---
    new Setting(this.container)
      .setName('Story Date')
      .setDesc(boundsStr)
      .addText(text => {
        text.setValue(currentDateRaw)
            .setPlaceholder('YYYY-MM-DD');

        const saveDate = async () => {
          const val = text.getValue();
          if (val !== currentDateRaw) {
            const regex = this.plugin.settings.dateSettings.dateParserRegex;
            if (new RegExp(regex).test(val)) {
              await setFrontmatterKey(this.app, node.file!, 'story-date', val);
            } else {
              new Notice('Invalid date format for Storyboard');
            }
          }
        };

        text.inputEl.addEventListener('blur', saveDate);
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            saveDate();
            text.inputEl.blur();
          }
        });
      });

    // --- Dependencies List ---
    this.container.createEl('h4', { text: 'Dependencies' });
    const depsContainer = this.container.createDiv({ cls: 'storyboard-deps-list' });
    if (currentDeps.length === 0) {
        depsContainer.createEl('span', { text: 'No dependencies set.', cls: 'storyflow-subtext' });
    } else {
        currentDeps.forEach(dep => {
            const depItem = depsContainer.createDiv({ cls: 'storyflow-dep-item' });
            depItem.createEl('div', { 
                text: `${dep.type === 'before' ? 'Before:' : 'After:'} ${dep.basename}`,
                cls: `storyflow-dep-tag dep-${dep.type}`
            });
            const removeBtn = depItem.createEl('button', { text: '✕', cls: 'storyflow-dep-remove' });
            
            removeBtn.onclick = async () => {
                const depStr = `${dep.basename}:${dep.type}`;
                const inverseType = dep.type === 'before' ? 'after' : 'before';
                const inverseDepStr = `${node.file!.basename}:${inverseType}`;

                // 1. Remove from THIS file
                await this.app.fileManager.processFrontMatter(node.file!, (fm) => {
                    const arr = fm['story-deps'];
                    if (Array.isArray(arr)) {
                        fm['story-deps'] = arr.filter(d => d !== depStr);
                        if (fm['story-deps'].length === 0) delete fm['story-deps'];
                    }
                });

                // 2. Remove from TARGET file (Two-way data binding)
                const targetFile = this.app.vault.getMarkdownFiles().find(f => f.basename === dep.basename);
                if (targetFile) {
                    await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
                        const arr = fm['story-deps'];
                        if (Array.isArray(arr)) {
                            fm['story-deps'] = arr.filter(d => d !== inverseDepStr);
                            if (fm['story-deps'].length === 0) delete fm['story-deps'];
                        }
                    });
                }

                new Notice(`Removed dependency: ${dep.basename}`);
                setTimeout(() => this.pollSelection(), 50); // Refresh immediately
            };
        });
    }

    new Setting(this.container)
      .addButton(btn => btn
        .setButtonText('+ Add Dependency')
        .onClick(() => {
            new SetDependenciesModal(this.plugin, node.file!, () => {
                this.pollSelection(); // Refresh Inspector when modal closes
            }).open();
        })
      );

    // --- Constraint Window Toggle ---
    new Setting(this.container)
      .setName('Show constraint window')
      .setDesc(constraintStr)
      .addToggle(toggle => {
          toggle.setValue(this.showConstraintWindow)
                .onChange(val => {
                    this.showConstraintWindow = val;
                    if (val) {
                        this.renderConstraintOverlays(canvas, constraintEarliestX, constraintLatestX);
                    } else {
                        this.clearConstraintOverlays();
                    }
                });
      });
      
    // Re-apply safely on reload if toggle left on
    if (this.showConstraintWindow && canvas) {
        this.renderConstraintOverlays(canvas, constraintEarliestX, constraintLatestX);
    }

    // --- Date Slider (X-Axis Control) ---
    this.container.createEl('h4', { text: 'Timeline Nudge', cls: 'timeline-slider-header' });
    this.container.createEl('p', { 
      text: 'Slide left/right to move the node on the timeline. Release to sync changes to frontmatter.',
      cls: 'setting-item-description'
    });

    const sliderContainer = this.container.createDiv({ cls: 'timeline-slider-container' });
    const slider = sliderContainer.createEl('input');
    slider.type = 'range';
    
    // We treat the slider as ±1000 pixels from its CURRENT canvas location
    const startX = node.x;
    slider.min = (startX - 1000).toString();
    slider.max = (startX + 1000).toString();
    slider.value = startX.toString();

    // Input fires continuously while dragging
    slider.addEventListener('input', () => {
      const newX = parseInt(slider.value, 10);
      node.setData({ ...node.getData(), x: newX });
      if(canvas) canvas.requestSave();
    });

    // Change fires on mouse release
    slider.addEventListener('change', async () => {
      // Re-center slider to afford infinite dragging
      const currentX = node.x;
      slider.min = (currentX - 1000).toString();
      slider.max = (currentX + 1000).toString();
      slider.value = currentX.toString();

      // Trigger the sync engine ONLY for this specific node
      new Notice('Slider released. Updating node date...');
      
      // Calculate new date based on new position relative to others
      if(canvas) await this.plugin.canvasManager.syncStoryboard(canvas);
    });
  }

  // ─── Phase 6 Helpers ───

  private compareAbstractDates(a: number[], b: number[]): number {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const aVal = a[i] || 0;
        const bVal = b[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
    }
    return 0;
  }

  private clearConstraintOverlays() {
      document.querySelectorAll('.storyflow-constraint-overlay').forEach(el => el.remove());
  }

  private renderConstraintOverlays(canvas: any, earliestX: number, latestX: number) {
      if (!canvas) return;
      this.clearConstraintOverlays();

      const viewport = canvas.nodeEl; // The container holding all nodes (.canvas-wrapper or similar)
      if (!viewport) return;

      // Unbounded on left side
      if (earliestX !== -Infinity) {
          const earliestOverlay = document.createElement('div');
          earliestOverlay.addClasses(['storyflow-constraint-overlay', 'invalid']);
          // Spans from extreme negative to the earliest allowable coordinate
          Object.assign(earliestOverlay.style, {
              left: '-100000px',
              width: `${100000 + earliestX}px`,
          });
          viewport.appendChild(earliestOverlay);
      }

      // Unbounded on right side
      if (latestX !== Infinity) {
          const latestOverlay = document.createElement('div');
          latestOverlay.addClasses(['storyflow-constraint-overlay', 'invalid']);
          // Spans from latest allowable coordinate to extreme positive
          Object.assign(latestOverlay.style, {
              left: `${latestX}px`,
              width: '100000px',
          });
          viewport.appendChild(latestOverlay);
      }

      // Safe zone (Green)
      const safeLeft = earliestX === -Infinity ? -100000 : earliestX;
      const safeRight = latestX === Infinity ? 100000 : latestX;
      
      const validOverlay = document.createElement('div');
      validOverlay.addClasses(['storyflow-constraint-overlay', 'valid']);
      Object.assign(validOverlay.style, {
          left: `${safeLeft}px`,
          width: `${safeRight - safeLeft}px`,
      });
      viewport.appendChild(validOverlay);
  }
}
