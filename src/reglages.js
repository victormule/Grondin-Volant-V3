// Merges the user's config.js on top of the built-in defaults. Keeping the
// defaults here (rather than in index.html, as before) means config.js can
// stay a partial file: anything the user leaves out simply falls back.

const defauts = {
  light: {
    intensity: 1,
    intensityMin: 0.4,
    intensityMax: 2,
    mode: 'fixe',
    souris: { ambiance: 0.62, intensiteSource: 1, tailleSource: 0.22 },
  },
  matiere: { rugosite: 0.62, metal: 0, opacite: 1 },
  ombre: { intensite: 0.7, douceur: 0.8, taillePlan: 1.8, hauteur: 0.7 },
  fond: {
    couleur: '#ecebe7',
    palette: ['#ecebe7', '#ffffff', '#3a352c', '#151515', '#0c1b2e'],
  },
  affichage: {
    panneauOuvert: true,
    panneauCalquesOuvert: true,
    vitesseRotation: 18,
    opaciteComposite: 'auto',
  },
  camera: {
    champVision: 30, marge: 1.22, distanceMin: 0.4, distanceMax: 14, amortissement: 0.08,
  },
  rendu: { tonemapping: 'neutre', densitePixelsMax: 2, lissage: true },
  couleurs: [
    '#c9553d', '#d99a35', '#c8b23f', '#4f9066', '#3d7ab8',
    '#8360b8', '#b8508a', '#7a6a5d', '#2b2b28', '#f2f1ec',
  ],
  peinture: {
    resolutionAtlas: 2048,
    taille: 20,
    tailleGomme: 24,
    tailleMin: 1,
    tailleMax: 80,
    durete: 0.55,
    seuilNormale: 0,
    espacement: 0.25,
    dilatations: 2,
  },
  mesure: {
    mode: 'droite',
    longueurModeleReference: 0.59,
    longueurReelleReference: 0.19,
    resolution: 1024,
    eviterCoutures: true,
    epaisseur: 2,
  },
  selection: {
    angleMax: 32,
    tolerance: 42,
    maxFaces: 40000,
    lassoTraversant: false,
    facteurTransfert: 0.6,
    epaisseurContour: 3,
    decalageContour: 0.0004,
    couleurApercu: '#2f6fd0',
    opaciteApercu: 0.45,
  },
};

function fusionner(base, ajout) {
  const sortie = { ...base };
  for (const [cle, valeur] of Object.entries(ajout || {})) {
    if (valeur === undefined) continue;
    const actuel = base[cle];
    const objets = valeur && typeof valeur === 'object' && !Array.isArray(valeur)
      && actuel && typeof actuel === 'object' && !Array.isArray(actuel);
    sortie[cle] = objets ? fusionner(actuel, valeur) : valeur;
  }
  return sortie;
}

export const config = fusionner(defauts, window.VIEWER_CONFIG || {});

// Merges one object's settings into the exported object IN PLACE.
//
// config.js now holds only what every object shares; an object's own manifest
// carries what is true of it alone — its scale calibration, its opening view,
// its brush size in millimetres on a surface that is not the same size as the
// last one.
//
// It has to mutate rather than replace. Every module holds `config` by
// reference, and a good many read it as they are imported: the light sliders,
// the background palette, the measurement scale are all wired up while app.js
// is still being evaluated. Handing out a new object here would leave all of
// them reading the defaults for ever. amorce.js guarantees this runs before
// app.js is imported at all.
export function appliquer(reglages) {
  const fusionne = fusionner(config, reglages ?? {});
  for (const cle of Object.keys(config)) delete config[cle];
  Object.assign(config, fusionne);
  return config;
}
