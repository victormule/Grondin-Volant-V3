// Mesure le résidu d'alignement d'un objet DÉJÀ ingéré, et réécrit son
// _recalage.json.
//
//   node outils/mesurer-recalage.mjs dactylopterus
//
// À quoi cela sert : ingerer.mjs écrit ce résidu au moment où il recale, mais
// un objet peut avoir été aligné autrement — le grondin l'a été à la main, par
// un script qui n'est plus là, et son fichier portait un chiffre calculé selon
// une autre méthode. Deux objets dont les incertitudes ne se mesurent pas de la
// même façon ne se comparent pas, et l'application affiche ces chiffres côte à
// côte sans le savoir.
//
// Cet outil lit les .glb tels qu'ils sont servis, suppose qu'ils sont déjà dans
// un repère commun (c'est l'invariant du site), et mesure ce qu'il en est —
// exactement comme le fait ingerer.mjs, avec le même découpage du recouvrement.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

import { IDENTITE, appliquer, multiplier } from './lib/matrice.mjs';
import { Grille, echantillonner, espacement } from './lib/nuage.mjs';

const id = process.argv[2];
if (!id) {
  console.error('Usage : node outils/mesurer-recalage.mjs <identifiant d’objet>');
  process.exit(2);
}

const dossier = path.join('objets', id);
const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'objet.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Les sommets d'un .glb, ramenés dans le repère de la scène : les nœuds
// portent l'identité après ingestion, mais rien ne le garantit d'un fichier
// venu d'ailleurs.
async function sommetsDe(chemin) {
  const doc = await io.read(chemin);
  const points = [];
  const parcourir = (noeud, parent) => {
    const M = multiplier(parent, noeud.getMatrix());
    const maille = noeud.getMesh();
    if (maille) {
      for (const prim of maille.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i += 1) {
          points.push(appliquer(M, pos.getElement(i, [0, 0, 0])));
        }
      }
    }
    for (const enfant of noeud.listChildren()) parcourir(enfant, M);
  };
  for (const noeud of doc.getRoot().getDefaultScene().listChildren()) parcourir(noeud, IDENTITE);
  return points;
}

const captures = [];
for (const s of manifeste.sessions) {
  captures.push({ id: s.id, label: s.label, sommets: await sommetsDe(path.join(dossier, s.glb)) });
}

const reference = captures[0];
const pas = espacement(reference.sommets);
const seuil = pas * 3;
const grille = new Grille(reference.sommets);

console.log(`${manifeste.nom} — référence ${reference.id.slice(0, 8)} `
  + `(${reference.sommets.length} sommets, arête ${(pas * 1000).toFixed(1)} mm)`);

const residus = {};
for (const c of captures.slice(1)) {
  const distances = [];
  for (const p of echantillonner(c.sommets, 4000)) {
    const v = grille.proche(p);
    if (v) distances.push(v.distance);
  }
  distances.sort((a, b) => a - b);
  const recouvrement = distances.filter((d) => d < seuil);
  const rmse = Math.sqrt(recouvrement.reduce((s, d) => s + d * d, 0) / (recouvrement.length || 1));
  residus[c.id] = {
    rmse,
    recouvrement: distances.length ? recouvrement.length / distances.length : 0,
    mediane: distances[Math.floor(distances.length / 2)] ?? NaN,
    p90: distances[Math.floor(distances.length * 0.9)] ?? NaN,
    voie: 'mesuré sur les .glb servis',
  };
  console.log(`  ${c.id.slice(0, 8)} : RMSE ${(rmse * 1000).toFixed(1)} mm sur `
    + `${((recouvrement.length / distances.length) * 100).toFixed(0)} % de recouvrement `
    + `(médiane ${(residus[c.id].mediane * 1000).toFixed(1)} mm)`);
}

const sortie = path.join(dossier, manifeste.recalage ?? 'sessions/_recalage.json');
fs.writeFileSync(sortie, `${JSON.stringify({
  reference: reference.id,
  note: 'Résidu du recalage de chaque capture sur la capture de référence. Le RMSE est '
    + 'mesuré sur le recouvrement géométrique : les points dont le plus proche voisin '
    + 'dépasse trois espacements de maillage regardent une surface que l’autre capture '
    + 'n’a pas vue et n’ont rien à dire sur l’alignement. « recouvrement » est la part '
    + 'de points retenus. Unités du modèle.',
  espacementMaillage: pas,
  ...residus,
}, null, 2)}\n`);
console.log(`\n${sortie} réécrit.`);
