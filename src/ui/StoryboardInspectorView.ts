import { ItemView, WorkspaceLeaf, Notice, Setting, TFile, Modal, App } from 'obsidian';
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

    const titleEl = containerEl.createEl('h3', { text: 'Storyboard Inspector', cls: 'storyboard-inspector-title' });
    this.container = containerEl.createDiv({ cls: 'inspector-content' });

    this.renderEmptyState();

    // Poll selection every 300ms since Canvas API doesn't expose native selection events
    this.pollInterval = window.setInterval(() => this.pollSelection(), 300);

    // Phase 6: Sync UI when frontmatter dependencies change
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (!this.activeNodeId || !this.container) return;
        
        // Don't interrupt if the user is actively typing in a text field!
        if (this.container.contains(document.activeElement)) return;
        
        const canvas = this.plugin?.canvasManager?.getActiveCanvas();
        if (!canvas) return;
        
        const targetNode = canvas.nodes.get(this.activeNodeId);
        if (targetNode && targetNode.getData().type === 'file' && targetNode.file?.path === file.path) {
            // Wait slightly for cache to settle
            setTimeout(() => this.renderInspector(targetNode as CanvasNode), 50);
        }
      })
    );
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
    
    const innerContainer = this.container.createDiv({ cls: 'storyboard-inspector-inner' });
    
    // Global Canvas Switcher remains active even when nothing is selected
    const switchContainer = innerContainer.createDiv({ cls: 'storyflow-inspector-card' });
    switchContainer.createEl('h4', { text: 'Canvas View Mode', cls: 'storyboard-inspector-card-title' });
    
    if (this.plugin?.settings?.layoutConfig) {
      new Setting(switchContainer)
        .setName('Layout Sequence')
        .setDesc(this.plugin.settings.layoutConfig.layoutMode === 'absolute' 
          ? 'Strict timeline spacing' 
          : 'Evenly distributed layout')
        .addDropdown(dropdown => dropdown
          .addOption('absolute', 'Absolute Time')
          .addOption('ordered', 'Ordered Sequence')
          .setValue(this.plugin.settings.layoutConfig.layoutMode)
          .onChange(async (value: 'absolute' | 'ordered') => {
            this.plugin.settings.layoutConfig.layoutMode = value;
            await this.plugin.saveSettings();
            
            const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
            if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
            
            this.onOpen(); 
          }));
    }

    innerContainer.createDiv({ 
      text: 'Select a single file node on the canvas to inspect it.', 
      cls: 'storyflow-empty-state-card' 
    });
    
    this.activeNodeId = null;
    this.showConstraintWindow = false;
    this.clearConstraintOverlays();
  }

  pollSelection() {
    if (!this.container) return;

    // DO NOT re-render if the user is actively typing in one of our input fields!
    if (this.container.contains(document.activeElement)) {
      return; 
    }

    const canvas = this.plugin?.canvasManager?.getActiveCanvas();
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

    const innerContainer = this.container.createDiv({ cls: 'storyboard-inspector-inner' });
    
    const headerEl = innerContainer.createDiv({ cls: 'storyboard-inspector-header' });
    headerEl.createEl('h3', { text: node.file.basename });
    headerEl.createEl('div', { text: 'Storyboard Node', cls: 'storyflow-subtext' });

    // Global Canvas Switcher
    const switchContainer = innerContainer.createDiv({ cls: 'storyflow-inspector-card' });
    switchContainer.createEl('h4', { text: 'Canvas View Mode', cls: 'storyboard-inspector-card-title' });
    
    new Setting(switchContainer)
      .setName('Layout Sequence')
      .setDesc(this.plugin.settings.layoutConfig.layoutMode === 'absolute' 
        ? 'Strict timeline spacing' 
        : 'Evenly distributed layout')
      .addDropdown(dropdown => dropdown
        .addOption('absolute', 'Absolute Time')
        .addOption('ordered', 'Ordered Sequence')
        .setValue(this.plugin.settings.layoutConfig.layoutMode)
        .onChange(async (value: 'absolute' | 'ordered') => {
          this.plugin.settings.layoutConfig.layoutMode = value;
          await this.plugin.saveSettings();
          
          const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
          if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
          
          this.activeNodeId = null; // force clean state
          this.onOpen(); // fully repaint the Sidebar so the desc string updates
        }));


    const cache = this.app.metadataCache.getFileCache(node.file);
    const fm: Record<string, any> = cache?.frontmatter || {};

    const currentArc = fm['story-arc']?.toString() || '';
    let currentDateRaw = fm['story-date']?.toString() || '';
    let currentTension = 5; // Default if not found
    if (typeof fm['tension'] === 'number' && fm['tension'] >= 1 && fm['tension'] <= 10) {
      currentTension = fm['tension'];
    }
    
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

    // ─── Phase 6: Unified Constraint Window (Dependencies + Arc) ───
    let earliestPossible: number[] | null = null;
    let latestPossible: number[] | null = null;
    let earliestSource = '-∞';
    let latestSource = '+∞';

    const canvas = this.plugin.canvasManager.getActiveCanvas();
    if (canvas) {
      try {
        const scenes = await this.plugin.canvasManager.extractScenes(canvas);
        
        // 1. Arc Constraints
        if (currentArc) {
          const arcScenes = scenes
            .filter(s => s.arc === currentArc)
            .sort((a, b) => this.compareAbstractDates(a.date, b.date));
            
          const myIndex = arcScenes.findIndex(s => s.nodeId === node.getData().id);
          if (myIndex !== -1) {
            const prev = myIndex > 0 ? arcScenes[myIndex - 1] : null;
            const next = myIndex < arcScenes.length - 1 ? arcScenes[myIndex + 1] : null;
            
            if (prev) {
              earliestPossible = prev.date;
              earliestSource = `${prev.title} (Arc)`;
            }
            if (next) {
              latestPossible = next.date;
              latestSource = `${next.title} (Arc)`;
            }
          }
        }

        // 2. Dependency Constraints
        for (const dep of currentDeps) {
          const targetScene = scenes.find(s => s.file.basename === dep.basename);
          if (!targetScene) continue;

          if (dep.type === 'after') {
            // This node must be AFTER the target -> Target is an Earliest Boundary
            if (!earliestPossible || this.compareAbstractDates(targetScene.date, earliestPossible) > 0) {
              earliestPossible = targetScene.date;
              earliestSource = `${targetScene.title} (Dep)`;
            }
          } else if (dep.type === 'before') {
            // This node must be BEFORE the target -> Target is a Latest Boundary
            if (!latestPossible || this.compareAbstractDates(targetScene.date, latestPossible) < 0) {
              latestPossible = targetScene.date;
              latestSource = `${targetScene.title} (Dep)`;
            }
          }
        }
      } catch(e) { /* fallback */ }
    }

    const eStr = earliestPossible ? formatAbstractDate(earliestPossible, this.plugin.settings.dateSettings) : '-∞';
    const lStr = latestPossible ? formatAbstractDate(latestPossible, this.plugin.settings.dateSettings) : '+∞';
    
    let windowDesc = 'Allowed Window: Any date';
    if (earliestPossible || latestPossible) {
      windowDesc = `Allowed: ${eStr} ➔ ${lStr}\nBounded by: [${earliestSource}] and [${latestSource}]`;
    }

    // --- Timeline Nudge Card ---
    const timelineCard = innerContainer.createDiv({ cls: 'storyflow-inspector-card' });
    timelineCard.createEl('h4', { text: 'Timeline Nudge', cls: 'timeline-slider-header' });
    timelineCard.createEl('p', { 
      text: 'Slide left/right to move the node on the timeline. Release to sync changes to frontmatter.',
      cls: 'setting-item-description'
    });

    const sliderContainer = timelineCard.createDiv({ cls: 'timeline-slider-container' });
    const slider = sliderContainer.createEl('input', { cls: 'storyflow-nudge-slider' });
    slider.type = 'range';
    slider.style.width = '100%';
    
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

    // --- Properties Card ---
    const propsCard = innerContainer.createDiv({ cls: 'storyflow-inspector-card' });
    propsCard.createEl('h4', { text: 'Properties' });

    // --- Arc Editor ---
    const arcSetting = new Setting(propsCard)
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
            const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
            if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
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
            const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
            if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
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
    new Setting(propsCard)
      .setName('Story Date')
      .setDesc(windowDesc)
      .addText(text => {
        text.setValue(currentDateRaw)
            .setPlaceholder('YYYY-MM-DD');

        const saveDate = async () => {
          const val = text.getValue();
          if (val !== currentDateRaw) {
            const regex = this.plugin.settings.dateSettings.dateParserRegex;
            if (new RegExp(regex).test(val)) {
              await setFrontmatterKey(this.app, node.file!, 'story-date', val);
              const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
              if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
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

    // --- Tension Editor ---
    const tensionContainer = propsCard.createDiv();
    const tensionDisplay = tensionContainer.createEl('div', { text: `Tension Level: ${currentTension}` });
    tensionDisplay.style.fontWeight = 'bold';
    tensionDisplay.style.marginBottom = '4px';

    new Setting(tensionContainer)
      .setName('Dramatic Tension')
      .setDesc('1 (Calm) to 10 (High Action)')
      .addSlider(slider => {
        slider.setLimits(1, 10, 1)
          .setValue(currentTension)
          .setDynamicTooltip()
          .onChange(async (v) => {
            currentTension = v;
            
            // Fires on release. We officially update the Frontmatter now.
            await setFrontmatterKey(this.app, node.file!, 'tension', v);
            
            // Re-render the node explicitly (forces sort layout consistency)
            if(canvas) this.plugin.canvasManager.sortStoryboard(canvas);
          });
          
        // Add real-time continuous visual feedback during the drag
        slider.sliderEl.addEventListener('input', () => {
            const v = parseInt(slider.sliderEl.value);
            tensionDisplay.setText(`Tension Level: ${v}`);
            
            // Instantly hot-swap classes on the actual DOM element
            if (node.nodeEl) {
                for (let t = 1; t <= 10; t++) node.nodeEl.classList.remove(`storyboard-tension-${t}`);
                node.nodeEl.classList.add(`storyboard-tension-${v}`);
            }
        });
      });

    // --- Dependencies Card ---
    const depsCard = innerContainer.createDiv({ cls: 'storyflow-inspector-card' });
    depsCard.createEl('h4', { text: 'Dependencies' });
    
    const depsBtnGroup = new Setting(depsCard)
      .addButton(btn => btn
        .setButtonText('Show Dependencies')
        .setTooltip('View and delete active dependencies')
        .onClick(() => {
            new ShowDependenciesModal(this.app, this.plugin, node, node.file!, currentDeps, () => {
                this.renderInspector(node); // Force refresh UI
            }).open();
        })
      )
      .addButton(btn => btn
        .setButtonText('+ Add Dependency')
        .setCta()
        .onClick(() => {
            new SetDependenciesModal(this.plugin, node.file!, () => {
                this.renderInspector(node); // Force refresh UI
            }).open();
        })
      );
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

// ─── Show Dependencies Modal ───
export class ShowDependenciesModal extends Modal {
    plugin: StoryboardCanvasPlugin;
    sourceFile: TFile;
    node: any;
    currentDeps: { type: 'before'|'after', basename: string }[];
    onComplete: () => void;

    constructor(
        app: App, 
        plugin: StoryboardCanvasPlugin, 
        node: any,
        sourceFile: TFile, 
        currentDeps: { type: 'before'|'after', basename: string }[],
        onComplete: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.node = node;
        this.sourceFile = sourceFile;
        this.currentDeps = currentDeps;
        this.onComplete = onComplete;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: `Dependencies for ${this.sourceFile.basename}` });

        const depsContainer = contentEl.createDiv({ cls: 'storyboard-deps-list' });
        depsContainer.style.maxHeight = '400px';
        depsContainer.style.padding = '10px';
        depsContainer.style.overflowY = 'auto';
        
        if (this.currentDeps.length === 0) {
            depsContainer.createEl('p', { text: 'No dependencies set. Use the Add Dependency button to create one.', cls: 'storyflow-subtext' });
        } else {
            this.currentDeps.forEach(dep => {
                const tagEl = depsContainer.createEl('div', { cls: `storyflow-dep-tag dep-${dep.type}` });
                tagEl.style.marginBottom = '8px';
                tagEl.style.display = 'flex';
                tagEl.style.justifyContent = 'space-between';
                tagEl.style.alignItems = 'center';
                tagEl.setText(`${dep.type === 'before' ? 'Before:' : 'After:'} ${dep.basename}`);
                
                const removeBtn = tagEl.createEl('span', { text: '✕', cls: 'storyflow-dep-remove clickable-icon' });
                removeBtn.style.marginLeft = '10px';
                removeBtn.style.color = 'var(--text-error)';
                removeBtn.style.fontWeight = 'bold';
                removeBtn.style.cursor = 'pointer';
                
                removeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const depStr = `${dep.basename}:${dep.type}`;
                    const inverseType = dep.type === 'before' ? 'after' : 'before';
                    const inverseDepStr = `${this.sourceFile.basename}:${inverseType}`;

                    // 1. Remove from THIS file
                    await this.app.fileManager.processFrontMatter(this.sourceFile, (fm) => {
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
                    
                    const activeCanvas = this.plugin.canvasManager.getActiveCanvas();
                    if (activeCanvas) await this.plugin.canvasManager.buildStoryboard(activeCanvas);
                    
                    // Filter the deleted item from UI state to avoid a disruptive entire modal reload
                    this.currentDeps = this.currentDeps.filter(d => d.basename !== dep.basename);
                    
                    // Trigger a re-render of just this modal's content
                    this.onOpen();
                });
            });
        }
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
        this.onComplete();
    }
}
