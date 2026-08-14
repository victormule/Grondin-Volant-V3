// Regions: face sets turned into fills and outlines, per capture.
//
// A region is stored as face indices plus the session they were picked on.
// Shown on another capture, the faces are matched by position — see
// `transferer`. Results are cached per layer and per capture, because the
// match costs a spatial lookup over every face and must not run per frame.
//
// Everything here is addressed by an explicit capture key rather than by « the
// session currently on screen »: in composite mode the three captures are all
// shown at once and each needs its own answer.

import * as THREE from 'three';
import { AnalyseModele, GrilleFaces } from './maillage.js';
import { frontiere, geometrieSelection, lisserSelection, transferer } from './selection.js';
import { elementsDuGenre } from '../document/modele.js';

// How closely a face must agree with a region's dominant facing to be allowed
// to carry its label. Generous — a zone curving over a flank still counts as
// facing one way — but enough to rule out the folds and the underside.
const ACCORD_ANCRAGE = 0.35;

export class GestionnaireRegions {
  constructor(config) {
    this.config = config;
    this.captures = new Map();
    this.parSession = new Map();
    this.courante = null;
    this.cache = new Map();
  }

  // Analysis is heavy (adjacency over 25 000 faces) so it is built on demand,
  // once per capture, and kept.
  enregistrer(cle, racine, idSession = null) {
    let entree = this.captures.get(cle);
    if (entree && entree.racine === racine) return entree;

    const analyse = new AnalyseModele(racine);
    const seuil = analyse.areteMediane * this.config.selection.facteurTransfert;
    entree = {
      cle,
      racine,
      idSession,
      analyse,
      seuil,
      grille: new GrilleFaces(analyse, Math.max(seuil, 1e-3)),
    };
    this.captures.set(cle, entree);
    if (idSession) this.parSession.set(idSession, entree);
    this.cache.clear();
    return entree;
  }

  // The capture the selection tools work on.
  definirCourante(cle) {
    this.courante = this.captures.get(cle) ?? null;
  }

  get analyse() {
    return this.courante?.analyse ?? null;
  }

  get idSession() {
    return this.courante?.idSession ?? null;
  }

  get cleCourante() {
    return this.courante?.cle ?? null;
  }

  invalider(idCalque = null) {
    if (idCalque) {
      for (const cle of [...this.cache.keys()]) {
        if (cle.startsWith(`${idCalque}:`)) this.cache.delete(cle);
      }
      return;
    }
    this.cache.clear();
  }

  _entree(cle) {
    return cle === null || cle === undefined ? this.courante : this.captures.get(cle);
  }

  // The mesh analysis of one capture — what the measurements are computed on.
  capture(cle = null) {
    return this._entree(cle) ?? null;
  }

  // The face set of a layer, expressed on one capture's mesh. Only elements
  // that are regions are considered — a layer's array can also hold strokes,
  // pins or measurements, and none of those has faces.
  facesPour(calque, cle = null) {
    const entree = this._entree(cle);
    if (!entree) return new Set();
    const elements = elementsDuGenre(calque, 'region');
    const identifiant = `${calque.id}:${entree.cle}`;
    const cache = this.cache.get(identifiant);
    if (cache?.faces) return cache.faces;

    const faces = new Set();
    for (const element of elements) {
      const memeCapture = !element.session || element.session === entree.idSession;
      if (memeCapture) {
        for (const f of element.faces) faces.add(f);
        continue;
      }

      const source = this.parSession.get(element.session);
      if (!source) continue;
      for (const f of transferer(new Set(element.faces), source.analyse, entree.grille,
        entree.seuil)) faces.add(f);
    }

    this.cache.set(identifiant, { ...(cache ?? {}), faces });
    return faces;
  }

  // Smooths the stored faces on the capture where each region element was
  // authored. The operation is deliberately repeatable: one click repairs
  // one-face holes; another can regularise a rougher converted paint edge
  // without imposing an irreversible, arbitrary strength.
  lisser(calque, passages = 1) {
    let avant = 0;
    let apres = 0;
    let elements = 0;

    for (const element of elementsDuGenre(calque, 'region')) {
      if (!Array.isArray(element.faces) || element.faces.length === 0) continue;
      const source = element.session
        ? this.parSession.get(element.session)
        : this.courante;
      if (!source) continue;

      // Old regions created in composite mode did not record their reference
      // capture. Repair that provenance as soon as the user edits them, so
      // their face indices are never reused raw on every other mesh again.
      if (!element.session && source.idSession) element.session = source.idSession;

      const selection = new Set(element.faces.filter((face) => (
        Number.isInteger(face) && face >= 0 && face < source.analyse.nbFaces
      )));
      avant += selection.size;
      const lisse = lisserSelection(source.analyse, selection, passages);
      element.faces = [...lisse].sort((a, b) => a - b);
      apres += lisse.size;
      elements += 1;
    }

    if (elements > 0) this.invalider(calque.id);
    return { avant, apres, elements };
  }

