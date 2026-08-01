// Taking a measurement: one tap per point, and the figure updates as you go.
//
// A polyline rather than a single segment, because the useful measurements on
// a specimen rarely are one: the length of a fin ray, the girth of the body,
// the outline of a lesion. Each leg keeps its own figure and the total is
// shown at the end.

import { creerMesure } from '../document/modele.js';

export class OutilMesure {
  constructor(pointeur, config) {
    this.pointeur = pointeur;
    this.config = config;
    this.mode = config.mesure.mode === 'surface' ? 'surface' : 'droite';
    this.points = [];
    this.libre = null;
    // Bumped whenever the placed points change — never when the free end
    // moves. That is exactly the distinction the preview needs to know what it
    // can reuse: undoing a point and placing another one somewhere else leaves
    // the count identical, so the count alone would serve a stale path.
    this.revision = 0;
    this.surChangement = null;
  }

  get enCours() {
    return this.points.length > 0;
  }

  definirMode(mode) {
    this.mode = mode;
    this.revision += 1;
    this._prevenir();
  }

  ajouterPoint(x, y) {
    const touche = this.pointeur.surfaceSous(x, y);
    if (!touche) return false;
    this.points.push(touche.position.clone());
    this.libre = null;
    this.revision += 1;
    this._prevenir();
    return true;
  }

  deplacer(x, y) {
    if (!this.enCours) return false;
    const touche = this.pointeur.surfaceSous(x, y);
    // Off the specimen: the rubber band is dropped rather than left hanging on
    // the last place the pointer happened to touch the mesh.
    this.libre = touche ? touche.position.clone() : null;
    this._prevenir();
    return true;
  }

  retirerDernier() {
    if (!this.enCours) return;
    this.points.pop();
    this.revision += 1;
    this._prevenir();
  }

  annuler() {
    this.points = [];
    this.libre = null;
    this.revision += 1;
    this._prevenir();
  }

  // A measurement needs two points; ending on one is a mis-click, not a
  // measurement of zero.
  terminer(session = null) {
    const points = this.points;
    this.points = [];
    this.libre = null;
    this.revision += 1;
    this._prevenir();
    if (points.length < 2) return null;
    return creerMesure(points, this.mode, session);
  }

  _prevenir() {
    this.surChangement?.();
  }
}
