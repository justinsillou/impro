import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChord, normalizeSuffix, parseChordText, tpcName } from "../js/import.js";
import { analyseChord, instrumentById, noteName, spellRoot } from "../js/theory.js";
import { PRESETS, presetToBars } from "../js/presets.js";

test("suffixes : variantes courantes ramenées aux 10 types", () => {
  const cases = { "": "", maj: "", "-7": "m7", "Δ7": "maj7", ma7: "maj7", "ø": "m7b5", "m7(b5)": "m7b5", 9: "7", 13: "7", "7b9": "7b9", "7(b9)": "7b9", "°7": "dim7", 6: "6", m6: "m6", sus4: "", min: "m", "m9": "m7", "maj7/E": "maj7" };
  for (const [raw, want] of Object.entries(cases)) assert.equal(normalizeSuffix(raw), want, `suffixe « ${raw} »`);
});

test("accords : basse ignorée, noms français, ♭/♯", () => {
  assert.equal(normalizeChord("Cmaj7/E"), "Cmaj7");
  assert.equal(normalizeChord("Sib-7"), "Sibm7");
  assert.equal(normalizeChord("B♭m7♭5"), "Bbm7b5");
  assert.equal(normalizeChord("H7"), null);
});

test("texte : mesures par | ou lignes, % gardé, inconnus comptés", () => {
  const r = parseChordText("Dm7 G7 | Cmaj7 | % ?? \nAm7/G D7 || Gmaj7");
  assert.deepEqual(r.bars, ["Dm7 G7", "Cmaj7", "%", "Am7 D7", "Gmaj7"]);
  assert.equal(r.skipped, 1);
});

test("MuseScore : numéros tpc", () => {
  assert.equal(tpcName(14), "C");
  assert.equal(tpcName(12), "Bb");
  assert.equal(tpcName(20), "F#");
  assert.equal(tpcName(10), "Ab");
  assert.equal(tpcName(13), "F");
  assert.equal(tpcName(19), "B");
  assert.equal(tpcName(99), null);
});

test("dièses / bémols : choix imposé et altération tapée respectée", () => {
  assert.equal(noteName(spellRoot(1, "7", "sharp")), "Do♯");
  assert.equal(noteName(spellRoot(1, "7", "flat")), "Ré♭");
  assert.equal(noteName(spellRoot(1, "m7"), "fr"), "Do♯"); // auto : mineur → ♯
  const inst = instrumentById("c");
  assert.equal(analyseChord("C#7", inst).concertRoot.acc, 1);
  assert.equal(analyseChord("Db7", inst).concertRoot.acc, -1);
  assert.equal(analyseChord("Gb7", inst).concertRoot.acc, -1); // plus de Fa♯ forcé
  assert.equal(analyseChord("Db7", inst, "sharp").concertRoot.acc, 1);
});

test("grilles types : en Fa♯ avec dièses, en Sol♭ avec bémols ; feuilles mortes = 32 mesures", () => {
  const blues = PRESETS.find((p) => p.id === "blues");
  assert.deepEqual(presetToBars(blues, 6, "sharp").slice(0, 1), ["F#7"]);
  assert.deepEqual(presetToBars(blues, 6, "flat").slice(0, 1), ["Gb7"]);
  for (const id of ["autumn-leaves", "rhythm-changes"]) assert.equal(PRESETS.find((p) => p.id === id).bars.length, 32);
  assert.deepEqual(presetToBars(PRESETS.find((p) => p.id === "autumn-leaves"), 10, "flat").slice(0, 8), ["Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7b9", "Gm", "Gm"]);
});
