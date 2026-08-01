// Selecting regions of the mesh, and deriving their outline.
//
// This is the "logical and faithful" half of the tool. The magic wand is the
// same idea as tools_clean_fins.py, which already proved on this very mesh
// that propagation over the face graph separates the specimen's parts
// cleanly. The outline is not drawn at all: it is the boundary of the
// selection, so it follows the anatomy exactly, from every angle.

import * as THREE from 'three';

// Magic wand: flood fill from one face.
//
// Two conditions, both needed. The dihedral angle stops the spread at a real
// crease — the edge of a fin, the rim of the mount. The colour keeps it from
// running from tissue onto cloth where the two happen to meet smoothly.
export function baguette(analyse, depart, options) {
  const { angleMax, tolerance, maxFaces } = options;
  const cosMin = Math.cos(THREE.MathUtils.degToRad(angleMax));
  const couleurDepart = analyse.couleur(depart);
  const couleur = [0, 0, 0];

  const vus = new Uint8Array(analyse.nbFaces);
  const resultat = new Set();
  const pile = [depart];
  vus[depart] = 1;

  while (pile.length > 0 && resultat.size < maxFaces) {
    const face = pile.pop();
    resultat.add(face);

    for (const voisin of analyse.voisinsDe(face)) {
      if (vus[voisin]) continue;
      if (analyse.produitNormales(face, voisin) < cosMin) continue;

      if (couleurDepart && tolerance < 255) {
        const echantillon = analyse.couleur(voisin, couleur);
        if (echantillon) {
          const ecart = Math.max(
            Math.abs(echantillon[0] - couleurDepart[0]),
            Math.abs(echantillon[1] - couleurDepart[1]),
            Math.abs(echantillon[2] - couleurDepart[2]),
          );
          if (ecart > tolerance) continue;
        }
      }

      vus[voisin] = 1;
      pile.push(voisin);
    }
  }

  return resultat;
}

// Lasso: every face whose centre projects inside the drawn polygon.
// Back-facing triangles are skipped, so the lasso does not silently grab the
// far side of the specimen along with the near one.
export function lasso(analyse, polygone, camera, largeur, hauteur, options = {}) {
  const { traversant = false } = options;
  const resultat = new Set();
  const point = new THREE.Vector3();
  const versCamera = new THREE.Vector3();

  for (let f = 0; f < analyse.nbFaces; f++) {
    point.set(analyse.centres[f * 3], analyse.centres[f * 3 + 1], analyse.centres[f * 3 + 2]);

    if (!traversant) {
      versCamera.copy(camera.position).sub(point).normalize();
      const dot = versCamera.x * analyse.normales[f * 3]
        + versCamera.y * analyse.normales[f * 3 + 1]
        + versCamera.z * analyse.normales[f * 3 + 2];
      if (dot <= 0) continue;
    }

    point.project(camera);
    if (point.z > 1) continue;
    const x = (point.x * 0.5 + 0.5) * largeur;
    const y = (-point.y * 0.5 + 0.5) * hauteur;
    if (dansPolygone(x, y, polygone)) resultat.add(f);
  }

  return resultat;
}

