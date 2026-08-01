// Exact measurements on the mesh itself.
//
// Everything here is computed from triangles and edges, not from pixels: an
// area is a sum of triangle areas, a perimeter is a sum of edge lengths. No
// sampling, no threshold, nothing to calibrate. That is what makes these the
// reference the raster measurements in rasterisation.js are checked against.

import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _croix = new THREE.Vector3();

/* ------------------------------------------------------------------ aire */

export function aireFaces(analyse, faces) {
  let total = 0;
  for (const f of faces) total += analyse.aires[f];
  return total;
}

export function aireModele(analyse) {
  let total = 0;
  for (let f = 0; f < analyse.nbFaces; f++) total += analyse.aires[f];
  return total;
}

/* ------------------------------------------------------------- frontière */

// Boundary of a face set, as directed edges in the winding of the face that
// owns them. Welded vertex ids, so a UV seam running through the region does
// not look like a border.
export function aretesFrontiere(analyse, faces) {
  const compte = new Map();
  for (const f of faces) {
    for (let e = 0; e < 3; e++) {
      const u = analyse.soudes[f * 3 + e];
      const v = analyse.soudes[f * 3 + (e + 1) % 3];
      const cle = u < v ? `${u}_${v}` : `${v}_${u}`;
      const entree = compte.get(cle);
      if (entree) entree.n += 1;
      else compte.set(cle, { n: 1, u, v });
    }
  }
  const bord = [];
  for (const entree of compte.values()) if (entree.n === 1) bord.push(entree);
  return bord;
}

export function perimetreFaces(analyse, faces) {
  let total = 0;
  for (const { u, v } of aretesFrontiere(analyse, faces)) {
    analyse.positionSoudee(u, _a);
    analyse.positionSoudee(v, _b);
    total += _a.distanceTo(_b);
  }
  return total;
}

// Chains the boundary edges into closed loops. The count matters: a region
// with one loop is a patch that can be capped and given a volume; a region
// with five loops has holes in it, and any volume would be arbitrary.
export function bouclesFrontiere(analyse, faces) {
  const bord = aretesFrontiere(analyse, faces);
  const sortants = new Map();
  for (const arete of bord) {
    const liste = sortants.get(arete.u);
    if (liste) liste.push(arete); else sortants.set(arete.u, [arete]);
  }

  const restants = new Set(bord);
  const boucles = [];
  let ouverte = false;

  for (const depart of bord) {
    if (!restants.has(depart)) continue;
    const boucle = [];
    let arete = depart;
    while (arete && restants.has(arete)) {
      restants.delete(arete);
      boucle.push(arete);
      const suivantes = sortants.get(arete.v);
      arete = suivantes?.find((candidate) => restants.has(candidate)) ?? null;
    }
    if (boucle.length > 0) {
      if (boucle.at(-1).v !== boucle[0].u) ouverte = true;
      boucles.push(boucle);
    }
  }

  return { boucles, ouverte };
}

/* ---------------------------------------------------------------- volume */

// Volume enclosed by a closed triangle soup, by the divergence theorem:
// six times the volume is the sum of the scalar triple products. It only
// means something if the surface really is closed — hence every caller here
// checks that first and says so when it is not.
function volumeTriangles(triangles) {
  let six = 0;
  for (const [a, b, c] of triangles) six += a.dot(_croix.crossVectors(b, c));
  return Math.abs(six) / 6;
}

export function volumeModele(analyse) {
  let six = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let f = 0; f < analyse.nbFaces; f++) {
    analyse.sommetsMonde(f, a, b, c);
    six += a.dot(_croix.crossVectors(b, c));
  }
  return {
    volume: Math.abs(six) / 6,
    aretesDeBord: analyse.aretesDeBord,
    ferme: analyse.aretesDeBord === 0,
  };
}

// Volume of a patch closed by flat-ish caps: every boundary loop is filled
// with a fan to its own centroid, and the resulting closed surface is
// integrated.
//
// This measures the bulge — how much the region stands out from, or sinks
// below, the plane its own border spans. It is a real number with a clear
// meaning, but it is NOT « the volume of the fin »: it depends on where you
// chose to stop, because that is what defines the lids. A band around a body
// naturally has two loops, one at each end: capping both gives the volume of
// the enclosed segment. Extra closed loops are treated the same way. Only an
// actually open/branching boundary is not measurable.
export function volumePatch(analyse, faces) {
  const { boucles, ouverte } = bouclesFrontiere(analyse, faces);
  if (ouverte) {
    return { volume: null, boucles: boucles.length, ouverte };
  }

  const triangles = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const f of faces) {
    analyse.sommetsMonde(f, a, b, c);
    triangles.push([a.clone(), b.clone(), c.clone()]);
  }

  for (const boucle of boucles) {
    const centre = new THREE.Vector3();
    for (const { u } of boucle) centre.add(analyse.positionSoudee(u, _a));
    centre.divideScalar(boucle.length);

    // Wound the other way round from the patch edge it closes, so each cap
    // faces outwards — including the two opposite ends of an annular band.
    for (const { u, v } of boucle) {
      triangles.push([
        analyse.positionSoudee(v, _a).clone(),
        analyse.positionSoudee(u, _b).clone(),
        centre.clone(),
      ]);
    }
  }

  return { volume: volumeTriangles(triangles), boucles: boucles.length, ouverte: false };
}

