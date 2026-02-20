import { App, PluginSettingTab, Setting } from 'obsidian';
import type StoryboardCanvasPlugin from '../main';
import { DEFAULT_LAYOUT_CONFIG, DEFAULT_DATE_FORMAT_SETTINGS, type LayoutConfig, type DateFormatSettings } from './canvasTypes';

export interface StoryboardSettings {
  layoutConfig: LayoutConfig;
  dateSettings: DateFormatSettings;
}

export const DEFAULT_SETTINGS: StoryboardSettings = {
  layoutConfig: DEFAULT_LAYOUT_CONFIG,
  dateSettings: DEFAULT_DATE_FORMAT_SETTINGS,
};

export class StoryboardSettingTab extends PluginSettingTab {
  plugin: StoryboardCanvasPlugin;

  constructor(app: App, plugin: StoryboardCanvasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Storyboard Canvas Settings' });

    new Setting(containerEl)
      .setName('Layout Mode')
      .setDesc('Absolute: position nodes strictly by time elapsed on X-axis. Ordered: distribute nodes evenly in sequence on X-axis.')
      .addDropdown(dropdown => dropdown
        .addOption('absolute', 'Absolute Time Graph')
        .addOption('ordered', 'Ordered Sequence')
        .setValue(this.plugin.settings.layoutConfig.layoutMode)
        .onChange(async (value: 'absolute' | 'ordered') => {
          this.plugin.settings.layoutConfig.layoutMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Date Parser Regex')
      .setDesc('Regex with named capture groups (?<y>, ?<M>, ?<d>) to extract dates from story-date.')
      .addText(text => text
        .setPlaceholder(DEFAULT_DATE_FORMAT_SETTINGS.dateParserRegex)
        .setValue(this.plugin.settings.dateSettings.dateParserRegex)
        .onChange(async (value) => {
          this.plugin.settings.dateSettings.dateParserRegex = value.trim() || DEFAULT_DATE_FORMAT_SETTINGS.dateParserRegex;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Date Display Format')
      .setDesc('How dates appear on canvas labels. Use {y}, {M}, {d}.')
      .addText(text => text
        .setPlaceholder(DEFAULT_DATE_FORMAT_SETTINGS.dateDisplayFormat)
        .setValue(this.plugin.settings.dateSettings.dateDisplayFormat)
        .onChange(async (value) => {
          this.plugin.settings.dateSettings.dateDisplayFormat = value.trim() || DEFAULT_DATE_FORMAT_SETTINGS.dateDisplayFormat;
          await this.plugin.saveSettings();
        }));
        
    containerEl.createEl('h3', { text: 'Layout Dimensions' });

    new Setting(containerEl)
      .setName('X Scale (Absolute Mode)')
      .setDesc('Pixels per date ordinal unit in absolute time graph mode.')
      .addText(text => text
        .setValue(String(this.plugin.settings.layoutConfig.xScale))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num)) {
            this.plugin.settings.layoutConfig.xScale = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Arc Lane Spacing (Y-Axis)')
      .setDesc('Pixels between arc lanes on the Y-axis.')
      .addText(text => text
        .setValue(String(this.plugin.settings.layoutConfig.arcSpacing))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num)) {
            this.plugin.settings.layoutConfig.arcSpacing = num;
            await this.plugin.saveSettings();
          }
        }));
  }
}