function dansPolygone(x, y, polygone) {
  let dedans = false;
  for (let i = 0, j = polygone.length - 1; i < polygone.length; j = i++) {
    const xi = polygone[i].x;
    const yi = polygone[i].y;
    const xj = polygone[j].x;
    const yj = polygone[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/* -------------------------------------------------------------- booléens */

export function combiner(courante, nouvelle, mode) {
  if (mode === 'ajouter') return new Set([...courante, ...nouvelle]);
  if (mode === 'retirer') {
    const sortie = new Set(courante);
    for (const f of nouvelle) sortie.delete(f);
    return sortie;
  }
  if (mode === 'intersecter') {
    const sortie = new Set();
    for (const f of nouvelle) if (courante.has(f)) sortie.add(f);
    return sortie;
  }
  return nouvelle;
}

// Grows or shrinks the selection by one ring of faces. Useful right after a
// wand: a threshold that stops one face too early is fixed with one click.
export function dilaterSelection(analyse, selection, sens = 1) {
  if (sens > 0) {
    const sortie = new Set(selection);
    for (const face of selection) for (const v of analyse.voisinsDe(face)) sortie.add(v);
    return sortie;
  }
  const sortie = new Set();
  for (const face of selection) {
    let interieur = true;
    for (const v of analyse.voisinsDe(face)) if (!selection.has(v)) { interieur = false; break; }
    if (interieur) sortie.add(face);
  }
  return sortie;
}

// Morphological closing on the face graph. It fills holes no wider than one
// ring and removes one-face notches while preserving the region's overall
// footprint. Keeping it here gives the live selection and an already-created
// region exactly the same smoothing rule.
export function lisserSelection(analyse, selection, passages = 1) {
  let sortie = new Set(selection);
  const nombre = Math.max(1, Math.floor(passages));
  for (let i = 0; i < nombre; i++) {
    sortie = dilaterSelection(analyse, sortie, 1);
    sortie = dilaterSelection(analyse, sortie, -1);
  }
  return sortie;
}

/* --------------------------------------------------------------- contour */

// Boundary of a face set: every edge used by exactly one selected face.
//
// This is what makes the outline honest. It is not a hand-drawn ellipse
// floating near the specimen — it is the actual border of the chosen region,
// lying on the surface, correct from every viewpoint and correctly occluded.
export function frontiere(analyse, selection, decalage = 0) {
  const compte = new Map();

  for (const face of selection) {
    const s = analyse.sommets;
    const sommets = [s[face * 3], s[face * 3 + 1], s[face * 3 + 2]];
    const maillage = analyse.maillages[analyse.maillageDe[face]];
    for (let e = 0; e < 3; e++) {
      const u = sommets[e];
      const v = sommets[(e + 1) % 3];
      const cle = `${maillage.decalage}:${Math.min(u, v)}_${Math.max(u, v)}`;
      const entree = compte.get(cle);
      if (entree) entree.n += 1;
      else compte.set(cle, { n: 1, u, v, maillage, face });
    }
  }

  const segments = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const normale = new THREE.Vector3();
  for (const { n, u, v, maillage, face } of compte.values()) {
    if (n !== 1) continue;
    const position = maillage.objet.geometry.attributes.position;
    a.fromBufferAttribute(position, u).applyMatrix4(maillage.objet.matrixWorld);
    b.fromBufferAttribute(position, v).applyMatrix4(maillage.objet.matrixWorld);
    // Lifted a fraction of a millimetre off the surface: drawn exactly on it,
    // the line would fight the mesh for depth and break into dashes.
    if (decalage !== 0) {
      analyse.normale(face, normale).multiplyScalar(decalage);
      a.add(normale);
      b.add(normale);
    }
    segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return segments;
}

/* ------------------------------------------------------------- géométrie */

// Builds a mesh holding only the selected faces, in UV space or in world
// space depending on what it is for.
export function geometrieSelection(analyse, selection) {
  const positions = new Float32Array(selection.size * 9);
  const uvs = new Float32Array(selection.size * 6);
  const normales = new Float32Array(selection.size * 9);

  const point = new THREE.Vector3();
  let k = 0;
  for (const face of selection) {
    const maillage = analyse.maillages[analyse.maillageDe[face]];
    const geometrie = maillage.objet.geometry;
    const position = geometrie.attributes.position;
    const coord = geometrie.attributes.uv;
    const s = analyse.sommets;

    for (let c = 0; c < 3; c++) {
      const indice = s[face * 3 + c];
      point.fromBufferAttribute(position, indice).applyMatrix4(maillage.objet.matrixWorld);
      positions[k * 3] = point.x;
      positions[k * 3 + 1] = point.y;
      positions[k * 3 + 2] = point.z;
      normales[k * 3] = analyse.normales[face * 3];
      normales[k * 3 + 1] = analyse.normales[face * 3 + 1];
      normales[k * 3 + 2] = analyse.normales[face * 3 + 2];
      if (coord) {
        uvs[k * 2] = coord.getX(indice);
        uvs[k * 2 + 1] = coord.getY(indice);
      }
      k++;
    }
  }

  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometrie.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
  geometrie.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometrie;
}

/* ------------------------------------------------- transfert entre sessions */

// A region is stored as face indices, which only mean something on the mesh it
// was drawn on. To show it on another capture, faces are matched by position:
// the meshes differ, but they were aligned into the same space, so a face here
// has a counterpart within a few millimetres there.
export function transferer(selection, analyseSource, grilleCible, seuil) {
  const resultat = new Set();
  const seuilCarre = seuil * seuil;
  // A nearby face on the opposite side of a thin fin is spatially plausible
  // but anatomically wrong. Seventy degrees leaves room for differences
  // between photogrammetry sessions while rejecting those folded/opposite
  // surfaces.
  const cosAngleMax = Math.cos(THREE.MathUtils.degToRad(70));
  const analyseCible = grilleCible.analyse;

  for (const face of selection) {
    const x = analyseSource.centres[face * 3];
    const y = analyseSource.centres[face * 3 + 1];
    const z = analyseSource.centres[face * 3 + 2];
    const nx = analyseSource.normales[face * 3];
    const ny = analyseSource.normales[face * 3 + 1];
    const nz = analyseSource.normales[face * 3 + 2];

    let meilleure = -1;
    let meilleureDistance = seuilCarre;

    for (const candidat of grilleCible.autour(x, y, z)) {
      const dot = nx * analyseCible.normales[candidat * 3]
        + ny * analyseCible.normales[candidat * 3 + 1]
        + nz * analyseCible.normales[candidat * 3 + 2];
      if (dot < cosAngleMax) continue;

      const dx = analyseCible.centres[candidat * 3] - x;
      const dy = analyseCible.centres[candidat * 3 + 1] - y;
      const dz = analyseCible.centres[candidat * 3 + 2] - z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance > meilleureDistance) continue;
      meilleureDistance = distance;
      meilleure = candidat;
    }

    // One source triangle represents one place on the specimen. Adding every
    // triangle inside a radius made a selection inflate unpredictably from
    // one session to the next, especially near fins and tissue folds.
    if (meilleure >= 0) resultat.add(meilleure);
  }

  return resultat;
}
