import { ItemView, WorkspaceLeaf, Notice, Setting } from 'obsidian';
import type StoryboardCanvasPlugin from '../../main';
import { CanvasNode } from '../Canvas';
import { getAbstractDateFromMetadata } from '../dateParser';
import { formatAbstractDate } from '../dateFormatter';
import { setFrontmatterKey, collectFrontmatterValues } from '../taggingModals';

export const INSPECTOR_VIEW_TYPE = 'storyboard-inspector-view';

export class StoryboardInspectorView extends ItemView {
  plugin: StoryboardCanvasPlugin;
  pollInterval: number | null = null;
  activeNodeId: string | null = null;

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
}
