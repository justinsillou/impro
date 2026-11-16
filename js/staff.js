/**
 * Dessin d'une portée en SVG : clé, altérations, lignes supplémentaires,
 * noms de notes. Deux modes :
 *  - staffSvg   : une suite de notes (gamme), sans rythme ;
 *  - phraseSvg  : une mesure rythmée (hampes, croches liées, silences).
 */
import { diatonicIndex, noteName } from "./theory.js";

const STEP = 5; // un demi-intervalle de portée, en px
const SLOT = 52; // largeur par note (gamme)
const EIGHTH = 30; // largeur d'une croche (phrase)
const LEFT = 64; // place pour la clé

// indice diatonique de la ligne du bas : Mi4 (clé de sol) / Sol2 (clé de fa)
const BOTTOM_LINE = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 };

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function frame(clef, ds, widthContent) {
  const bottom = BOTTOM_LINE[clef];
  const above = Math.max(0, Math.max(...ds) - (bottom + 8));
  const below = Math.max(0, bottom - Math.min(...ds));
  // place pour les hampes vers le haut / bas
  const top = 34 + above * STEP;
  const bottomY = top + 8 * STEP;
  const nameY = bottomY + below * STEP + 40;
  const width = LEFT + widthContent + 16;
  const height = nameY + 14;
  const y = (d) => bottomY - (d - bottom) * STEP;
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const ly = top + i * 2 * STEP;
    parts.push(`<line class="staff-line" x1="4" x2="${width - 4}" y1="${ly}" y2="${ly}"/>`);
  }
  parts.push(
    clef === "treble"
      ? `<text class="clef" x="10" y="${bottomY + 7}" font-size="${8 * STEP * 1.55}">𝄞</text>`
      : `<text class="clef" x="10" y="${top + 4 * STEP + 2}" font-size="${8 * STEP * 1.2}">𝄢</text>`,
  );
  return { bottom, top, bottomY, nameY, width, height, y, parts };
}

function ledgers(parts, f, x, d) {
  for (let k = f.bottom - 2; k >= d; k -= 2) {
    parts.push(`<line class="staff-line ledger" x1="${x - 11}" x2="${x + 11}" y1="${f.y(k)}" y2="${f.y(k)}"/>`);
  }
  for (let k = f.bottom + 10; k <= d; k += 2) {
    parts.push(`<line class="staff-line ledger" x1="${x - 11}" x2="${x + 11}" y1="${f.y(k)}" y2="${f.y(k)}"/>`);
  }
}

function labels(parts, n, x, f, style, hide = false) {
  if (n.acc !== 0) {
    const sym = noteName({ ...n, letter: 0 }, "en").slice(1);
    const ny = f.y(diatonicIndex(n));
    parts.push(`<text class="acc" x="${x - 12 - (Math.abs(n.acc) - 1) * 6}" y="${ny + 6}" text-anchor="end">${esc(sym)}</text>`);
  }
  if (hide) return;
  const cls = `note-name${n.tone ? " tone" : ""}${n.out ? " out" : ""}`;
  parts.push(`<text class="${cls}" x="${x}" y="${f.nameY}" text-anchor="middle">${esc(noteName(n, style))}</text>`);
}

const headClass = (n) => `head${n.tone ? " tone" : ""}${n.out ? " out" : ""}`;

