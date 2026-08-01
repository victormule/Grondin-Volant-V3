// The path a measurement follows between two points.
//
// Two answers, and they are different questions rather than two qualities of
// the same one:
//
//   « droite »  — the straight line through space. What a caliper reads.
//   « surface » — the shortest way across the mesh. What a tape measure laid
//                 on the specimen reads.
//
// On a body as curved as this one the two differ by a lot, so the mode is part
// of the measurement and is written down with it.

import * as THREE from 'three';
import { cheminSurface } from './geometrie.js';

// Points are stored in the shared frame, never as face indices: that is what
// lets a measurement taken on session 1 be re-walked across session 3's mesh.
// The face is found back here, from the position.
export function faceLaPlusProche(entree, point) {
  const { analyse, grille } = entree;
  let meilleure = -1;
  let meilleurEcart = Infinity;

  const examiner = (f) => {
    const dx = analyse.centres[f * 3] - point.x;
    const dy = analyse.centres[f * 3 + 1] - point.y;
    const dz = analyse.centres[f * 3 + 2] - point.z;
    const ecart = dx * dx + dy * dy + dz * dz;
    if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleure = f; }
  };

  for (const f of grille.autour(point.x, point.y, point.z)) examiner(f);
  if (meilleure >= 0) return meilleure;

  // The spatial hash only looks one cell around. A point that landed in an
  // empty neighbourhood — the tip of a fin, a hole in the capture — falls back
  // to a full sweep rather than to no measurement at all.
  for (let f = 0; f < analyse.nbFaces; f++) examiner(f);
  return meilleure;
}

export function trajet(entree, points, mode) {
  const segments = [];
  let longueur = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    let segment = null;

    if (mode === 'surface' && entree) {
      const depart = faceLaPlusProche(entree, a);
      const arrivee = faceLaPlusProche(entree, b);
      if (depart >= 0 && arrivee >= 0) {
        const chemin = cheminSurface(entree.analyse, depart, a, arrivee, b);
        if (chemin.complet) segment = { points: chemin.points, longueur: chemin.longueur };
      }
    }

    // Straight line, and also the fallback when the two points sit on parts of
    // the mesh that are not connected to each other.
    if (!segment) {
      segment = { points: [a.clone(), b.clone()], longueur: a.distanceTo(b), droite: true };
    }

    segments.push(segment);
    longueur += segment.longueur;
  }

  return { segments, longueur };
}

// Point half way along a polyline, measured by arc length rather than by index
// — a label placed at the middle vertex of a bendy path sits anywhere but the
// middle.
export function milieuTrajet(points, cible = new THREE.Vector3()) {
  if (points.length === 0) return cible;
  if (points.length === 1) return cible.copy(points[0]);

  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += points[i].distanceTo(points[i + 1]);

  let parcouru = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const pas = points[i].distanceTo(points[i + 1]);
    if (parcouru + pas >= total / 2) {
      const part = pas < 1e-9 ? 0 : (total / 2 - parcouru) / pas;
      return cible.lerpVectors(points[i], points[i + 1], part);
    }
    parcouru += pas;
  }
  return cible.copy(points.at(-1));
}
