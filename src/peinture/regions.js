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

  // The face set of a layer, expressed on one capture's mesh.
  facesPour(calque, cle = null) {
    const entree = this._entree(cle);
    if (!entree) return new Set();
    const identifiant = `${calque.id}:${entree.cle}`;
    const cache = this.cache.get(identifiant);
    if (cache?.faces) return cache.faces;

    const faces = new Set();
    for (const element of calque.donnees?.elements ?? []) {
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

    for (const element of calque?.donnees?.elements ?? []) {
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
