/**
 * Dessin d'une portée en SVG : une suite de notes (têtes seulement, sans
 * hampes ni rythme) avec clé, altérations, lignes supplémentaires et noms.
 */
import { diatonicIndex, noteName } from "./theory.js";

const STEP = 5; // un demi-intervalle de portée, en px
const SLOT = 52; // largeur par note
const LEFT = 64; // place pour la clé

// indice diatonique de la ligne du bas : Mi4 (clé de sol) / Sol2 (clé de fa)
const BOTTOM_LINE = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 };

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * @param notes [{letter, acc, oct, tone?: boolean}]
 * @param clef "treble" | "bass"
 * @param nameStyle "fr" | "en"
 */
export function staffSvg(notes, clef, nameStyle = "fr") {
  const bottom = BOTTOM_LINE[clef];
  const ds = notes.map(diatonicIndex);
  const above = Math.max(0, Math.max(...ds) - (bottom + 8));
  const below = Math.max(0, bottom - Math.min(...ds));
  const top = 24 + above * STEP; // y de la ligne du haut
  const bottomY = top + 8 * STEP; // y de la ligne du bas
  const nameY = bottomY + below * STEP + 34;
  const width = LEFT + notes.length * SLOT + 12;
  const height = nameY + 14;
  const y = (d) => bottomY - (d - bottom) * STEP;

  const parts = [];
  // 5 lignes
  for (let i = 0; i < 5; i++) {
    const ly = top + i * 2 * STEP;
    parts.push(`<line class="staff-line" x1="4" x2="${width - 4}" y1="${ly}" y2="${ly}"/>`);
  }
  // clé
  parts.push(
    clef === "treble"
      ? `<text class="clef" x="10" y="${bottomY + 7}" font-size="${8 * STEP * 1.55}">𝄞</text>`
      : `<text class="clef" x="10" y="${top + 4 * STEP + 2}" font-size="${8 * STEP * 1.2}">𝄢</text>`,
  );

  notes.forEach((n, i) => {
    const x = LEFT + i * SLOT + SLOT / 2;
    const d = ds[i];
    const ny = y(d);
    // lignes supplémentaires
    for (let k = bottom - 2; k >= d; k -= 2) {
      parts.push(`<line class="staff-line ledger" x1="${x - 11}" x2="${x + 11}" y1="${y(k)}" y2="${y(k)}"/>`);
    }
    for (let k = bottom + 10; k <= d; k += 2) {
      parts.push(`<line class="staff-line ledger" x1="${x - 11}" x2="${x + 11}" y1="${y(k)}" y2="${y(k)}"/>`);
    }
    const cls = n.tone ? "head tone" : "head";
    parts.push(`<ellipse class="${cls}" cx="${x}" cy="${ny}" rx="7" ry="5" transform="rotate(-18 ${x} ${ny})"/>`);
    if (n.acc !== 0) {
      const sym = noteName({ ...n, letter: 0 }, "en").slice(1);
      parts.push(`<text class="acc" x="${x - 12 - (Math.abs(n.acc) - 1) * 6}" y="${ny + 6}" text-anchor="end">${esc(sym)}</text>`);
    }
    parts.push(
      `<text class="note-name${n.tone ? " tone" : ""}" x="${x}" y="${nameY}" text-anchor="middle">${esc(noteName(n, nameStyle))}</text>`,
    );
  });

  return `<svg class="staff" viewBox="0 0 ${width} ${height}" width="${width}" role="img" aria-label="Portée : ${esc(
    notes.map((n) => noteName(n, nameStyle)).join(", "),
  )}">${parts.join("")}</svg>`;
}
