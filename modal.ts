import { App, Component, MarkdownRenderer, Modal, TFile } from 'obsidian';
import NoteReviewerPlugin from './main';

interface UndoEntry {
  file: TFile;
  content: string;
  originalPath: string;
}

export class ReviewModal extends Modal {
  private plugin: NoteReviewerPlugin;
  private remaining: TFile[] = [];
  private currentIdx = 0;
  private deletedInSession: string[] = [];
  private undoStack: UndoEntry[] = [];
  private animating = false;
  private component = new Component();
  private keyHandler: (e: KeyboardEvent) => void;

  constructor(app: App, plugin: NoteReviewerPlugin) {
    super(app);
    this.plugin = plugin;
    this.keyHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'k' || e.key === 'K' || e.key === ' ') {
        e.preventDefault();
        this.decide(true);
      } else if (e.key === 'ArrowLeft' || e.key === 'd' || e.key === 'D') {
        this.decide(false);
      } else if (e.key === 'z' || e.key === 'Z') {
        this.undo();
      }
    };
  }

  onOpen() {
    this.component.load();
    this.modalEl.addClass('note-reviewer-modal');
    document.addEventListener('keydown', this.keyHandler);

    const allFiles = this.app.vault.getMarkdownFiles();

    if (this.plugin.data.sessionActive && this.plugin.data.reviewed.length > 0) {
      const reviewedPaths = new Set(this.plugin.data.reviewed);
      const remainingFiles = allFiles.filter(f => !reviewedPaths.has(f.path));
      this.showSessionPrompt(remainingFiles, allFiles.length);
    } else {
      this.startNewSession(allFiles);
    }
  }

  onClose() {
    document.removeEventListener('keydown', this.keyHandler);
    this.component.unload();
    this.contentEl.empty();
  }

  // ── Screen: Session Prompt ──────────────────────────────────────────────

  private showSessionPrompt(remaining: TFile[], total: number) {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('p', { text: 'Continuar sessão anterior?', cls: 'nr-title' });
    contentEl.createEl('p', {
      text: `${remaining.length} notas restantes de ${total} total`,
      cls: 'nr-subtitle',
    });

    const btnRow = contentEl.createDiv({ cls: 'nr-btn-row' });
    btnRow
      .createEl('button', { text: 'Nova sessão', cls: 'nr-btn nr-btn-secondary' })
      .addEventListener('click', () => this.startNewSession(this.app.vault.getMarkdownFiles()));
    btnRow
      .createEl('button', { text: 'Continuar', cls: 'nr-btn nr-btn-primary' })
      .addEventListener('click', () => this.continueSession(remaining));
  }

  // ── Session management ──────────────────────────────────────────────────

  private startNewSession(allFiles: TFile[]) {
    const shuffled = [...allFiles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.remaining = shuffled;
    this.currentIdx = 0;
    this.deletedInSession = [];
    this.undoStack = [];
    this.plugin.data.reviewed = [];
    this.plugin.data.deleted = [];
    this.plugin.data.sessionActive = true;
    this.plugin.savePluginData();
    this.renderReview();
  }

  private continueSession(remaining: TFile[]) {
    this.remaining = remaining;
    this.currentIdx = 0;
    this.deletedInSession = [];
    this.undoStack = [];
    this.renderReview();
  }

  // ── Screen: Review card ─────────────────────────────────────────────────

  private renderReview() {
    if (this.currentIdx >= this.remaining.length) {
      this.renderDone();
      return;
    }

    const file = this.remaining[this.currentIdx];
    const pct = Math.round((this.currentIdx / this.remaining.length) * 100);
    const { contentEl } = this;
    contentEl.empty();

    // Header
    const header = contentEl.createDiv({ cls: 'nr-header' });
    const left = header.createDiv();
    left.createEl('span', {
      text: `${this.currentIdx + 1} / ${this.remaining.length}`,
      cls: 'nr-counter',
    });
    left.createEl('span', {
      text: `${this.deletedInSession.length} no lixo`,
      cls: 'nr-pill-del',
    });
    const undoBtn = header.createEl('button', { text: '↩ desfazer', cls: 'nr-undo-btn' });
    if (this.undoStack.length === 0) undoBtn.setAttribute('disabled', 'true');
    undoBtn.addEventListener('click', () => this.undo());

    // Progress bar
    const fill = contentEl.createDiv({ cls: 'nr-track' }).createDiv({ cls: 'nr-fill' });
    fill.style.width = `${pct}%`;

    // Card
    const card = contentEl
      .createDiv({ cls: 'nr-card-wrap' })
      .createDiv({ cls: 'nr-card', attr: { id: 'nr-card' } });

    card.createEl('p', { text: file.path, cls: 'nr-filepath' });

    const titleRow = card.createDiv({ cls: 'nr-title-row' });
    titleRow.createEl('p', { text: file.basename, cls: 'nr-note-title' });
    titleRow
      .createEl('button', { text: '↗ abrir', cls: 'nr-btn-open' })
      .addEventListener('click', () => {
        this.app.workspace.openLinkText(file.basename, file.path, false);
      });

    const body = card.createDiv({ cls: 'nr-nbody' });
    body.setText('carregando...');
    this.loadContent(file, body);

    // Action buttons
    const btnRow = contentEl.createDiv({ cls: 'nr-btn-row' });
    btnRow
      .createEl('button', { text: '✕  lixo', cls: 'nr-btn nr-btn-del' })
      .addEventListener('click', () => this.decide(false));
    btnRow
      .createEl('button', { text: '✓  manter', cls: 'nr-btn nr-btn-keep' })
      .addEventListener('click', () => this.decide(true));

    contentEl.createEl('p', {
      text: '← D  deletar       manter  K →       Z desfazer       espaço manter',
      cls: 'nr-hint',
    });
  }

  private async loadContent(file: TFile, el: HTMLElement) {
    try {
      const content = await this.app.vault.cachedRead(file);
      el.empty();
      if (!content.trim()) {
        el.createEl('em', { text: 'nota vazia', cls: 'nr-empty' });
        return;
      }
      const preview =
        content.length > 4000 ? content.slice(0, 4000) + '\n\n---\n*[...truncado]*' : content;
      await MarkdownRenderer.render(this.app, preview, el, file.path, this.component);
    } catch {
      el.setText('erro ao ler arquivo');
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private async decide(keep: boolean) {
    if (this.animating || this.currentIdx >= this.remaining.length) return;
    this.animating = true;
    const file = this.remaining[this.currentIdx];

    if (!keep) {
      try {
        const content = await this.app.vault.read(file);
        await this.app.vault.trash(file, true);
        this.deletedInSession.push(file.path);
        this.undoStack.push({ file, content, originalPath: file.path });
        this.plugin.data.deleted.push(file.path);
      } catch (e) {
        this.animating = false;
        console.error('Note Reviewer: error trashing file', e);
        return;
      }
    }

    const card = document.getElementById('nr-card');
    if (card) {
      card.classList.add(keep ? 'nr-out-right' : 'nr-out-left');
      setTimeout(async () => {
        this.animating = false;
        this.plugin.data.reviewed.push(file.path);
        this.plugin.data.totalReviewed++;
        await this.plugin.savePluginData();
        this.currentIdx++;
        this.renderReview();
      }, 240);
    } else {
      this.animating = false;
    }
  }

  private async undo() {
    if (this.undoStack.length === 0 || this.animating) return;
    const last = this.undoStack.pop()!;
    try {
      await this.app.vault.create(last.originalPath, last.content);
      this.deletedInSession = this.deletedInSession.filter(p => p !== last.originalPath);
      this.plugin.data.deleted = this.plugin.data.deleted.filter(p => p !== last.originalPath);
      this.plugin.data.reviewed = this.plugin.data.reviewed.filter(p => p !== last.originalPath);
      this.plugin.data.totalReviewed = Math.max(0, this.plugin.data.totalReviewed - 1);
      this.currentIdx = Math.max(0, this.currentIdx - 1);
      this.remaining.splice(this.currentIdx, 0, last.file);
      await this.plugin.savePluginData();
      this.renderReview();
    } catch (e) {
      this.undoStack.push(last);
      console.error('Note Reviewer: error restoring file', e);
    }
  }

  // ── Screen: Done ────────────────────────────────────────────────────────

  private renderDone() {
    const kept = this.remaining.length - this.deletedInSession.length;
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('p', { text: 'Revisão concluída!', cls: 'nr-done-title' });
    contentEl.createEl('p', {
      text:
        this.deletedInSession.length > 0
          ? `${this.deletedInSession.length} notas foram para a lixeira.`
          : 'Nenhuma nota foi deletada.',
      cls: 'nr-subtitle',
    });

    const stats = contentEl.createDiv({ cls: 'nr-stats' });

    const keptCard = stats.createDiv({ cls: 'nr-statcard' });
    keptCard.createEl('p', { text: 'mantidas', cls: 'nr-stat-label' });
    keptCard.createEl('p', { text: String(kept), cls: 'nr-stat-value' });

    const delCard = stats.createDiv({ cls: 'nr-statcard' });
    delCard.createEl('p', { text: 'no lixo', cls: 'nr-stat-label' });
    delCard.createEl('p', { text: String(this.deletedInSession.length), cls: 'nr-stat-value' });

    if (this.deletedInSession.length > 0) {
      const list = contentEl.createDiv({ cls: 'nr-flist' });
      this.deletedInSession.slice(0, 80).forEach(path => {
        const item = list.createDiv({ cls: 'nr-fitem' });
        item.createEl('span', { text: '✕', cls: 'nr-del-icon' });
        item.createEl('span', { text: path, cls: 'nr-del-path' });
      });
      if (this.deletedInSession.length > 80) {
        contentEl.createEl('p', {
          text: `...e mais ${this.deletedInSession.length - 80}`,
          cls: 'nr-hint',
        });
      }
    }

    this.plugin.data.sessionActive = false;
    this.plugin.savePluginData();

    contentEl
      .createDiv({ cls: 'nr-btn-row' })
      .createEl('button', { text: 'Nova sessão', cls: 'nr-btn nr-btn-primary' })
      .addEventListener('click', () => this.startNewSession(this.app.vault.getMarkdownFiles()));
  }
}
