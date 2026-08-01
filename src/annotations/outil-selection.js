// Selection tools: magic wand and lasso, with the usual boolean modifiers.

import { baguette, lasso, combiner, dilaterSelection, lisserSelection, frontiere, geometrieSelection }
  from '../peinture/selection.js';

export class OutilSelection {
  constructor(pointeur, gestionnaire, config) {
    this.pointeur = pointeur;
    this.gestionnaire = gestionnaire;
    this.config = config;

    this.selection = new Set();
    this.angleMax = config.selection.angleMax;
    this.tolerance = config.selection.tolerance;

    this.trace = null;
    this.surChangement = null;

    // Persistent combine mode, the Photoshop pathfinder buttons. Shift and Alt
    // still override it for one gesture, which is what a hand expects.
    this.modeCourant = 'remplacer';
    // Selection as it stood when the current gesture began: a live preview has
    // to recombine from that, not from its own previous frame.
    this._avantGeste = null;
  }

  get vide() {
    return this.selection.size === 0;
  }

  mode(evenement) {
    if (evenement.shiftKey && evenement.altKey) return 'intersecter';
    if (evenement.shiftKey) return 'ajouter';
    if (evenement.altKey) return 'retirer';
    return this.modeCourant;
  }

  definirMode(mode) {
    this.modeCourant = mode;
  }

  vider() {
    this.selection = new Set();
    this._prevenir();
  }

  /* ------------------------------------------------------------ baguette */

  baguetteA(x, y, mode) {
    const analyse = this.gestionnaire.analyse;
    if (!analyse) return false;

    const touche = this.pointeur.premiereTouche(x, y);
    if (!touche) return false;
    const face = analyse.faceDepuisTouche(touche);
    if (face < 0) return false;

    const trouvee = baguette(analyse, face, {
      angleMax: this.angleMax,
      tolerance: this.tolerance,
      maxFaces: this.config.selection.maxFaces,
    });
    this.selection = combiner(this.selection, trouvee, mode);
    this._prevenir();
    return true;
  }

  /* --------------------------------------------------------------- lasso */

  demarrerLasso(x, y) {
    this.trace = [{ x, y }];
    this._avantGeste = new Set(this.selection);
  }

  continuerLasso(x, y) {
    if (!this.trace) return false;
    const dernier = this.trace.at(-1);
    if (Math.hypot(x - dernier.x, y - dernier.y) < 3) return false;
    this.trace.push({ x, y });
    return true;
  }

  // Live preview: the polygon is treated as closed even while it is being
  // drawn, so the result of the gesture is visible as it happens rather than
  // discovered once the button is released.
  apercuLasso(camera, largeur, hauteur, mode) {
    const analyse = this.gestionnaire.analyse;
    if (!analyse || !this.trace || this.trace.length < 3) return;
    const trouvee = lasso(analyse, this.trace, camera, largeur, hauteur,
      { traversant: this.config.selection.lassoTraversant });
    this.selection = combiner(this._avantGeste ?? new Set(), trouvee, mode);
    this._prevenir();
  }

  terminerLasso(camera, largeur, hauteur, mode) {
    const trace = this.trace;
    this.trace = null;
    const analyse = this.gestionnaire.analyse;
    if (!analyse || !trace || trace.length < 3) {
      if (this._avantGeste) { this.selection = this._avantGeste; this._prevenir(); }
      this._avantGeste = null;
      return false;
    }

    const trouvee = lasso(analyse, trace, camera, largeur, hauteur,
      { traversant: this.config.selection.lassoTraversant });
    this.selection = combiner(this._avantGeste ?? new Set(), trouvee, mode);
    this._avantGeste = null;
    this._prevenir();
    return true;
  }

  /* ------------------------------------------------------------ retouche */

  elargir(sens) {
    const analyse = this.gestionnaire.analyse;
    if (!analyse || this.vide) return;
    this.selection = dilaterSelection(analyse, this.selection, sens);
    this._prevenir();
  }

  // Morphological closing: grow by one ring, then shrink back. Fills the holes
  // a colour threshold leaves scattered inside a region and evens out the
  // border, without moving it. Worth having because the outline is derived
  // from the selection — every hole inside it becomes a line on screen.
  lisser() {
    const analyse = this.gestionnaire.analyse;
    if (!analyse || this.vide) return;
    this.selection = lisserSelection(analyse, this.selection);
    this._prevenir();
  }

  /* ------------------------------------------------------------- rendu */

  geometrie() {
    const analyse = this.gestionnaire.analyse;
    if (!analyse || this.vide) return null;
    return geometrieSelection(analyse, this.selection);
  }

  segments() {
    const analyse = this.gestionnaire.analyse;
    if (!analyse || this.vide) return [];
    return frontiere(analyse, this.selection, this.config.selection.decalageContour);
  }

  _prevenir() {
    this.surChangement?.(this.selection);
  }
}
