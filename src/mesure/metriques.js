// What a layer measures, and how to write it down.
//
// Two routes to the same quantities, chosen by what the layer actually is:
//
//   • a region is a set of triangles → exact sums over the mesh;
//   • paint is coverage in an atlas   → integration of that coverage.
//
// The two are deliberately kept side by side rather than unified: measuring a
// region both ways is how the raster method gets checked. On this specimen the
// two agree to within about a percent, which is what makes the number reported
// for a brush stroke worth printing.

import { aireFaces, perimetreFaces, volumePatch, volumeModele, aireModele }
  from './geometrie.js';
import { MesureRaster } from './rasterisation.js';

export class Metrologie {
  constructor(renderer, config, { atlas, regions }) {
    this.config = config;
    this.atlas = atlas;
    this.regions = regions;
    this.raster = new MesureRaster(renderer, config, atlas.taille);
    this.cache = new Map();
    // Learned from the first region measured both ways; until then, the
    // calibration recorded in the settings.
    this.incertitudeRelative = null;
  }

  // The specimen's own figures are kept: they depend on the mesh, which no
  // edit to the document can change.
  invalider(idCalque = null) {
    const prefixe = idCalque ? `${idCalque}:` : '';
    for (const cle of [...this.cache.keys()]) {
      if (cle.startsWith('__specimen:')) continue;
      if (cle.startsWith(prefixe)) this.cache.delete(cle);
    }
  }

  // Cheap fingerprint of everything that changes a measurement. Colour,
  // opacity and visibility are not in it on purpose: they change what you see,
  // never how much of it there is.
  _signature(calque) {
    let n = 0;
    for (const element of calque.donnees?.elements ?? []) {
      n += element.faces?.length ?? element.empreintes?.length ?? element.points?.length ?? 0;
    }
    return `${calque.donnees?.elements.length ?? 0}/${n}`;
  }

  mesurer(calque, capture) {
    if (!capture || !calque?.donnees) return null;
    const cle = `${calque.id}:${capture.cle}:${this._signature(calque)}`;
    const memoire = this.cache.get(cle);
    if (memoire) return memoire;

    const resultat = calque.type === 'region'
      ? this._region(calque, capture)
      : this._peinture(calque, capture);

    if (resultat) {
      this.apprendreIncertitude(resultat);
      this.cache.set(cle, resultat);
    }
    return resultat;
  }

  facesDepuisPeinture(calque, capture) {
    if (!capture || calque?.type !== 'peinture') return new Set();
    const entree = this.regions.capture(capture.cle);
    if (!entree) return new Set();
    return this.raster.facesCouvertes(this.atlas, capture, calque, entree.analyse);
  }

  _region(calque, capture) {
    const entree = this.regions.capture(capture.cle);
    if (!entree) return null;
    const faces = this.regions.facesPour(calque, capture.cle);
    if (faces.size === 0) return null;

    const { volume, boucles, ouverte } = volumePatch(entree.analyse, faces);
    const aire = aireFaces(entree.analyse, faces);
    const perimetre = perimetreFaces(entree.analyse, faces);

    // The same area, by the other route. A region is the one layer both methods
    // can measure, so it is where the raster estimator gets checked against an
    // exact sum over triangles — and the gap between them is not an annoyance
    // to be hidden, it IS the uncertainty of every paint figure this tool
    // prints. Reading it live rather than quoting a calibration from a comment
    // means it stays true if the mesh, the resolution or the atlas ever change.
    let aireRaster = null;
    let incertitude = null;
    try {
      const controle = this.raster.mesurer(this.atlas, capture, calque);
      if (controle && controle.aire > 0) {
        aireRaster = controle.aire;
        incertitude = Math.abs(aire - aireRaster);
      }
    } catch (erreur) {
      // A missing float target is a known, survivable case: the exact figure
      // stands on its own, it simply comes without its second opinion.
      console.warn('Contrôle raster indisponible pour cette région.', erreur);
    }

    return {
      methode: 'maillage',
      faces: faces.size,
      aire,
      aireRaster,
      incertitude,
      perimetre,
      volume,
      boucles,
      ouverte,
    };
  }

  _peinture(calque, capture) {
    if ((calque.donnees.elements.length ?? 0) === 0) return null;
    const releve = this.raster.mesurer(this.atlas, capture, calque);
    if (!releve) return null;
    const { aire, perimetre } = releve;
    if (aire <= 0) return null;
    // Paint has no exact counterpart to be checked against — that is what makes
    // it paint. The uncertainty quoted here is the one measured on regions,
    // where both routes exist; the calibration table in config.js is the
    // fallback when this document contains no region to calibrate on.
    const apprise = this.incertitudeRelative;
    const relative = apprise ?? this.config.mesure.incertitudeAire ?? 0.001;
    // A volume needs a border made of edges, which paint does not have. The
    // honest answer is to say so and point at the tool that does: turning the
    // zone into a region gives one.
    return {
      methode: 'atlas',
      aire,
      incertitude: aire * relative,
      // Where that figure came from: a region of this very document measured
      // both ways, or — when the document holds no region — the calibration
      // table in the settings. The two deserve different amounts of trust, so
      // the read-out is told which it is rather than claiming the better one.
      sourceIncertitude: apprise ? 'mesuree' : 'calibration',
      perimetre,
      volume: null,
      boucles: null,
    };
  }

  // The uncertainty learned from the regions of this document, if any has been
  // measured both ways. Kept as a relative figure so it transfers to a paint
  // layer of any size.
  apprendreIncertitude(releve) {
    if (releve?.methode !== 'maillage' || !releve.incertitude || !(releve.aire > 0)) return;
    this.incertitudeRelative = releve.incertitude / releve.aire;
  }

