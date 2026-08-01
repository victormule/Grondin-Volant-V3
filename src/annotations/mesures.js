// Measurements on screen: a line on the specimen, and the figure next to it.
//
// The line is 3D (so it is occluded by the body and correct from every angle);
// the figure is DOM (so it stays crisp and readable at any zoom). Same split as
// the pins, for the same reasons.
//
// Unlike a pin's label, a measurement's label is never hidden until hovered:
// the number is the annotation. There is no point drawing the line if you have
// to go looking for what it says.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { faceLaPlusProche, trajet, milieuTrajet } from '../mesure/trajet.js';
import { formaterLongueur } from '../mesure/metriques.js';

const BUDGET_RAYONS = 3;

export class CoucheMesures {
  constructor(conteneur, scene3d, pointeur, config) {
    this.conteneur = conteneur;
    this.scene3d = scene3d;
    this.pointeur = pointeur;
    this.config = config;

    this.groupe = new THREE.Group();
    this.groupe.renderOrder = 2;
    scene3d.scene.add(this.groupe);

    this.lignes = new Map();
    this.etiquettes = [];
    this.resolution = new THREE.Vector2(1, 1);
    this.curseurOcclusion = 0;
    this.occlusionsRestantes = 0;
    this.cache = new Map();
    // Metres per model unit; set by the application from the document.
    this.echelle = 1;

    this.materiauApercu = this._materiau(config.selection.couleurApercu);
    this.apercu = new LineSegments2(new LineSegmentsGeometry(), this.materiauApercu);
    this.apercu.frustumCulled = false;
    this.apercu.visible = false;
    this.apercu.renderOrder = 4;
    scene3d.scene.add(this.apercu);

    this._point = new THREE.Vector3();
  }

  _materiau(couleur) {
    const materiau = new LineMaterial({
      color: new THREE.Color(couleur).getHex(),
      linewidth: this.config.mesure.epaisseur,
      worldUnits: false,
      dashed: false,
      toneMapped: false,
    });
    materiau.resolution.copy(this.resolution);
    return materiau;
  }

  majResolution(largeur, hauteur) {
    this.resolution.set(largeur, hauteur);
    this.materiauApercu.resolution.copy(this.resolution);
    for (const { materiau } of this.lignes.values()) materiau.resolution.copy(this.resolution);
  }

  invalider() {
    this.cache.clear();
  }

  /* ------------------------------------------------------- calcul du tracé */

  // Walking a path across the mesh costs a Dijkstra, so a measurement is
  // computed once per capture and kept until its points change.
  trace(element, entree, cleCapture) {
    const cle = `${element.id}:${cleCapture}:${element.mode}:${element.points.length}`;
    const memoire = this.cache.get(cle);
    if (memoire) return memoire;

    const points = element.points.map((p) => new THREE.Vector3(...p));
    const resultat = trajet(entree, points, element.mode);
    this.cache.set(cle, resultat);
    return resultat;
  }

  /* -------------------------------------------------------------- affichage */

  rafraichir(doc, capture, entree) {
    this.doc = doc;
    const vus = new Set();
    this.conteneur.replaceChildren();
    this.etiquettes = [];

    if (capture) {
      for (const { calque } of doc.aplatir()) {
        if (calque.type !== 'mesure' || !calque.donnees) continue;
        if (!doc.visibleEffectivement(calque.id)) continue;
        if (!doc.concerneSession(calque, capture.session)) continue;
        if (calque.donnees.elements.length === 0) continue;

        vus.add(calque.id);
        this._rendreCalque(calque, capture, entree);
      }
    }

    for (const [id, ligne] of [...this.lignes]) {
      if (vus.has(id)) continue;
      this.groupe.remove(ligne.objet);
      ligne.objet.geometry.dispose();
      ligne.materiau.dispose();
      this.lignes.delete(id);
    }

    this.occlusionsRestantes = this.etiquettes.length;
    this.majPositions();
  }