  geometrieUV(calque, cle = null) {
    const entree = this._entree(cle);
    if (!entree) return null;
    const identifiant = `${calque.id}:${entree.cle}`;
    const cache = this.cache.get(identifiant) ?? {};
    if (cache.geometrie !== undefined) return cache.geometrie;

    const faces = this.facesPour(calque, entree.cle);
    const geometrie = faces.size > 0 ? geometrieSelection(entree.analyse, faces) : null;
    const stocke = this.cache.get(identifiant) ?? {};
    stocke.geometrie = geometrie;
    this.cache.set(identifiant, stocke);
    return geometrie;
  }

  // Where a region's label belongs: the centre of its area on this capture,
  // weighted by face area so a thin tail cannot drag the name off the body of
  // the zone.
  centre(calque, cle = null) {
    const entree = this._entree(cle);
    if (!entree) return null;
    const faces = this.facesPour(calque, entree.cle);
    if (faces.size === 0) return null;
    const { centres, aires, normales } = entree.analyse;
    let x = 0;
    let y = 0;
    let z = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let poids = 0;
    for (const face of faces) {
      const aire = aires[face] || 1e-9;
      x += centres[face * 3] * aire;
      y += centres[face * 3 + 1] * aire;
      z += centres[face * 3 + 2] * aire;
      nx += normales[face * 3] * aire;
      ny += normales[face * 3 + 1] * aire;
      nz += normales[face * 3 + 2] * aire;
      poids += aire;
    }
    if (poids <= 0) return null;

    // The weighted centroid is the natural centre of a region — and on anything
    // curved it lies INSIDE the shell. Hung there, a label is occluded by the
    // specimen's own surface from most angles, so it blinked out as soon as the
    // model turned. The centroid therefore only ELECTS a face; what comes back
    // is that face's own centre and normal, a point genuinely on the surface
    // that can be tested exactly like a pin's.
    //
    // The election also has to respect which way the zone faces. Taking the
    // face nearest the centroid outright picks, on a region that wraps around a
    // flank, whichever fold happens to sit closest to the middle of the volume
    // — measured here, a face pointing almost straight down, so the label hid
    // itself at every angle a reader would ever use. The region's area-weighted
    // normal gives its dominant facing; the anchor is chosen among the faces
    // that share it, and only falls back to the whole set if none does.
    const cx = x / poids;
    const cy = y / poids;
    const cz = z / poids;

    const dominante = new THREE.Vector3(nx, ny, nz);
    const orientee = dominante.lengthSq() > 1e-12;
    if (orientee) dominante.normalize();

    const elire = (accordMinimum) => {
      let elue = -1;
      let ecartMin = Infinity;
      for (const face of faces) {
        if (accordMinimum !== null) {
          const accord = dominante.x * normales[face * 3]
            + dominante.y * normales[face * 3 + 1]
            + dominante.z * normales[face * 3 + 2];
          if (accord < accordMinimum) continue;
        }
        const dx = centres[face * 3] - cx;
        const dy = centres[face * 3 + 1] - cy;
        const dz = centres[face * 3 + 2] - cz;
        const ecart = dx * dx + dy * dy + dz * dz;
        if (ecart < ecartMin) { ecartMin = ecart; elue = face; }
      }
      return elue;
    };

    let elue = orientee ? elire(ACCORD_ANCRAGE) : -1;
    if (elue < 0) elue = elire(null);
    if (elue < 0) return null;

    // The stored normals are already unit vectors: `aires` was taken from the
    // cross product's length before it was normalised.
    return {
      position: new THREE.Vector3(
        centres[elue * 3], centres[elue * 3 + 1], centres[elue * 3 + 2],
      ),
      normale: new THREE.Vector3(
        normales[elue * 3], normales[elue * 3 + 1], normales[elue * 3 + 2],
      ),
    };
  }

  segmentsContour(calque, cle = null) {
    const entree = this._entree(cle);
    if (!entree) return [];
    const identifiant = `${calque.id}:${entree.cle}`;
    const cache = this.cache.get(identifiant) ?? {};
    if (cache.segments !== undefined) return cache.segments;

    const faces = this.facesPour(calque, entree.cle);
    const segments = faces.size > 0
      ? frontiere(entree.analyse, faces, this.config.selection.decalageContour)
      : [];
    const stocke = this.cache.get(identifiant) ?? {};
    stocke.segments = segments;
    this.cache.set(identifiant, stocke);
    return segments;
  }
}

// Flat fill in UV space: same vertex trick as the brush, but the coverage is
// the triangle itself, which is what gives a region its crisp border.
export function creerMateriauRegion() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      void main() { gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