  // One layer, measured on every capture that is loaded.
  //
  // The three captures of this specimen were taken within an hour of each
  // other: they are not three states of the object, they are three measurements
  // of one state. Their spread is therefore not a change to be reported — it is
  // the repeatability of the whole chain, from photogrammetry to alignment to
  // the estimator, and it is the only figure that says what a single number
  // from this tool is actually worth. On a specimen re-captured years later the
  // same table reads as change instead, against that known noise floor.
  surCaptures(calque, captures) {
    const releves = [];
    for (const capture of captures) {
      if (!capture) continue;
      const releve = this.mesurer(calque, capture);
      releves.push({ capture, releve });
    }
    return releves;
  }

  // The specimen itself. The watertightness count is the point of this: a
  // volume computed on a mesh with holes in it is a number, not a measurement.
  specimen(capture) {
    if (!capture) return null;
    const entree = this.regions.capture(capture.cle);
    if (!entree) return null;
    const cle = `__specimen:${capture.cle}`;
    const memoire = this.cache.get(cle);
    if (memoire) return memoire;

    const { volume, aretesDeBord, ferme } = volumeModele(entree.analyse);
    const resultat = {
      faces: entree.analyse.nbFaces,
      aire: aireModele(entree.analyse),
      volume,
      aretesDeBord,
      ferme,
      areteMediane: entree.analyse.areteMediane,
    };
    this.cache.set(cle, resultat);
    return resultat;
  }
}

/* ------------------------------------------------------------- écriture */

const nombre = (valeur, decimales) => valeur.toLocaleString('fr-FR', {
  minimumFractionDigits: decimales, maximumFractionDigits: decimales,
});

// Everything above is computed in model units. The automatic conversion to
// metres happens here, at the one boundary where a figure becomes something a
// person reads. Areas scale as the square, volumes as the cube.
//
// The unit is chosen once, from the value, and then imposed on anything shown
// beside it. That matters for the ± : « 12,43 cm² ± 12,4 mm² » is arithmetic
// the reader has to do in their head, and they will get it wrong.
function unite(valeur, echelle, paliers) {
  const converti = valeur * echelle;
  for (const palier of paliers) {
    if (converti < palier.seuil) return palier;
  }
  return paliers.at(-1);
}

const PALIERS_LONGUEUR = [
  { seuil: 0.01, facteur: 1000, suffixe: 'mm', decimales: 1 },
  { seuil: 1, facteur: 100, suffixe: 'cm', decimales: 2 },
  { seuil: Infinity, facteur: 1, suffixe: 'm', decimales: 3 },
];
const PALIERS_AIRE = [
  { seuil: 1e-4, facteur: 1e6, suffixe: 'mm²', decimales: 1 },
  { seuil: 1, facteur: 1e4, suffixe: 'cm²', decimales: 2 },
  { seuil: Infinity, facteur: 1, suffixe: 'm²', decimales: 3 },
];
const PALIERS_VOLUME = [
  { seuil: 1e-6, facteur: 1e9, suffixe: 'mm³', decimales: 1 },
  { seuil: 1e-3, facteur: 1e6, suffixe: 'cm³', decimales: 2 },
  { seuil: Infinity, facteur: 1000, suffixe: 'L', decimales: 3 },
];

function formater(valeur, echelle, paliers) {
  if (valeur === null || !Number.isFinite(valeur)) return '—';
  const { facteur, suffixe, decimales } = unite(valeur, echelle, paliers);
  return `${nombre(valeur * echelle * facteur, decimales)} ${suffixe}`;
}

// A figure and what it is worth, in one unit.
//
// A number without an uncertainty is not a measurement, and this pipeline
// already knows its own: the exact and raster routes to an area are two
// independent estimators of one quantity, so their difference bounds the error
// without anyone having to assume anything. Printing the bound was the missing
// half of a calculation that was already being done twice on purpose.
function formaterIncertain(valeur, incertitude, echelle, paliers) {
  if (valeur === null || !Number.isFinite(valeur)) return '—';
  const { facteur, suffixe, decimales } = unite(valeur, echelle, paliers);
  const principal = nombre(valeur * echelle * facteur, decimales);
  if (!Number.isFinite(incertitude) || incertitude <= 0) return `${principal} ${suffixe}`;
  // The ± is given at least one significant digit of its own: rounded to the
  // value's precision a small uncertainty reads « ± 0,00 », which says the
  // opposite of what it means.
  const marge = incertitude * echelle * facteur;
  const chiffres = marge >= 1 ? decimales : Math.min(4, decimales + 1 + Math.floor(-Math.log10(marge)));
  return `${principal} ± ${nombre(marge, chiffres)} ${suffixe}`;
}

export function formaterLongueur(valeur, echelle = 1) {
  return formater(valeur, echelle, PALIERS_LONGUEUR);
}

export function formaterAire(valeur, echelle = 1) {
  const facteur = echelle * echelle;
  return formater(valeur, facteur, PALIERS_AIRE);
}

export function formaterVolume(valeur, echelle = 1) {
  return formater(valeur, echelle ** 3, PALIERS_VOLUME);
}

export function formaterLongueurIncertaine(valeur, incertitude, echelle = 1) {
  return formaterIncertain(valeur, incertitude, echelle, PALIERS_LONGUEUR);
}

export function formaterAireIncertaine(valeur, incertitude, echelle = 1) {
  return formaterIncertain(valeur, incertitude, echelle * echelle, PALIERS_AIRE);
}

// Relative spread, for the read-outs that talk about agreement rather than
// about a quantity.
export function formaterPourcentage(part, decimales = 1) {
  if (!Number.isFinite(part)) return '—';
  return `${nombre(part * 100, decimales)} %`;
}
