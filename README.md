# Grille d'impro

Construis une grille d'accords, vois pour chaque accord les notes et les gammes à jouer, **écrites pour ton instrument** (Sib, Mib, Fa, clé de fa…), et écoute-la avec une basse et un métronome.

Mini projet lié à l'article de blog *Improviser sur une grille : gammes, transposition et un saxhorn basse en Sib*.

- Démo : https://justinsillou.github.io/impro/
- JavaScript pur (modules ES), **aucune dépendance, aucune étape de build**.

## Lancer en local

```bash
python -m http.server 5173
# puis ouvrir http://localhost:5173/
```

## Tests

```bash
node --test
```

Les tests couvrent la théorie (orthographe des notes, transposition, gammes, analyse d'accords) dans `test/theory.test.mjs`.

## Structure

| Fichier | Rôle |
|---|---|
| `js/theory.js` | Notes, degrés, gammes, accords, instruments transpositeurs, génération de phrase. Pur, testé. |
| `js/presets.js` | Grilles types écrites en degrés (blues, II–V–I, Anatole…), plaquées dans la tonalité choisie. |
| `js/staff.js` | Portée en SVG (clés de sol et de fa, altérations, lignes supplémentaires). |
| `js/audio.js` | Moteur Web Audio : accords, basse, métronome, boucle. |
| `js/app.js` | Interface et état (sauvegardé dans le navigateur et dans le lien). |

## Choix et limites

- Les accords se tapent en **sons réels** ; l'accord et les gammes sont affichés **tels qu'ils s'écrivent** pour l'instrument choisi.
- `semis` (dans `INSTRUMENTS`) = nombre de demi-tons dont la note écrite est plus haute que le son réel (Sib : 2, Mib : 9, Fa : 7, Sib grave en clé de sol : 14).
- Le saxhorn basse en Sib se lit selon les orchestres en clé de sol (transposé) ou en clé de fa (non transposé) : les deux sont proposés.
- La correspondance accord → gamme est une simplification pédagogique, pas une règle.
- 4/4 uniquement ; accords : majeur, m, 7, maj7, m7, m7♭5, dim7, 7♭9, 6, m6.

## Publier sur GitHub Pages

Réglages du dépôt → Pages → *Deploy from a branch* → `main` / racine. Le site est alors servi sur `https://justinsillou.github.io/impro/`.

## Sources musicales

Les gammes et correspondances accord-gamme suivent les usages courants du jazz (voir les sources de l'article : Wikipédia sur les modes, la pentatonique, la gamme blues, les instruments transpositeurs, le *chord-scale system*).
