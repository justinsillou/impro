import test from "node:test";
import assert from "node:assert/strict";
import { analyseParts, chordCandidates, guessBars, rhythmFromNotes, scaleCoverage, styleFromAnalysis } from "../js/analysis.js";
import { generatePhrase, makeNote, midiOf, instrumentById } from "../js/theory.js";

const line = (name, ms, step = 0.5, d = 0.5) => ({ name, notes: ms.map((m, i) => ({ m, t: i * step, d })) });

test("analyse : rôles et tendances (mélodie conjointe vs basse en sauts)", () => {
  const melody = line("Trompette", [72, 74, 76, 77, 79, 77, 76, 74, 72, 74, 76, 77, 79, 81, 79, 77]);
  const bass = line("Tuba", [36, 43, 36, 43, 38, 45, 38, 45], 2, 2);
  const [m, b] = analyseParts([melody, bass], 4);
  assert.equal(m.role, "Mélodie");
  assert.equal(b.role, "Basse");
  assert.ok(m.step > 0.8 && m.short === 1 && m.density > b.density);
  assert.ok(b.leap > 0.5 && b.long === 1);
  assert.ok(m.vsPiece > 1 && b.vsPiece < 1);
  assert.match(m.text, /conjoints/);
});

test("style : phrase plus dense et conjointe pour un modèle rapide", () => {
  const [a] = analyseParts([line("Flûte", [72, 74, 76, 77, 79, 77, 76, 74])], 1);
  const st = styleFromAnalysis(a, [60, 90]);
  assert.ok(st.eighths > 0.9 && st.step > 0.8 && st.center >= 60 && st.center <= 90);
});

test("phrase avec style : reste dans la tessiture, respecte le rythme imposé", () => {
  const inst = instrumentById("bb");
  const root = makeNote(0, 0, 4);
  const rhythm = [{ len: 2, rest: false }, { len: 1, rest: true }, { len: 1, rest: false }, { len: 4, rest: true }];
  const ph = generatePhrase(root, "mixolydian", ["1", "3", "5", "b7"], Math.random, inst.range, { rhythm, center: 75, eighths: 1, off: 0 });
  assert.deepEqual(ph.map((e) => [e.start, e.len, e.note === null]), [[0, 2, false], [2, 1, true], [3, 1, false], [4, 4, true]]);
  for (const e of ph) if (e.note) assert.ok(midiOf(e.note) >= inst.range[0] && midiOf(e.note) <= inst.range[1]);
  // la hauteur visée déplace la phrase d'octave
  const high = generatePhrase(root, "mixolydian", ["1", "3", "5", "b7"], () => 0.5, [0, 127], { center: 84 });
  const low = generatePhrase(root, "mixolydian", ["1", "3", "5", "b7"], () => 0.5, [0, 127], { center: 48 });
  const avg = (p) => p.filter((e) => e.note).reduce((s, e) => s + midiOf(e.note), 0) / p.filter((e) => e.note).length;
  assert.ok(avg(high) > avg(low) + 12);
});

test("rythme repris d'une mesure : somme = 8 croches, silences comblés", () => {
  const notes = [{ m: 60, t: 0, d: 1 }, { m: 62, t: 1.5, d: 0.5 }, { m: 64, t: 3, d: 1 }];
  const r = rhythmFromNotes(notes, 0);
  assert.equal(r.reduce((s, x) => s + x.len, 0), 8);
  assert.equal(r[0].rest, false);
  assert.equal(rhythmFromNotes([{ m: 60, t: 0, d: 4 }], 0), null);
});

test("couverture d'une gamme par la mélodie (pondérée par la durée)", () => {
  // Do mixolydien : do ré mi fa sol la sib ; le si naturel est dehors
  const notes = [{ m: 60, t: 0, d: 1 }, { m: 64, t: 1, d: 1 }, { m: 71, t: 2, d: 1 }, { m: 67, t: 3, d: 1 }];
  const mixo = scaleCoverage(0, ["1", "2", "3", "4", "5", "6", "b7"], notes);
  const ion = scaleCoverage(0, ["1", "2", "3", "4", "5", "6", "7"], notes);
  assert.equal(mixo, 0.75);
  assert.equal(ion, 1);
});

test("accords déduits : dominante, mineur 7, split de mesure", () => {
  const n = (m, t, d = 1) => ({ m, t, d });
  // G7 : sol grave + si ré fa
  const [g7] = chordCandidates([n(43, 0, 2), n(59, 0), n(62, 1), n(65, 2), n(67, 3)]);
  assert.equal(g7.name, "G7");
  // Dm7
  const [dm7] = chordCandidates([n(38, 0, 2), n(62, 0), n(65, 1), n(69, 2), n(72, 3)]);
  assert.equal(dm7.name, "Dm7");
  // bémols par défaut, dièses si demandé
  assert.equal(chordCandidates([n(46, 0, 4), n(62, 0), n(65, 1), n(70, 2)], "flat")[0].name, "Bb");
  const part = { name: "x", notes: [n(38, 0, 2), n(62, 0), n(65, 1), n(43, 2, 2), n(59, 2), n(62, 3), n(65, 3.5, 0.5)] };
  assert.deepEqual(guessBars([part], 2), ["Dm G7", ""]);
});

test("guessBars : une section démarre à la mesure `start` du morceau", () => {
  const n = (t, m) => ({ t, m, d: 1 });
  // mesure 0 : Do majeur ; mesure 2 : Sol majeur
  const part = { name: "x", notes: [n(0, 60), n(1, 64), n(2, 67), n(3, 60), n(8, 67), n(9, 71), n(10, 74), n(11, 67)] };
  assert.equal(guessBars([part], 1, undefined, 2)[0], "G");
  assert.equal(guessBars([part], 1)[0], "C");
});
