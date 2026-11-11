/**
 * Safety checks and parameter binding for SQL written in profiles and plugins.
 *
 * Profiles may only read. The connection is opened read-only as well (mysqlRunner), so this
 * check is the first of two walls, and it gives the profile author a clear message early.
 */

/** Split SQL into code and the literals/identifiers/comments it must not look inside */
interface Piece { code: boolean; text: string }

function tokenize(sql: string): Piece[] {
  const pieces: Piece[] = [];
  let code = '';
  let i = 0;
  const flush = () => { if (code) { pieces.push({ code: true, text: code }); code = ''; } };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      flush();
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && ch !== '`') { j += 2; continue; }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; } // doubled quote
          break;
        }
        j++;
      }
      pieces.push({ code: false, text: sql.slice(i, j + 1) });
      i = j + 1;
    } else if ((ch === '-' && next === '-') || ch === '#') {
      flush();
      const end = sql.indexOf('\n', i);
      const j = end === -1 ? sql.length : end;
      pieces.push({ code: false, text: ' ' });
      i = j;
    } else if (ch === '/' && next === '*') {
      flush();
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('SQL has an unclosed /* comment');
      pieces.push({ code: false, text: ' ' });
      i = end + 2;
    } else {
      code += ch;
      i++;
    }
  }
  flush();
  return pieces;
}

const FORBIDDEN = /\b(into|outfile|dumpfile|load_file|sleep|benchmark|get_lock|release_lock|lock|unlock|for\s+update|share\s+mode|insert|update|delete|drop|alter|create|truncate|grant|revoke|call|handler|set|commit|rollback|attach|pragma)\b/i;

/** Throws unless the SQL is a single read-only SELECT (or WITH ... SELECT) */
export function assertReadOnlySelect(sql: string, label = 'query'): void {
  const code = tokenize(sql).filter(p => p.code).map(p => p.text).join(' ').trim();
  const body = code.replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(body)) throw new Error(`${label}: only SELECT queries are allowed`);
  if (body.includes(';')) throw new Error(`${label}: one statement per query`);
  const bad = FORBIDDEN.exec(body);
  if (bad) throw new Error(`${label}: "${bad[1].toUpperCase()}" is not allowed in a read-only query`);
}

/** Named parameters (:name) a query uses */
export function namedParameters(sql: string): string[] {
  const names = new Set<string>();
  for (const p of tokenize(sql)) {
    if (!p.code) continue;
    for (const m of p.text.matchAll(/(?<![:\w]):([A-Za-z_]\w*)/g)) names.add(m[1]);
  }
  return [...names];
}

/**
 * Turn :name parameters into positional ? placeholders. Arrays expand for IN (:ids);
 * an empty array becomes NULL so "IN (NULL)" matches nothing.
 */
export function bindNamed(sql: string, params: Record<string, unknown>, label = 'query'): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const out = tokenize(sql).map(p => {
    if (!p.code) return p.text;
    return p.text.replace(/(?<![:\w]):([A-Za-z_]\w*)/g, (_, name: string) => {
      if (!(name in params)) throw new Error(`${label}: unknown parameter :${name}`);
      const v = params[name];
      if (Array.isArray(v)) {
        if (!v.length) return 'NULL';
        values.push(...v);
        return v.map(() => '?').join(', ');
      }
      values.push(v ?? null);
      return '?';
    });
  });
  return { sql: out.join(''), values };
}
