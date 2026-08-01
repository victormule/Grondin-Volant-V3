// Turning a screen position into a point on the specimen, and back.
//
// Everything the annotation tools do starts here: this is the capability
// <model-viewer> could not give us and the reason the renderer was rewritten.

import * as THREE from 'three';

export class Pointeur {
  constructor(scene3d) {
    this.scene3d = scene3d;
    this.rayon = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.normale = new THREE.Vector3();
    this.matriceNormale = new THREE.Matrix3();
    this.boitesPrincipales = new WeakMap();
    this._sommet = new THREE.Vector3();
  }

  // In composite mode the three captures are superimposed; hits are taken on
  // the first one, which is the reference frame all the others were aligned
  // onto — so a pin placed there is valid for all of them.
  coucheCible() {
    if (this.scene3d.mode === 'composite') return this.scene3d.couches[0] ?? null;
    return this.scene3d.couches.find((couche) => couche && couche.visible) ?? null;
  }

  _preparer(x, y) {
    const boite = this.scene3d.renderer.domElement.getBoundingClientRect();
    this.ndc.set(
      ((x - boite.left) / boite.width) * 2 - 1,
      -((y - boite.top) / boite.height) * 2 + 1,
    );
    this.rayon.setFromCamera(this.ndc, this.scene3d.camera);
  }

  // Raw hit, kept for the tools that need the face index rather than the point.
  premiereTouche(x, y) {
    const couche = this.coucheCible();
    if (!couche) return null;
    this._preparer(x, y);
    const touches = this.rayon.intersectObject(couche, true);
    return touches[0] ?? null;
  }

  // Screen coordinates in, surface point and normal out — both in the shared
  // frame, in metres.
  surfaceSous(x, y) {
    const touche = this.premiereTouche(x, y);
    if (!touche) return null;
    this.normale.set(0, 1, 0);
    if (touche.face) {
      this.matriceNormale.getNormalMatrix(touche.object.matrixWorld);
      this.normale.copy(touche.face.normal).applyMatrix3(this.matriceNormale).normalize();
    }

    return {
      position: touche.point.clone(),
      normale: this.normale.clone(),
      distance: touche.distance,
    };
  }

  // Screen-space bounds of the opaque/main specimen material. Labels use this
  // as a conservative no-cover zone. Translucent fringe/tissue materials are
  // deliberately excluded when the glTF separates them into material groups.
  rectangleModelePrincipal(marge = 10) {
    const couche = this.coucheCible();
    if (!couche) return null;
    couche.updateMatrixWorld(true);

    let gauche = Infinity;
    let droite = -Infinity;
    let haut = Infinity;
    let bas = -Infinity;
    const projeter = (objet, boite) => {
      for (const x of [boite.min.x, boite.max.x]) {
        for (const y of [boite.min.y, boite.max.y]) {
          for (const z of [boite.min.z, boite.max.z]) {
            this._sommet.set(x, y, z).applyMatrix4(objet.matrixWorld).project(this.scene3d.camera);
            gauche = Math.min(gauche, this._sommet.x);
            droite = Math.max(droite, this._sommet.x);
            haut = Math.min(haut, this._sommet.y);
            bas = Math.max(bas, this._sommet.y);
          }
        }
      }
    };

    couche.traverse((objet) => {
      if (!objet.isMesh || !objet.geometry?.attributes?.position) return;
      const boite = this._boiteMateriauPrincipal(objet);
      if (boite && !boite.isEmpty()) projeter(objet, boite);
    });
    if (!Number.isFinite(gauche)) return null;

    const toile = this.scene3d.renderer.domElement;
    const largeur = toile.clientWidth;
    const hauteur = toile.clientHeight;
    return {
      left: (gauche * 0.5 + 0.5) * largeur - marge,
      right: (droite * 0.5 + 0.5) * largeur + marge,
      top: (-bas * 0.5 + 0.5) * hauteur - marge,
      bottom: (-haut * 0.5 + 0.5) * hauteur + marge,
    };
  }

  _boiteMateriauPrincipal(objet) {
    const geometrie = objet.geometry;
    const cache = this.boitesPrincipales.get(objet);
    if (cache) return cache;

    const position = geometrie.attributes.position;
    const index = geometrie.index;
    const materiaux = Array.isArray(objet.material) ? objet.material : [objet.material];
    const principal = (indice) => {
      const materiau = materiaux[indice ?? 0];
      if (!materiau) return true;
      const nom = String(materiau.name ?? '').toLowerCase();
      if (/fringe|tissue|tissu|membrane/.test(nom)) return false;
      const base = materiau.userData.__opaciteModeleOrigine ?? materiau.opacity;
      return base >= 0.9;
    };

    const boite = new THREE.Box3();
    boite.makeEmpty();
    const groupes = geometrie.groups.length > 0
      ? geometrie.groups
      : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];
    for (const groupe of groupes) {
      if (!principal(groupe.materialIndex)) continue;
      const fin = Math.min(groupe.start + groupe.count, index ? index.count : position.count);
      for (let i = groupe.start; i < fin; i++) {
        const sommet = index ? index.getX(i) : i;
        this._sommet.fromBufferAttribute(position, sommet);
        boite.expandByPoint(this._sommet);
      }
    }

    this.boitesPrincipales.set(objet, boite);
    return boite;
  }

  // Is the point hidden behind the mesh? The cheap half of the answer comes
  // from the normal; this is the other half, for the concave cases — a point
  // on the far side of a fin faces the camera but is still behind the body.
  occulte(position, marge = 0.004) {
    const couche = this.coucheCible();
    if (!couche) return false;

    const origine = this.scene3d.camera.position;
    const direction = position.clone().sub(origine);
    const distance = direction.length();
    if (distance < 1e-6) return false;
    direction.divideScalar(distance);

    this.rayon.set(origine, direction);
    this.rayon.far = distance - marge;
    const touches = this.rayon.intersectObject(couche, true);
    this.rayon.far = Infinity;
    return touches.length > 0;
  }
}
