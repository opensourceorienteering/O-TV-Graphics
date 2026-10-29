/**
 * OGraf graphic module loader
 *
 * The OGraf v1 spec says the graphic's `main` file is an ES module whose *default export*
 * is the Web Component class, and that the renderer (not the graphic) registers it as a
 * custom element. Doing it this way:
 *  - lets third-party OGraf packages load here unmodified, and our templates load in other renderers;
 *  - lets an edited template be reloaded: each cache-busted import yields a new class, which gets
 *    a fresh tag (a custom element name can only be defined once per page).
 *
 * Fallback: older Split Control templates that called customElements.define(templateId, ...) themselves
 * and have no default export still load.
 */

const tagByClass = new WeakMap<CustomElementConstructor, string>();
let sequence = 0;

function toTagBase(templateId: string): string {
  const base = templateId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  return `ograf-${base || 'graphic'}`;
}

/**
 * Import a graphic module and return the custom element tag to instantiate it with.
 */
export async function defineOGrafGraphic(moduleUrl: string, templateId: string): Promise<string> {
  const mod = await import(/* @vite-ignore */ moduleUrl);
  const GraphicClass: unknown = mod?.default;

  if (typeof GraphicClass === 'function') {
    const ctor = GraphicClass as CustomElementConstructor;
    const known = tagByClass.get(ctor);
    if (known) return known;

    const tag = `${toTagBase(templateId)}-${++sequence}`;
    customElements.define(tag, ctor);
    tagByClass.set(ctor, tag);
    return tag;
  }

  // Legacy: module registered itself under its directory name
  if (customElements.get(templateId)) {
    console.warn(`[OGraf] ${templateId} has no default export; using self-registered <${templateId}>. ` +
      'Add `export default` to the graphic class for OGraf v1 compliance.');
    return templateId;
  }

  throw new Error(`Graphic module ${moduleUrl} must "export default" its Web Component class (OGraf v1).`);
}
