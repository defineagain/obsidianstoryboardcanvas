import { ItemView, WorkspaceLeaf, Notice, Setting, debounce } from 'obsidian';
import type StoryboardCanvasPlugin from '../../main';
import { CanvasNode } from '../Canvas';
import { getAbstractDateFromMetadata } from '../dateParser';
import { formatAbstractDate } from '../dateFormatter';
import { setFrontmatterKey } from '../taggingModals';

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
    return 'clapperboard';
  }

  async onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('storyboard-inspector-view');

    containerEl.createEl('h3', { text: 'Storyboard Inspector' });
    this.container = containerEl.createDiv({ cls: 'inspector-content' });

    this.renderEmptyState();

    // Poll selection every 300ms
    this.pollInterval = window.setInterval(() => this.pollSelection(), 300);
  }

  async onClose() {
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
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

    // --- Arc Editor ---
    new Setting(this.container)
      .setName('Story Arc')
      .setDesc('Which lane or plotline this scene belongs to.')
      .addText(text => {
        text.setValue(currentArc)
            .setPlaceholder('e.g. Main Plot')
            .onChange(async (val) => {
              await setFrontmatterKey(this.app, node.file!, 'story-arc', val);
            });
      });

    // --- Date String Editor ---
    new Setting(this.container)
      .setName('Story Date')
      .setDesc('Format must match plugin settings regex.')
      .addText(text => {
        text.setValue(currentDateRaw)
            .setPlaceholder('YYYY-MM-DD')
            .onChange(async (val) => {
              const regex = this.plugin.settings.dateSettings.dateParserRegex;
              if (new RegExp(regex).test(val)) {
                await setFrontmatterKey(this.app, node.file!, 'story-date', val);
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

    const canvas = this.plugin.canvasManager.getActiveCanvas()!;

    // Input fires continuously while dragging
    slider.addEventListener('input', () => {
      const newX = parseInt(slider.value, 10);
      node.setData({ ...node.getData(), x: newX });
      canvas.requestSave();
    });

    // Change fires on mouse release
    slider.addEventListener('change', async () => {
      // Re-center slider to afford infinite dragging
      const currentX = node.x;
      slider.min = (currentX - 1000).toString();
      slider.max = (currentX + 1000).toString();
      slider.value = currentX.toString();

      // Trigger the sync engine to recalculate date based on new X
      new Notice('Calculating new date from slider position...');
      await this.plugin.canvasManager.syncStoryboard(canvas);
    });
  }
}