/* --------------------------------------------------------- chemin de surface */

// Shortest path from one face to another across the mesh, for a distance
// measured « over the surface » rather than through the air.
//
// A* over the face graph, weighted by centroid distance and guided by the
// straight-line distance to the destination. The heuristic never overstates
// the remaining graph distance, so the route is the same as Dijkstra's while
// visiting far fewer irrelevant faces during a live preview. The path is then
// re-read through the midpoints of the edges it crosses. That second step
// matters — a polyline joining centroids zigzags from triangle to triangle and
// comes out several percent long, while the edge crossings sit on the real
// path. The route itself is still chosen on centroid distance, so the result
// is a good estimate of the geodesic rather than the geodesic itself.
export function cheminSurface(analyse, faceDepart, pointDepart, faceArrivee, pointArrivee,
  maxFaces = 200000) {
  if (faceDepart === faceArrivee) {
    return { points: [pointDepart.clone(), pointArrivee.clone()],
      longueur: pointDepart.distanceTo(pointArrivee), complet: true };
  }

  const n = analyse.nbFaces;
  const cout = new Float64Array(n).fill(Infinity);
  const venantDe = new Int32Array(n).fill(-1);
  const fige = new Uint8Array(n);
  const tas = new TasMin();
  const cibleX = analyse.centres[faceArrivee * 3];
  const cibleY = analyse.centres[faceArrivee * 3 + 1];
  const cibleZ = analyse.centres[faceArrivee * 3 + 2];
  const heuristique = (face) => {
    const dx = analyse.centres[face * 3] - cibleX;
    const dy = analyse.centres[face * 3 + 1] - cibleY;
    const dz = analyse.centres[face * 3 + 2] - cibleZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  cout[faceDepart] = 0;
  tas.pousser(faceDepart, heuristique(faceDepart));
  let visitees = 0;

  while (tas.taille > 0 && visitees < maxFaces) {
    const face = tas.retirer();
    if (fige[face]) continue;
    fige[face] = 1;
    visitees += 1;
    if (face === faceArrivee) break;

    const cx = analyse.centres[face * 3];
    const cy = analyse.centres[face * 3 + 1];
    const cz = analyse.centres[face * 3 + 2];

    for (const voisin of analyse.voisinsDe(face)) {
      if (fige[voisin]) continue;
      const dx = analyse.centres[voisin * 3] - cx;
      const dy = analyse.centres[voisin * 3 + 1] - cy;
      const dz = analyse.centres[voisin * 3 + 2] - cz;
      const candidat = cout[face] + Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (candidat >= cout[voisin]) continue;
      cout[voisin] = candidat;
      venantDe[voisin] = face;
      tas.pousser(voisin, candidat + heuristique(voisin));
    }
  }

  if (!fige[faceArrivee]) return { points: null, longueur: null, complet: false };

  const suite = [faceArrivee];
  for (let f = faceArrivee; venantDe[f] !== -1; f = venantDe[f]) suite.push(venantDe[f]);
  suite.reverse();

  const points = [pointDepart.clone()];
  for (let i = 0; i < suite.length - 1; i++) {
    const milieu = analyse.milieuArete(suite[i], suite[i + 1], new THREE.Vector3());
    if (milieu) points.push(milieu);
  }
  points.push(pointArrivee.clone());

  let longueur = 0;
  for (let i = 0; i < points.length - 1; i++) longueur += points[i].distanceTo(points[i + 1]);
  return { points, longueur, complet: true };
}

// Binary heap. Lazy deletion — a face can be pushed several times and the
// stale entries are skipped by the `fige` test above.
class TasMin {
  constructor() {
    this.elements = [];
    this.priorites = [];
  }

  get taille() {
    return this.elements.length;
  }

  pousser(element, priorite) {
    this.elements.push(element);
    this.priorites.push(priorite);
    let i = this.elements.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorites[parent] <= this.priorites[i]) break;
      this._echanger(parent, i);
      i = parent;
    }
  }

  retirer() {
    const sommet = this.elements[0];
    const dernier = this.elements.length - 1;
    this._echanger(0, dernier);
    this.elements.pop();
    this.priorites.pop();

    let i = 0;
    for (;;) {
      const g = i * 2 + 1;
      const d = g + 1;
      let plusPetit = i;
      if (g < this.elements.length && this.priorites[g] < this.priorites[plusPetit]) plusPetit = g;
      if (d < this.elements.length && this.priorites[d] < this.priorites[plusPetit]) plusPetit = d;
      if (plusPetit === i) break;
      this._echanger(i, plusPetit);
      i = plusPetit;
    }
    return sommet;
  }

  _echanger(i, j) {
    [this.elements[i], this.elements[j]] = [this.elements[j], this.elements[i]];
    [this.priorites[i], this.priorites[j]] = [this.priorites[j], this.priorites[i]];
  }
}
