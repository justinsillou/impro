/**
 * Grilles classiques, écrites en DEGRÉS (chiffres romains) et non en notes :
 * [demi-tons au-dessus de la tonique, type d'accord].
 * On les « plaque » ensuite dans la tonalité de son choix.
 * Chaque mesure est une liste d'accords (1, 2 ou 4 accords par mesure).
 */
import { spellRoot, QUALITIES, LETTERS } from "./theory.js";

const I = (q = "") => [0, q];
const II = (q = "m7") => [2, q];
const III = (q = "m7") => [4, q];
const IV = (q = "") => [5, q];
const V = (q = "7") => [7, q];
const VI = (q = "m7") => [9, q];
const VII = (q = "m7b5") => [11, q];

export const PRESETS = [
  {
    id: "blues",
    name: "Blues en 12 mesures",
    info: "La grille de base : I7 – IV7 – V7. Une seule gamme (blues ou pentatonique mineure) marche presque partout.",
    bars: [
      [I("7")], [I("7")], [I("7")], [I("7")],
      [IV("7")], [IV("7")], [I("7")], [I("7")],
      [V("7")], [IV("7")], [I("7")], [I("7")],
    ],
  },
  {
    id: "blues-jazz",
    name: "Blues jazz (avec II–V)",
    info: "Même forme, mais avec un VI7 qui prépare le II–V final : plus d'accords, donc plus de gammes à changer.",
    bars: [
      [I("7")], [IV("7")], [I("7")], [I("7")],
      [IV("7")], [IV("7")], [I("7")], [VI("7")],
      [II()], [V()], [I("7"), VI("7")], [II(), V()],
    ],
  },
  {
    id: "ii-v-i",
    name: "II–V–I majeur",
    info: "Le mouvement de base du jazz : Dorien sur le II, Mixolydien sur le V, Ionien sur le I.",
    bars: [[II()], [V()], [I("maj7")], [I("maj7")]],
  },
  {
    id: "ii-v-i-minor",
    name: "II–V–I mineur",
    info: "Le II est demi-diminué (Locrien), le V a un ♭9 (phrygien dominant), le I est mineur.",
    bars: [[II("m7b5")], [V("7b9")], [I("m6")], [I("m6")]],
  },
  {
    id: "fourths",
    name: "Cycle de quartes (style « Les feuilles mortes »)",
    info: "II–V–I puis IV–VII–III–VI : chaque racine descend d'une quinte. Une succession de II–V à enchaîner.",
    bars: [
      [II()], [V()], [I("maj7")], [IV("maj7")],
      [VII()], [III("7b9")], [VI()], [VI()],
    ],
  },
  {
    id: "anatole",
    name: "Anatole (I–VI–II–V)",
    info: "La boucle qui sert de base à des centaines de standards. 4 mesures, à répéter.",
    bars: [[I("maj7")], [VI()], [II()], [V()]],
  },
  {
    id: "canon",
    name: "Canon (I–V–VI–III–IV–I–IV–V)",
    info: "Que des accords simples : idéal pour débuter avec la gamme majeure ou la pentatonique majeure.",
    bars: [
      [I()], [V("")], [VI("m")], [III("m")],
      [IV()], [I()], [IV()], [V("")],
    ],
  },
];

/** Transpose un preset dans une tonalité (pc de la tonique) -> liste de mesures en texte. */
export function presetToBars(preset, tonicPc) {
  return preset.bars.map((chords) =>
    chords
      .map(([semis, quality]) => {
        const root = spellRoot((tonicPc + semis) % 12, quality);
        const acc = root.acc === 1 ? "#" : root.acc === -1 ? "b" : "";
        return LETTERS[root.letter] + acc + QUALITIES[quality].symbol.replace("♭", "b");
      })
      .join(" "),
  );
}
