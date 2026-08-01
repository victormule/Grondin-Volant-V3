// Mesh analysis: what is next to what, and what colour it is.
//
// Selecting a region by hand would be tedious and imprecise. Selecting it by
// *propagation* — start on a face, spread to its neighbours while they stay
// coplanar enough and similar enough in colour — follows the anatomy on its
// own and stops at real edges. That needs an adjacency graph, which a glTF
// does not carry, so it is built here, once per mesh.

import * as THREE from 'three';

// Vertices are duplicated along UV seams: same point in space, different
// index. Adjacency has to be computed on welded positions, or every seam
// would look like a hole and stop the propagation dead.
const PRECISION_SOUDURE = 1e5;

// Base texture is sampled through a downscaled copy. The real one is 4k or
// more — 67 MB of pixel data to hold in JavaScript for a colour comparison
// that tolerates a few percent anyway.
const TAILLE_ECHANTILLON = 1024;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class AnalyseModele {
  constructor(racine) {
    this.racine = racine;
    this.maillages = [];
    this.nbFaces = 0;

    racine.updateMatrixWorld(true);
    racine.traverse((objet) => {
      if (!objet.isMesh || !objet.geometry?.attributes.position) return;
      this.maillages.push({ objet, decalage: this.nbFaces, nb: nombreDeFaces(objet.geometry) });
      this.nbFaces += nombreDeFaces(objet.geometry);
    });

    this._construire();
    this.areteMediane = this._areteMediane();
    this._toile = null;
    this._pixels = null;
  }

  // Characteristic size of a face. Everything that has to match one mesh
  // against another is expressed as a multiple of this rather than as an
  // absolute distance: on this specimen the median edge is over two
  // centimetres, so a threshold chosen from the 5 mm registration residual
  // would be far smaller than a single triangle and match nothing.
  _areteMediane() {
    const longueurs = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let f = 0; f < this.nbFaces; f += 7) {
      const maillage = this.maillages[this.maillageDe[f]];
      const position = maillage.objet.geometry.attributes.position;
      const s = this.sommets;
      a.fromBufferAttribute(position, s[f * 3]).applyMatrix4(maillage.objet.matrixWorld);
      b.fromBufferAttribute(position, s[f * 3 + 1]).applyMatrix4(maillage.objet.matrixWorld);
      c.fromBufferAttribute(position, s[f * 3 + 2]).applyMatrix4(maillage.objet.matrixWorld);
      longueurs.push((a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(a)) / 3);
    }
    if (longueurs.length === 0) return 0.01;
    longueurs.sort((x, y) => x - y);
    return longueurs[Math.floor(longueurs.length / 2)];
  }

  _construire() {
    const n = this.nbFaces;
    this.centres = new Float32Array(n * 3);
    this.normales = new Float32Array(n * 3);
    this.uv = new Float32Array(n * 2);
    this.uvValide = new Uint8Array(n);
    this.sommets = new Int32Array(n * 3);
    this.maillageDe = new Int32Array(n);
    // World area of each face, in m². Free to compute here — the cross product
    // whose length it is has to be taken anyway for the normal.
    this.aires = new Float32Array(n);
    // Welded vertex id of each face corner, and the position of each welded
    // vertex. Both are needed to walk from face to face across shared edges,
    // which is how a distance « over the surface » is measured.
    this.soudes = new Int32Array(n * 3);
    const positionsSoudees = [];

    const cle = new Map();
    const aretes = new Map();
    this.voisinsDebut = new Int32Array(n + 1);
    const listeVoisins = [];
    const parFace = Array.from({ length: n }, () => []);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normale = new THREE.Vector3();

    for (let m = 0; m < this.maillages.length; m++) {
      const { objet, decalage, nb } = this.maillages[m];
      const geometrie = objet.geometry;
      const position = geometrie.attributes.position;
      const coord = geometrie.attributes.uv;
      const index = geometrie.index;
      const matrice = objet.matrixWorld;

      for (let f = 0; f < nb; f++) {
        const global = decalage + f;
        this.maillageDe[global] = m;

        const i0 = index ? index.getX(f * 3) : f * 3;
        const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
        const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
        this.sommets[global * 3] = i0;
        this.sommets[global * 3 + 1] = i1;
        this.sommets[global * 3 + 2] = i2;

        a.fromBufferAttribute(position, i0).applyMatrix4(matrice);
        b.fromBufferAttribute(position, i1).applyMatrix4(matrice);
        c.fromBufferAttribute(position, i2).applyMatrix4(matrice);

        this.centres[global * 3] = (a.x + b.x + c.x) / 3;
        this.centres[global * 3 + 1] = (a.y + b.y + c.y) / 3;
        this.centres[global * 3 + 2] = (a.z + b.z + c.z) / 3;

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        normale.crossVectors(ab, ac);
        this.aires[global] = normale.length() / 2;
        normale.normalize();
        this.normales[global * 3] = normale.x;
        this.normales[global * 3 + 1] = normale.y;
        this.normales[global * 3 + 2] = normale.z;

        if (coord) {
          this.uvValide[global] = 1;
          this.uv[global * 2] = (coord.getX(i0) + coord.getX(i1) + coord.getX(i2)) / 3;
          this.uv[global * 2 + 1] = (coord.getY(i0) + coord.getY(i1) + coord.getY(i2)) / 3;
        }

        // Welded indices, then one entry per edge.
        const soudes = [a, b, c].map((point) => {
          const k = `${Math.round(point.x * PRECISION_SOUDURE)},`
            + `${Math.round(point.y * PRECISION_SOUDURE)},`
            + `${Math.round(point.z * PRECISION_SOUDURE)}`;
          let id = cle.get(k);
          if (id === undefined) {
            id = cle.size;
            cle.set(k, id);
            positionsSoudees.push(point.x, point.y, point.z);
          }
          return id;
        });
        this.soudes[global * 3] = soudes[0];
        this.soudes[global * 3 + 1] = soudes[1];
        this.soudes[global * 3 + 2] = soudes[2];

        for (let e = 0; e < 3; e++) {
          const u = soudes[e];
          const v = soudes[(e + 1) % 3];
          const k = u < v ? `${u}_${v}` : `${v}_${u}`;
          const liste = aretes.get(k);
          if (liste) liste.push(global); else aretes.set(k, [global]);
        }
      }
    }

    this.aretes = aretes;
    this.positionsSoudees = new Float32Array(positionsSoudees);
    for (const faces of aretes.values()) {
      if (faces.length < 2) continue;
      for (const f of faces) {
        for (const g of faces) if (g !== f) parFace[f].push(g);
      }
    }

    // Flattened adjacency: one big array plus offsets, rather than 25 000
    // little arrays.
    let total = 0;
    for (let f = 0; f < n; f++) { this.voisinsDebut[f] = total; total += parFace[f].length; }
    this.voisinsDebut[n] = total;
    this.voisins = new Int32Array(total);
    let curseur = 0;
    for (let f = 0; f < n; f++) for (const g of parFace[f]) this.voisins[curseur++] = g;
  }

  * voisinsDe(face) {
    for (let i = this.voisinsDebut[face]; i < this.voisinsDebut[face + 1]; i++) {
      yield this.voisins[i];
    }
  }

  centre(face, cible = new THREE.Vector3()) {
    return cible.set(this.centres[face * 3], this.centres[face * 3 + 1], this.centres[face * 3 + 2]);
  }

  // The three corners of a face, in world space.
  sommetsMonde(face, a, b, c) {
    const maillage = this.maillages[this.maillageDe[face]];
    const position = maillage.objet.geometry.attributes.position;
    const m = maillage.objet.matrixWorld;
    a.fromBufferAttribute(position, this.sommets[face * 3]).applyMatrix4(m);
    b.fromBufferAttribute(position, this.sommets[face * 3 + 1]).applyMatrix4(m);
    c.fromBufferAttribute(position, this.sommets[face * 3 + 2]).applyMatrix4(m);
  }

  normale(face, cible = new THREE.Vector3()) {
    return cible.set(this.normales[face * 3], this.normales[face * 3 + 1], this.normales[face * 3 + 2]);
  }

  produitNormales(a, b) {
    return this.normales[a * 3] * this.normales[b * 3]
      + this.normales[a * 3 + 1] * this.normales[b * 3 + 1]
      + this.normales[a * 3 + 2] * this.normales[b * 3 + 2];
  }

  positionSoudee(id, cible = new THREE.Vector3()) {
    return cible.set(this.positionsSoudees[id * 3], this.positionsSoudees[id * 3 + 1],
      this.positionsSoudees[id * 3 + 2]);
  }

  // Midpoint of the edge two adjacent faces share, in world space. A path that
  // crosses the mesh through these points is far closer to a true geodesic
  // than one that hops from centroid to centroid: the centroid path zigzags
  // and comes out several percent too long.
  milieuArete(f, g, cible = new THREE.Vector3()) {
    const communs = [];
    for (let i = 0; i < 3; i++) {
      const s = this.soudes[f * 3 + i];
      for (let j = 0; j < 3; j++) if (this.soudes[g * 3 + j] === s) { communs.push(s); break; }
    }
    if (communs.length < 2) return null;
    const a = this.positionSoudee(communs[0], _a);
    const b = this.positionSoudee(communs[1], _b);
    return cible.copy(a).add(b).multiplyScalar(0.5);
  }

  // Edges used by exactly one face. None means the surface is closed, which is
  // the condition under which a volume means anything at all.
  get aretesDeBord() {
    if (this._aretesDeBord === undefined) {
      let n = 0;
      for (const faces of this.aretes.values()) if (faces.length === 1) n += 1;
      this._aretesDeBord = n;
    }
    return this._aretesDeBord;
  }

  // Global face index from a raycast hit.
  faceDepuisTouche(touche) {
    const entree = this.maillages.find((m) => m.objet === touche.object);
    if (!entree || !touche.face) return -1;
    const geometrie = touche.object.geometry;
    const local = geometrie.index ? touche.faceIndex : touche.faceIndex;
    return entree.decalage + local;
  }

  /* -------------------------------------------------------------- couleur */

  _preparerTexture() {
    if (this._pixels !== null || this._pixels === false) return;
    const carte = this.maillages[0]?.objet.material?.map
      ?? (Array.isArray(this.maillages[0]?.objet.material)
        ? this.maillages[0].objet.material[0]?.map : null);
    const image = carte?.image;
    if (!image) { this._pixels = false; return; }

    try {
      const toile = document.createElement('canvas');
      toile.width = TAILLE_ECHANTILLON;
      toile.height = TAILLE_ECHANTILLON;
      const ctx = toile.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, TAILLE_ECHANTILLON, TAILLE_ECHANTILLON);
      this._pixels = ctx.getImageData(0, 0, TAILLE_ECHANTILLON, TAILLE_ECHANTILLON).data;
      this._retourne = carte.flipY !== false;
    } catch (erreur) {
      console.warn('Texture de base illisible : la baguette ignorera la couleur.', erreur);
      this._pixels = false;
    }
  }

  couleur(face, sortie = [0, 0, 0]) {
    this._preparerTexture();
    if (!this._pixels) return null;
    let u = this.uv[face * 2] % 1;
    let v = this.uv[face * 2 + 1] % 1;
    if (u < 0) u += 1;
    if (v < 0) v += 1;
    if (this._retourne) v = 1 - v;
    const x = Math.min(TAILLE_ECHANTILLON - 1, Math.floor(u * TAILLE_ECHANTILLON));
    const y = Math.min(TAILLE_ECHANTILLON - 1, Math.floor(v * TAILLE_ECHANTILLON));
    const i = (y * TAILLE_ECHANTILLON + x) * 4;
    sortie[0] = this._pixels[i];
    sortie[1] = this._pixels[i + 1];
    sortie[2] = this._pixels[i + 2];
    return sortie;
  }
}

function nombreDeFaces(geometrie) {
  return (geometrie.index ? geometrie.index.count : geometrie.attributes.position.count) / 3;
}

// Spatial hash over face centres, used to carry a region from one capture to
// another: the meshes differ, but they occupy the same space.
export class GrilleFaces {
  constructor(analyse, taille) {
    this.analyse = analyse;
    this.taille = taille;
    this.cases = new Map();
    for (let f = 0; f < analyse.nbFaces; f++) {
      const k = this._cle(analyse.centres[f * 3], analyse.centres[f * 3 + 1], analyse.centres[f * 3 + 2]);
      const liste = this.cases.get(k);
      if (liste) liste.push(f); else this.cases.set(k, [f]);
    }
  }

  _cle(x, y, z) {
    return `${Math.floor(x / this.taille)},${Math.floor(y / this.taille)},${Math.floor(z / this.taille)}`;
  }

  autour(x, y, z) {
    const sortie = [];
    const cx = Math.floor(x / this.taille);
    const cy = Math.floor(y / this.taille);
    const cz = Math.floor(z / this.taille);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const liste = this.cases.get(`${cx + i},${cy + j},${cz + k}`);
          if (liste) sortie.push(...liste);
        }
      }
    }
    return sortie;
  }
}
