// model-viewer's "neutral" environment, ported so the lighting is identical
// to the old viewer's rather than merely similar.
//
// Adapted from @google/model-viewer, lib/three-components/EnvironmentScene.js
// Copyright 2021 Google LLC — Apache License 2.0
// http://www.apache.org/licenses/LICENSE-2.0
//
// Why port the scene rather than ship a baked equirectangular image: the light
// panels below have intensities up to 400. An 8-bit image would clip them to
// white and flatten every highlight on the specimen, and an .hdr file would
// mean an extra loader plus a 1 MB download. The scene is a few dozen numbers.

import * as THREE from 'three';

const NEUTRE = {
  lumiereHaute: { intensite: 400, position: [0.5, 14.0, 0.5] },
  piece: { position: [0.0, 13.2, 0.0], echelle: [31.5, 28.5, 31.5] },
  boites: [
    { position: [-10.906, -1.0, 1.846], rotation: -0.195, echelle: [2.328, 7.905, 4.651] },
    { position: [-5.607, -0.754, -0.758], rotation: 0.994, echelle: [1.970, 1.534, 3.955] },
    { position: [6.167, -0.16, 7.803], rotation: 0.561, echelle: [3.927, 6.285, 3.687] },
    { position: [-2.017, 0.018, 6.124], rotation: 0.333, echelle: [2.002, 4.566, 2.064] },
    { position: [2.291, -0.756, -2.621], rotation: -0.286, echelle: [1.546, 1.552, 1.496] },
    { position: [-2.193, -0.369, -5.547], rotation: 0.516, echelle: [3.875, 3.487, 2.986] },
  ],
  panneaux: [
    { intensite: 80, position: [-14.0, 10.0, 8.0], echelle: [0.1, 2.5, 2.5] },
    { intensite: 80, position: [-14.0, 14.0, -4.0], echelle: [0.1, 2.5, 2.5] },
    { intensite: 23, position: [14.0, 12.0, 0.0], echelle: [0.1, 5.0, 5.0] },
    { intensite: 16, position: [0.0, 9.0, 14.0], echelle: [5.0, 5.0, 0.1] },
    { intensite: 80, position: [7.0, 8.0, -14.0], echelle: [2.5, 2.5, 0.1] },
    { intensite: 80, position: [-7.0, 16.0, -14.0], echelle: [2.5, 2.5, 0.1] },
    { intensite: 1, position: [0.0, 20.0, 0.0], echelle: [0.1, 0.1, 0.1] },
  ],
};

export function construireEnvironnementNeutre() {
  const scene = new THREE.Scene();
  scene.position.y = -3.5;

  const geometrie = new THREE.BoxGeometry();
  geometrie.deleteAttribute('uv');

  const matiereePiece = new THREE.MeshStandardMaterial({ metalness: 0, side: THREE.BackSide });
  const matiereBoite = new THREE.MeshStandardMaterial({ metalness: 0 });

  const lumiere = new THREE.PointLight(0xffffff, NEUTRE.lumiereHaute.intensite, 28, 2);
  lumiere.position.set(...NEUTRE.lumiereHaute.position);
  scene.add(lumiere);

  const piece = new THREE.Mesh(geometrie, matiereePiece);
  piece.position.set(...NEUTRE.piece.position);
  piece.scale.set(...NEUTRE.piece.echelle);
  scene.add(piece);

  for (const boite of NEUTRE.boites) {
    const maille = new THREE.Mesh(geometrie, matiereBoite);
    maille.position.set(...boite.position);
    maille.rotation.set(0, boite.rotation, 0);
    maille.scale.set(...boite.echelle);
    scene.add(maille);
  }

  // Area lights are plain emissive boxes: a basic material whose colour is far
  // above 1. That is what makes the environment high dynamic range.
  for (const panneau of NEUTRE.panneaux) {
    const matiere = new THREE.MeshBasicMaterial();
    matiere.color.setScalar(panneau.intensite);
    const maille = new THREE.Mesh(geometrie, matiere);
    maille.position.set(...panneau.position);
    maille.scale.set(...panneau.echelle);
    scene.add(maille);
  }

  return scene;
}