const svgWrap = (f, label, parts) =>
  `<svg class="staff" viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;

/**
 * @param notes [{letter, acc, oct, tone?, out?, extra?}]
 * @param clef "treble" | "bass"
 * @param nameStyle "fr" | "en"
 */
export function staffSvg(notes, clef, nameStyle = "fr", opts = {}) {
  const ds = notes.map(diatonicIndex);
  const f = frame(clef, ds, notes.length * SLOT);
  const parts = f.parts;
  notes.forEach((n, i) => {
    const x = LEFT + i * SLOT + SLOT / 2;
    ledgers(parts, f, x, ds[i]);
    const ny = f.y(ds[i]);
    parts.push(`<ellipse class="${headClass(n)}" cx="${x}" cy="${ny}" rx="7" ry="5" transform="rotate(-18 ${x} ${ny})"/>`);
    labels(parts, n, x, f, nameStyle, opts.hideNames);
  });
  return svgWrap(f, opts.hideNames ? "Portée : une note à lire" : `Portée : ${notes.map((n) => noteName(n, nameStyle)).join(", ")}`, parts);
}

/**
 * Une mesure de 4/4.
 * @param events [{note|null, start, len, tone?, out?, extra?}] (en croches)
 */
export function phraseSvg(events, clef, nameStyle = "fr") {
  const notes = events.filter((e) => e.note);
  const ds = notes.map((e) => diatonicIndex(e.note));
  const f = frame(clef, ds.length ? ds : [BOTTOM_LINE[clef]], 8 * EIGHTH + 10);
  const parts = f.parts;
  const middle = f.bottom + 4;
  const xOf = (e) => LEFT + e.start * EIGHTH + 12;

  // direction des hampes : groupées par temps pour les croches liées
  const dirOf = (d) => (d >= middle ? "down" : "up");
  const stemLen = 6.5 * STEP;
  const placed = events.map((e) => ({ e, x: xOf(e), d: e.note ? diatonicIndex(e.note) : null }));

  // groupes de croches liées : deux croches consécutives sur un même temps
  const beamed = new Set();
  const pairs = [];
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i];
    const b = placed[i + 1];
    if (a.e.note && b.e.note && a.e.len === 1 && b.e.len === 1 && a.e.start % 2 === 0 && b.e.start === a.e.start + 1) {
      pairs.push([a, b]);
      beamed.add(a);
      beamed.add(b);
    }
  }
  const pairDir = new Map();
  for (const [a, b] of pairs) {
    const far = Math.abs(a.d - middle) >= Math.abs(b.d - middle) ? a.d : b.d;
    const dir = dirOf(far);
    pairDir.set(a, dir);
    pairDir.set(b, dir);
  }

  for (const p of placed) {
    const { e, x, d } = p;
    if (!e.note) {
      const rest = e.len === 1 ? "𝄾" : "𝄽";
      parts.push(`<text class="rest" x="${x - 6}" y="${f.y(middle) + 9}" font-size="30">${rest}${e.len === 3 ? "·" : ""}</text>`);
      continue;
    }
    ledgers(parts, f, x, d);
    const ny = f.y(d);
    parts.push(`<ellipse class="${headClass(e)}" cx="${x}" cy="${ny}" rx="7" ry="5" transform="rotate(-18 ${x} ${ny})"/>`);
    if (e.len === 3) parts.push(`<circle class="dotmark" cx="${x + 12}" cy="${ny - (d % 2 === 0 ? 3 : 0)}" r="1.8"/>`);
    labels(parts, { ...e.note, tone: e.tone, out: e.out }, x, f, nameStyle);
  }

  // hampes, barres et crochets
  for (const p of placed) {
    if (!p.e.note) continue;
    const dir = pairDir.get(p) ?? dirOf(p.d);
    p.dir = dir;
    p.sx = dir === "up" ? p.x + 6.5 : p.x - 6.5;
    p.y0 = f.y(p.d);
    p.tip = dir === "up" ? p.y0 - stemLen : p.y0 + stemLen;
  }
  for (const [a, b] of pairs) {
    // les deux hampes s'arrêtent à la même hauteur (barre horizontale)
    const tip = a.dir === "up" ? Math.min(a.tip, b.tip) : Math.max(a.tip, b.tip);
    a.tip = b.tip = tip;
    const t = a.dir === "up" ? 0 : -4;
    parts.push(`<rect class="beam" x="${Math.min(a.sx, b.sx)}" y="${tip + t}" width="${Math.abs(b.sx - a.sx)}" height="4"/>`);
  }
  for (const p of placed) {
    if (!p.e.note) continue;
    parts.push(`<line class="stem" x1="${p.sx}" x2="${p.sx}" y1="${p.y0}" y2="${p.tip}"/>`);
    if (p.e.len === 1 && !beamed.has(p)) {
      const s = p.dir === "up" ? 1 : -1;
      parts.push(`<path class="flag" d="M ${p.sx} ${p.tip} q ${9} ${s * 6} ${5} ${s * 17}"/>`);
    }
  }
  // barre de mesure finale
  const bx = LEFT + 8 * EIGHTH + 8;
  parts.push(`<line class="staff-line" x1="${bx}" x2="${bx}" y1="${f.top}" y2="${f.bottomY}" stroke-width="2"/>`);

  return svgWrap(
    f,
    `Phrase : ${events.map((e) => (e.note ? noteName(e.note, nameStyle) : "silence")).join(", ")}`,
    parts,
  );
}
