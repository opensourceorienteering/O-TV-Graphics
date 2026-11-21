/** A name as part of an id: "Guest Strap – Ö!" → "guest-strap-o" */
export function slug(text: string): string {
  const s = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'graphic';
}
