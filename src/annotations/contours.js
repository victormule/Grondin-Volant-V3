// Region outlines, and the preview of a selection being made.
//
// The outline is a LineSegments2 rather than plain lines: WebGL ignores
// `linewidth` on ordinary lines, and a one-pixel hairline is not what
// "entourer" means.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { calquePorte } from '../document/modele.js';

export class CoucheContours {
  constructor(scene, renderer, config) {
    this.scene = scene;
    this.renderer = renderer;
    this.config = config;

    this.groupe = new THREE.Group();
    this.groupe.renderOrder = 2;
    scene.add(this.groupe);

    this.lignes = new Map();
    this.resolution = new THREE.Vector2(1, 1);

    // Highlight for the selection in progress: flat, unlit, pushed slightly
    // towards the camera so it does not z-fight with the surface it covers.
    this.materiauApercu = new THREE.MeshBasicMaterial({
      color: new THREE.Color(config.selection.couleurApercu),
      transparent: true,
      opacity: config.selection.opaciteApercu,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    this.apercu = new THREE.Mesh(new THREE.BufferGeometry(), this.materiauApercu);
    this.apercu.frustumCulled = false;
    this.apercu.visible = false;
    this.apercu.renderOrder = 3;
    scene.add(this.apercu);

    this.materiauApercuContour = this._materiau(config.selection.couleurApercu,
      config.selection.epaisseurContour);
    this.contourApercu = new LineSegments2(new LineSegmentsGeometry(), this.materiauApercuContour);
    this.contourApercu.frustumCulled = false;
    this.contourApercu.visible = false;
    this.contourApercu.renderOrder = 4;
    scene.add(this.contourApercu);
  }

  _materiau(couleur, epaisseur) {
    return new LineMaterial({
      color: new THREE.Color(couleur).getHex(),
      linewidth: epaisseur,
      worldUnits: false,
      dashed: false,
      alphaToCoverage: false,
      toneMapped: false,
    });
  }

  majResolution(largeur, hauteur) {
    this.resolution.set(largeur, hauteur);
    this.materiauApercuContour.resolution.copy(this.resolution);
    for (const { materiau } of this.lignes.values()) materiau.resolution.copy(this.resolution);
  }

  /* -------------------------------------------------------------- aperçu */

  montrerApercu(geometrie, segments) {
    if (!geometrie) { this.masquerApercu(); return; }
    this.apercu.geometry.dispose();
    this.apercu.geometry = geometrie;
    this.apercu.visible = true;

    if (segments && segments.length > 0) {
      const g = new LineSegmentsGeometry();
      g.setPositions(segments);
      this.contourApercu.geometry.dispose();
      this.contourApercu.geometry = g;
      this.contourApercu.visible = true;
    } else {
      this.contourApercu.visible = false;
    }
  }

  masquerApercu() {
    this.apercu.visible = false;
    this.contourApercu.visible = false;
  }

  /* ------------------------------------------------------------ contours */

  // One line object per visible region layer whose outline is switched on.
  //
  // Outlines are built on one capture only, even in composite mode: the three
  // meshes agree to within a few millimetres, so three superimposed strokes
  // three pixels wide would read as one blurred line rather than as three.
  rafraichir(doc, gestionnaire, capture) {
    const vus = new Set();
    if (!capture) { this._nettoyer(vus); return; }

    for (const { calque } of doc.aplatir()) {
      if (!calquePorte(calque, 'region') || calque.contour === false) continue;
      if (!doc.visibleEffectivement(calque.id)) continue;
      if (!doc.concerneSession(calque, capture.session)) continue;

      const segments = gestionnaire.segmentsContour(calque, capture.cle);
      if (!segments || segments.length === 0) continue;

      vus.add(calque.id);
      let entree = this.lignes.get(calque.id);
      if (!entree) {
        const materiau = this._materiau(calque.couleur, this.config.selection.epaisseurContour);
        materiau.resolution.copy(this.resolution);
        const ligne = new LineSegments2(new LineSegmentsGeometry(), materiau);
        ligne.frustumCulled = false;
        this.groupe.add(ligne);
        entree = { ligne, materiau, segments: null };
        this.lignes.set(calque.id, entree);
      }

      const opacite = doc.opaciteEffective(calque.id);
      if (entree.segments !== segments) {
        const g = new LineSegmentsGeometry();
        g.setPositions(segments);
        entree.ligne.geometry.dispose();
        entree.ligne.geometry = g;
        entree.segments = segments;
      }
      // Colour and opacity are uniforms: updating them must not rebuild and
      // upload the unchanged contour geometry during a slider drag.
      entree.materiau.color.set(calque.couleur);
      entree.materiau.opacity = opacite;
      entree.materiau.transparent = opacite < 1;
    }

    this._nettoyer(vus);
  }

  _nettoyer(vus) {
    for (const [id, entree] of [...this.lignes]) {
      if (vus.has(id)) continue;
      this.groupe.remove(entree.ligne);
      entree.ligne.geometry.dispose();
      entree.materiau.dispose();
      this.lignes.delete(id);
    }
  }
}
