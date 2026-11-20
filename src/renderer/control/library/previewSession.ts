/**
 * The order of a library preview's renderer calls. Show, Next and Hide wait for the graphic's
 * first load (pressing Show while fonts load must not play a half-loaded graphic), and a load
 * that finishes after the preview closed is cleared rather than left in a detached element.
 */
import type { OGrafTemplateInfo } from '../../../shared/types/ograf';

export const PREVIEW_ID = 'library-preview';

/** The part of OGrafRenderer a preview uses */
export interface PreviewRenderer {
  loadGraphic(id: string, manifest: OGrafTemplateInfo['manifest'], directory: string, data: unknown): Promise<unknown>;
  playGraphic(id: string, options?: { delta?: number }): Promise<unknown>;
  stopGraphic(id: string): Promise<unknown>;
  updateGraphic(id: string, data: unknown): Promise<unknown>;
  isLoaded(id: string): boolean;
  clearAll(): Promise<void>;
}

export class PreviewSession {
  private loading: Promise<void> | null = null;
  /** Actions run one after another, in the order they were asked for */
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** On air in the preview */
  shown = false;

  constructor(
    private renderer: PreviewRenderer,
    private template: Pick<OGrafTemplateInfo, 'manifest' | 'directoryName'>,
    private data: () => unknown,
  ) {}

  /** Load the graphic and show it */
  open(): Promise<void> {
    return this.queue(async () => {
      if (!this.shown) await this.play({});
    });
  }

  show(): Promise<void> {
    return this.queue(async () => {
      if (this.shown) return;
      await this.renderer.updateGraphic(PREVIEW_ID, this.data());
      await this.play({});
    });
  }

  next(): Promise<void> {
    return this.queue(() => this.play({ delta: 1 }));
  }

  hide(): Promise<void> {
    return this.queue(async () => {
      await this.renderer.stopGraphic(PREVIEW_ID);
      this.shown = false;
    });
  }

  /** Follow the race while shown */
  async tick(): Promise<void> {
    if (this.closed || !this.shown || !this.renderer.isLoaded(PREVIEW_ID)) return;
    await this.renderer.updateGraphic(PREVIEW_ID, this.data());
  }

  close(): void {
    this.closed = true;
    // The frame usually goes right after (the preview closed): nothing to report then
    this.renderer.clearAll().catch(() => undefined);
  }

  private async play(options: { delta?: number }) {
    await this.renderer.playGraphic(PREVIEW_ID, options);
    this.shown = true;
  }

  /** Run after the first load and after earlier actions; nothing runs once closed, and a late load is cleared */
  private queue(action: () => Promise<void>): Promise<void> {
    const run = this.chain.catch(() => undefined).then(async () => {
      this.loading ??= (async () => {
        await this.renderer.loadGraphic(PREVIEW_ID, this.template.manifest, this.template.directoryName, this.data());
        if (this.closed) await this.renderer.clearAll();
      })();
      try {
        await this.loading;
      } catch (e) {
        this.loading = null; // a later click tries the load again
        throw e;
      }
      if (!this.closed) await action();
    });
    this.chain = run;
    return run;
  }
}
