/** Preserve order per graphic while allowing independent graphics to load concurrently.
 * A clear/resync is a barrier: prior commands finish before it, later commands wait for it.
 */
export class RendererCommandQueue {
  private tails = new Map<string, Promise<void>>();
  private fence: Promise<void> = Promise.resolve();

  enqueue(id: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(id) || Promise.resolve();
    const work = Promise.all([this.fence, previous]).then(operation);
    const settled = work.catch(() => {});
    this.tails.set(id, settled);
    void settled.then(() => {
      if (this.tails.get(id) === settled) this.tails.delete(id);
    });
    return work;
  }

  barrier(operation: () => Promise<void>): Promise<void> {
    const work = Promise.all([this.fence, ...this.tails.values()]).then(
      operation,
    );
    this.fence = work.catch(() => {});
    this.tails.clear();
    return work;
  }
}
