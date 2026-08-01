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

    if (resultat) this.cache.set(cle, resultat);
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
    return {
      methode: 'maillage',
      faces: faces.size,
      aire: aireFaces(entree.analyse, faces),
      perimetre: perimetreFaces(entree.analyse, faces),
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
    // A volume needs a border made of edges, which paint does not have. The
    // honest answer is to say so and point at the tool that does: turning the
    // zone into a region gives one.
    return { methode: 'atlas', aire, perimetre, volume: null, boucles: null };
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
export function formaterLongueur(valeur, echelle = 1) {
  if (valeur === null || !Number.isFinite(valeur)) return '—';
  const metres = valeur * echelle;
  if (metres < 0.01) return `${nombre(metres * 1000, 1)} mm`;
  if (metres < 1) return `${nombre(metres * 100, 2)} cm`;
  return `${nombre(metres, 3)} m`;
}

export function formaterAire(valeur, echelle = 1) {
  if (valeur === null || !Number.isFinite(valeur)) return '—';
  const metresCarres = valeur * echelle * echelle;
  if (metresCarres < 1e-4) return `${nombre(metresCarres * 1e6, 1)} mm²`;
  if (metresCarres < 1) return `${nombre(metresCarres * 1e4, 2)} cm²`;
  return `${nombre(metresCarres, 3)} m²`;
}

export function formaterVolume(valeur, echelle = 1) {
  if (valeur === null || !Number.isFinite(valeur)) return '—';
  const metresCubes = valeur * echelle ** 3;
  if (metresCubes < 1e-6) return `${nombre(metresCubes * 1e9, 1)} mm³`;
  if (metresCubes < 1e-3) return `${nombre(metresCubes * 1e6, 2)} cm³`;
  return `${nombre(metresCubes * 1000, 3)} L`;
}
