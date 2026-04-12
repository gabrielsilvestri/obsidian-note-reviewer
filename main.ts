import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ReviewModal } from './modal';

export interface PluginData {
  reviewed: string[];
  deleted: string[];
  sessionActive: boolean;
  totalReviewed: number;
}

const DEFAULT_DATA: PluginData = {
  reviewed: [],
  deleted: [],
  sessionActive: false,
  totalReviewed: 0,
};

export default class NoteReviewerPlugin extends Plugin {
  data: PluginData = { ...DEFAULT_DATA };

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

    this.addRibbonIcon('layers', 'Note Reviewer', () => {
      new ReviewModal(this.app, this).open();
    });

    this.addCommand({
      id: 'open-note-reviewer',
      name: 'Open Note Reviewer',
      callback: () => new ReviewModal(this.app, this).open(),
    });

    this.addSettingTab(new ReviewerSettingTab(this.app, this));
  }

  async savePluginData() {
    await this.saveData(this.data);
  }
}

class ReviewerSettingTab extends PluginSettingTab {
  plugin: NoteReviewerPlugin;

  constructor(app: App, plugin: NoteReviewerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Buy Me a Coffee section
    const coffeeDiv = containerEl.createDiv({ cls: 'nr-settings-coffee' });
    coffeeDiv.createEl('p', { text: '☕ Buy Me a Coffee', cls: 'nr-settings-coffee-title' });
    coffeeDiv.createEl('p', {
      text: 'If Note Reviewer saved you time, consider buying me a coffee!',
      cls: 'nr-settings-coffee-desc',
    });
    coffeeDiv.createEl('a', {
      text: 'buymeacoffee.com/gabrielsilvestri',
      href: 'https://buymeacoffee.com/gabrielsilvestri',
      cls: 'nr-settings-coffee-link',
    });

    // Total reviewed stat
    new Setting(containerEl)
      .setName('Total notes reviewed')
      .setDesc(`You have reviewed ${this.plugin.data.totalReviewed} notes across all sessions.`);

    // Reset session
    new Setting(containerEl)
      .setName('Reset current session')
      .setDesc('Clear session progress and start fresh next time you open the reviewer.')
      .addButton(btn =>
        btn.setButtonText('Reset session').onClick(async () => {
          this.plugin.data.reviewed = [];
          this.plugin.data.deleted = [];
          this.plugin.data.sessionActive = false;
          await this.plugin.savePluginData();
          btn.setButtonText('Done!');
          setTimeout(() => btn.setButtonText('Reset session'), 2000);
        })
      );
  }
}
