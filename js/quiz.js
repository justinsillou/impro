/**
 * Mode test : questions de théorie (quiz) et notation d'une improvisation
 * jouée au clavier MIDI. Fonctions pures, testées avec `node --test`.
 */
import {
  QUALITIES, ROOT_CHOICES, SCALES, analyseChord, chordSymbol, degreeSemis, midiOf,
  noteFromMidi, noteName, parseChord, spellRoot,
} from "./theory.js";

export const QUIZ_TYPES = [
  { id: "mix", label: "Un peu de tout" },
  { id: "chord-written", label: "Transposition : quel accord je lis ?" },
  { id: "tone-concert", label: "Notes d'un accord (son réel)" },
  { id: "read-concert", label: "Lecture : quel son est-ce ?" },
  { id: "scale-name", label: "Quelle gamme sur cet accord ?" },
];

const QUALITY_POOL = ["", "m", "7", "maj7", "m7", "m7b5", "7b9"];
const TONE_LABEL = { 3: "tierce", 5: "quinte", 7: "septième", b3: "tierce", b5: "quinte", b7: "septième", bb7: "septième", 6: "sixte" };

const shuffle = (arr, rng) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function randomChord(rng, qualities = QUALITY_POOL) {
  const root = pick(ROOT_CHOICES, rng);
  const quality = pick(qualities, rng);
  const sym = root + QUALITIES[quality].symbol.replace("♭", "b");
  return { text: sym, parsed: parseChord(sym), quality };
}

/**
 * Une question. Forme :
 *  { type, prompt, staff?: {notes, clef}, input: "choice" | "pc",
 *    choices?: [{label, value}], answer: string | number (pc), explain }
 */
export function makeQuestion(type, inst, rng = Math.random, names = "fr") {
  if (type === "mix") type = pick(["chord-written", "tone-concert", "read-concert", "scale-name"], rng);
  const sym = (root, q) => chordSymbol(root, q, names);

  if (type === "chord-written") {
    if (inst.semis === 0) return makeQuestion("tone-concert", inst, rng, names);
    const c = randomChord(rng);
    const a = analyseChord(c.text, inst);
    const correct = sym(a.writtenRoot, c.quality);
    const wrong = new Set();
    // pièges classiques : ne pas transposer, se tromper d'un demi-ton ou d'un ton
    for (const delta of shuffle([0, 1, -1, 2, -2, 5, 7], rng)) {
      if (wrong.size >= 3) break;
      const root = spellRoot(midiOf(a.writtenRoot) + delta, c.quality);
      const label = sym(root, c.quality);
      if (label !== correct) wrong.add(label);
    }
    return {
      type,
      prompt: `Le groupe joue ${sym(a.concertRoot, c.quality)} (sons réels). Quel accord lis-tu sur ta partition ?`,
      input: "choice",
      choices: shuffle([correct, ...wrong], rng).map((l) => ({ label: l, value: l })),
      answer: correct,
      explain: `Ta partition est ${inst.semis} demi-tons plus haut que le son réel : ${sym(a.concertRoot, c.quality)} s'écrit ${correct}.`,
    };
  }

  if (type === "tone-concert") {
    const c = randomChord(rng, ["m7", "7", "maj7", "m7b5", "m", ""]);
    const a = analyseChord(c.text, inst);
    const idx = 1 + Math.floor(rng() * (a.toneDegrees.length - 1)); // pas la fondamentale
    const deg = a.toneDegrees[idx];
    const pc = (c.parsed.pc + degreeSemis(deg)) % 12;
    return {
      type,
      prompt: `Quelle est la ${TONE_LABEL[deg] ?? "note"} de ${sym(a.concertRoot, c.quality)} ? (son réel — joue-la au clavier ou clique)`,
      input: "pc",
      answer: pc,
      explain: `La ${TONE_LABEL[deg]} de ${sym(a.concertRoot, c.quality)} est ${noteLabel(pc, names)}.`,
    };
  }

  if (type === "read-concert") {
    const mid = inst.low + Math.floor(rng() * 12);
    const written = noteFromMidi(mid + (rng() < 0.3 ? 12 : 0));
    const soundingPc = (((midiOf(written) - inst.semis) % 12) + 12) % 12;
    return {
      type,
      prompt: "Voici une note écrite sur ta partition. Quel son réel produit-elle ? (joue-le au clavier ou clique)",
      staff: { notes: [written], clef: inst.clef },
      input: "pc",
      answer: soundingPc,
      explain: `Écrite ${noteName(written, names)}, elle sonne ${noteLabel(soundingPc, names)}.`,
    };
  }

  // scale-name
  const c = randomChord(rng, ["m7", "7", "maj7", "m7b5", "7b9", "dim7"]);
  const a = analyseChord(c.text, inst);
  const short = (id) => SCALES[id].name.split(" (")[0];
  const correct = short(a.scales[0].id);
  const mine = new Set(a.scales.map((s) => short(s.id)));
  const others = shuffle(Object.keys(SCALES).map(short), rng).filter((n) => !mine.has(n));
  const uniq = [...new Set(others)].slice(0, 3);
  return {
    type,
    prompt: `Quelle gamme est la plus naturelle sur ${sym(a.concertRoot, c.quality)} ?`,
    input: "choice",
    choices: shuffle([correct, ...uniq], rng).map((l) => ({ label: l, value: l })),
    answer: correct,
    explain: `${correct} : ${a.scales[0].plain}`,
  };
}

const PC_FR = ["Do", "Do♯/Ré♭", "Ré", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "La♭", "La", "Si♭", "Si"];
const PC_EN = ["C", "C♯/D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const noteLabel = (pc, names) => (names === "fr" ? PC_FR : PC_EN)[((pc % 12) + 12) % 12];

export function checkAnswer(q, given) {
  return q.input === "pc" ? ((given % 12) + 12) % 12 === q.answer : given === q.answer;
}

/* ------------------------------------------------- notation d'improvisation */

/**
 * Note une improvisation.
 * @param played  [{beat, midi}] : position en temps (fractionnaire) et hauteur RÉELLE
 * @param beatInfo  par temps de la grille : { tones: Set<pc>, scale: Set<pc> } ou null
 * Un temps « fort » = note posée à ±0,2 temps d'un temps entier.
 */
export function scoreImprov(played, beatInfo) {
  const stats = { total: 0, chord: 0, scale: 0, out: 0, strong: 0, strongChord: 0, points: 0, outList: [] };
  for (const n of played) {
    const nearest = Math.round(n.beat);
    const strong = Math.abs(n.beat - nearest) <= 0.2;
    const idx = Math.floor(n.beat + 0.2);
    const info = beatInfo[((idx % beatInfo.length) + beatInfo.length) % beatInfo.length];
    if (!info) continue;
    const pc = ((n.midi % 12) + 12) % 12;
    stats.total++;
    const isChord = info.tones.has(pc);
    const isScale = info.scale.has(pc);
    if (isChord) {
      stats.chord++;
      stats.points += 1;
    } else if (isScale) {
      stats.scale++;
      stats.points += 0.7;
    } else {
      stats.out++;
      stats.outList.push({ beat: n.beat, midi: n.midi, bar: Math.floor(idx / 4) + 1 });
    }
    if (strong) {
      stats.strong++;
      if (isChord) stats.strongChord++;
    }
  }
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  return {
    ...stats,
    inScalePct: pct(stats.chord + stats.scale, stats.total),
    strongChordPct: pct(stats.strongChord, stats.strong),
    scorePct: pct(stats.points, stats.total),
  };
}