  _rendreCalque(calque, capture, entree) {
    const segments = [];

    for (const element of calque.donnees.elements) {
      if (!element.points || element.points.length < 2) continue;
      const trace = this.trace(element, entree,capture.cle);

      for (const segment of trace.segments) {
        for (let i = 0; i < segment.points.length - 1; i++) {
          const a = segment.points[i];
          const b = segment.points[i + 1];
          segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
        this._etiquette(formaterLongueur(segment.longueur, this.echelle),
          milieuTrajet(segment.points, new THREE.Vector3()), calque, false);
      }

      // A polyline of several legs also gets its running total, at the end.
      if (trace.segments.length > 1) {
        this._etiquette(`Σ ${formaterLongueur(trace.longueur, this.echelle)}`,
          trace.segments.at(-1).points.at(-1).clone(), calque, true);
      }
    }

    let entreeLigne = this.lignes.get(calque.id);
    if (!entreeLigne) {
      const materiau = this._materiau(calque.couleur);
      const objet = new LineSegments2(new LineSegmentsGeometry(), materiau);
      objet.frustumCulled = false;
      this.groupe.add(objet);
      entreeLigne = { objet, materiau };
      this.lignes.set(calque.id, entreeLigne);
    }

    const geometrie = new LineSegmentsGeometry();
    if (segments.length > 0) geometrie.setPositions(segments);
    entreeLigne.objet.geometry.dispose();
    entreeLigne.objet.geometry = geometrie;
    entreeLigne.objet.visible = segments.length > 0;
    entreeLigne.materiau.color.set(calque.couleur);
    const opacite = this.doc.opaciteEffective(calque.id);
    entreeLigne.materiau.opacity = opacite;
    entreeLigne.materiau.transparent = opacite < 1;
  }

  _etiquette(texte, position, calque, total) {
    const element = document.createElement('span');
    element.className = total ? 'mesure-etiquette mesure-total' : 'mesure-etiquette';
    element.textContent = texte;
    element.style.setProperty('--couleur', calque.couleur);
    element.style.opacity = String(this.doc.opaciteEffective(calque.id));
    this.conteneur.appendChild(element);
    this.etiquettes.push({ element, position, visible: true });
  }

  /* ---------------------------------------------------------------- aperçu */

  // The measurement being taken: the placed points, plus a rubber band to
  // wherever the pointer is.
  //
  // The placed legs are walked properly and kept — they only change when a
  // point is added or removed. In surface mode the free leg follows the mesh
  // too; its graph route is reused while the pointer remains on one triangle.
  montrerApercu(points, libre, entree, mode, revision = 0) {
    const places = points ?? [];
    const trace = places.length >= 2
      ? this._apercuPlaces(places, entree, mode, revision)
      : { segments: [], longueur: 0 };

    const segments = [];
    for (const segment of trace.segments) {
      for (let i = 0; i < segment.points.length - 1; i++) {
        const a = segment.points[i];
        const b = segment.points[i + 1];
        segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    let longueur = trace.longueur;
    if (libre && places.length >= 1) {
      const segment = this._apercuLibre(places.at(-1), libre, entree, mode, revision);
      for (let i = 0; i < segment.points.length - 1; i++) {
        const a = segment.points[i];
        const b = segment.points[i + 1];
        segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      longueur += segment.longueur;
    }

    if (segments.length === 0) { this.masquerApercu(); return null; }

    const geometrie = new LineSegmentsGeometry();
    geometrie.setPositions(segments);
    this.apercu.geometry.dispose();
    this.apercu.geometry = geometrie;
    this.apercu.visible = true;
    return { longueur, provisoire: Boolean(libre) };
  }

  // One slot, keyed by the tool's revision: the placed points change only when
  // one is added or removed, and the pointer moves far more often than that.
  _apercuPlaces(points, entree, mode, revision) {
    const cle = `${revision}:${points.length}:${mode}:${entree?.cle ?? '-'}`;
    if (this._apercuCache?.cle === cle) return this._apercuCache.trace;
    const trace = trajet(entree, points, mode);
    this._apercuCache = { cle, trace };
    return trace;
  }

  _apercuLibre(depart, libre, entree, mode, revision) {
    if (mode !== 'surface' || !entree) {
      return { points: [depart.clone(), libre.clone()], longueur: depart.distanceTo(libre) };
    }

    const face = faceLaPlusProche(entree, libre);
    const cle = `${revision}:${entree.cle}:${face}`;
    if (this._apercuLibreCache?.cle !== cle) {
      const segment = trajet(entree, [depart, libre], 'surface').segments[0];
      this._apercuLibreCache = { cle, segment };
      return segment;
    }

    // Moving inside one triangle does not change the graph route. Only its
    // exact last point and the final length need updating.
    const segment = this._apercuLibreCache.segment;
    segment.points.at(-1).copy(libre);
    let longueur = 0;
    for (let i = 0; i < segment.points.length - 1; i++) {
      longueur += segment.points[i].distanceTo(segment.points[i + 1]);
    }
    segment.longueur = longueur;
    return segment;
  }

  masquerApercu() {
    this.apercu.visible = false;
    this._apercuLibreCache = null;
  }

  /* ------------------------------------------------------------- positions */

  majPositions(retesterOcclusions = false) {
    if (this.etiquettes.length === 0) return false;
    if (retesterOcclusions) this.occlusionsRestantes = this.etiquettes.length;
    const camera = this.scene3d.camera;
    const toile = this.scene3d.renderer.domElement;
    const largeur = toile.clientWidth;
    const hauteur = toile.clientHeight;

    for (const etiquette of this.etiquettes) {
      this._point.copy(etiquette.position).project(camera);
      etiquette.x = (this._point.x * 0.5 + 0.5) * largeur;
      etiquette.y = (-this._point.y * 0.5 + 0.5) * hauteur;
      etiquette.profondeur = this._point.z;
      etiquette.visible = this._point.z <= 1 && !etiquette.occulte;
    }

    this._testerOcclusions();

    for (const etiquette of this.etiquettes) {
      const element = etiquette.element;
      if (!etiquette.visible) { element.classList.add('cachee'); continue; }
      element.classList.remove('cachee');
      element.style.transform = `translate(${Math.round(etiquette.x)}px, ${Math.round(etiquette.y)}px)`;
      element.style.zIndex = String(1000 - Math.round(etiquette.profondeur * 500));
    }
    return this.occlusionsRestantes > 0;
  }

  // Same spread-over-frames budget as the pins: a ray against 25 000 triangles
  // is not free, and a label that takes three frames to hide is not noticed.
  _testerOcclusions() {
    const total = this.etiquettes.length;
    if (total === 0 || this.occlusionsRestantes === 0) return;
    const nombre = Math.min(BUDGET_RAYONS, total, this.occlusionsRestantes);
    for (let n = 0; n < nombre; n++) {
      const etiquette = this.etiquettes[this.curseurOcclusion % total];
      this.curseurOcclusion = (this.curseurOcclusion + 1) % total;
      etiquette.occulte = this.pointeur.occulte(etiquette.position);
      if (etiquette.occulte) etiquette.visible = false;
    }
    this.occlusionsRestantes -= nombre;
  }
}
