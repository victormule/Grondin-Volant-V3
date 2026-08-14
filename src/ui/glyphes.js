// Layer-kind marks.
//
// A layer's kind has to be readable at a glance, in a list of twenty rows, at
// eleven pixels tall. The Unicode characters we used for it (◍ ◉ ⬢ ↔) do not
// survive that size: ◍ and ◉ are the same pierced disc, ⬢ collapses into a
// blob, and their weight depends on whichever font the machine happens to
// have. Worse, they were drawn in white on the layer's own colour, so on a
// pale yellow they simply vanished.
//
// What reads at that size is the SILHOUETTE. Each kind gets a shape of its
// own, and the shapes are chosen to differ in more than one way at once —
// solid vs hollow, round vs pointed vs elongated — so that they stay apart in
// peripheral vision and for a colour-blind reader:
//
//   peinture     a dab, solid, with the soft halo the brush actually leaves
//   région       a hollow hexagon — the mesh faces it is a set of
//   annotation   a pin, pointed, the one shape that says « here, precisely »
//   mesure       a span between two end caps, wide and flat
//   groupe       a folder
//
// The ink is chosen against the plate's luminance rather than always being
// white, so the mark holds up on every colour of the palette.

import { genresDuCalque, TYPES_CALQUE } from '../document/modele.js';

// Each shape lives in a 16×16 box. `remplir` is the fill alpha, `epaisseur`
// the stroke width; a shape may have both.
const SILHOUETTES = {
  trace: {
    libelle: 'Peinture',
    formes: [
      // The falloff halo, then the hard core: a brush dab, drawn as the tool
      // actually lays it down. The halo has to stay legible at seventeen
      // pixels, where a faint ring is simply not there.
      { d: 'M8 2.1a5.9 5.9 0 1 1 0 11.8 5.9 5.9 0 0 1 0-11.8z', remplir: 0.46 },
      { d: 'M8 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z', remplir: 1 },
    ],
  },
  region: {
    libelle: 'Région',
    formes: [
      { d: 'M8 2.1l5.1 2.95v5.9L8 13.9l-5.1-2.95v-5.9z', remplir: 0.3, epaisseur: 1.8 },
    ],
  },
  epingle: {
    libelle: 'Annotation',
    formes: [
      {
        d: 'M8 1.5c-2.5 0-4.5 2-4.5 4.5 0 3.4 4.5 8.6 4.5 8.6s4.5-5.2 4.5-8.6'
          + 'c0-2.5-2-4.5-4.5-4.5zM8 4.1a1.95 1.95 0 1 0 0 3.9 1.95 1.95 0 0 0 0-3.9z',
        remplir: 1,
        pair: true,
      },
    ],
  },
  mesure: {
    libelle: 'Mesure',
    formes: [
      // A span, arrowed at both ends. Drawn first as two end caps and a rule
      // between them, which at this size read as a capital H and nothing else.
      // Solid arrowheads keep their point where thin chevrons would blur.
      { d: 'M2.2 8l3.4-2.6v1.75h4.8V5.4L13.8 8l-3.4 2.6V8.85H5.6v1.75z', remplir: 1 },
    ],
  },
  groupe: {
    libelle: 'Groupe',
    formes: [
      {
        d: 'M2.5 4.6c0-.8.6-1.45 1.4-1.45h2.9c.45 0 .87.2 1.14.55l.83 1.05h3.53'
          + 'c.8 0 1.45.65 1.45 1.45v5.75c0 .8-.65 1.45-1.45 1.45H3.95'
          + 'c-.8 0-1.45-.65-1.45-1.45z',
        remplir: 1,
      },
    ],
  },
};

// Which silhouette a layer wears. Same rule as `typeAffiche`: content answers
// first, the declared type only speaks for a layer nothing has been drawn in.
export function cleSilhouette(calque) {
  if (!calque) return 'trace';
  if (calque.enfants || calque.type === 'groupe') return 'groupe';
  const genres = genresDuCalque(calque);
  if (genres.length > 0 && SILHOUETTES[genres[0]]) return genres[0];
  const genre = TYPES_CALQUE[calque.type]?.genre;
  return SILHOUETTES[genre] ? genre : 'epingle';
}

export function libelleSilhouette(cle) {
  return SILHOUETTES[cle]?.libelle ?? 'Calque';
}

// The ink is white. Always.
//
// It used to flip to dark ink on pale plates, for contrast. That was worse than
// the problem it solved: scanning a column of layers, the same brush mark read
// white on blue and black on yellow, and the eye takes a colour change for a
// meaning change. A mark that is slightly hard to read is a small cost; a mark
// that looks like a different mark is a wrong one. Legibility on pale plates is
// bought back in CSS instead, with a hairline shadow under the shape.
export const ENCRE = '#fff';

// The SVG body of a mark, in `encre`. No <svg> wrapper: the caller owns the
// element so it can size and place it.
export function tracesSilhouette(cle, encre = 'currentColor') {
  const silhouette = SILHOUETTES[cle] ?? SILHOUETTES.trace;
  return silhouette.formes.map(({ d, remplir, epaisseur, pair }) => {
    const attributs = [`d="${d}"`];
    attributs.push(remplir ? `fill="${encre}"` : 'fill="none"');
    if (remplir && remplir < 1) attributs.push(`fill-opacity="${remplir}"`);
    if (pair) attributs.push('fill-rule="evenodd"');
    if (epaisseur) {
      attributs.push(`stroke="${encre}"`, `stroke-width="${epaisseur}"`,
        'stroke-linecap="round"', 'stroke-linejoin="round"');
    }
    return `<path ${attributs.join(' ')}/>`;
  }).join('');
}

// A layer's chip: the colour as a plate, the kind as a mark on top of it.
//
// The plate keeps the colour at full strength — it has to match the paint on
// the specimen — and a hairline border keeps a white layer from disappearing
// into a white panel, the way a swatch does in any drawing tool.
export function marquerPastille(hote, calque) {
  const cle = cleSilhouette(calque);
  hote.dataset.genre = cle;
  hote.style.background = calque?.couleur ?? '#888';
  hote.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">`
    + `${tracesSilhouette(cle, ENCRE)}</svg>`;
  return hote;
}
