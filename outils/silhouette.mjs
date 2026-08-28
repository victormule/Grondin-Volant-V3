// Projette le nuage d'une capture sur les trois plans, en caractères.
//
//   node outils/silhouette.mjs cadre-1
//   node outils/silhouette.mjs cadre-1 --capture 2
//
// Statistiquer une forme ne remplace pas la voir. Variance, planéité et
// quantiles disent des choses vraies et laissent passer l'essentiel : est-ce
// un cadre au milieu d'un bout de sol, ou le cadre occupe-t-il tout le modèle ?
// Trois projections en densité répondent en une seconde.

import fs from 'node:fs';
import path from 'node:path';
import { boite } from './lib/nuage.mjs';
import { sommetsDeGlb } from './analyser-forme.mjs';

const NIVEAUX = ' .:-=+*#%@';

function projeter(points, a, b, largeur, hauteur, etendue) {
  const grille = Array.from({ length: hauteur }, () => new Array(largeur).fill(0));
  const [minA, maxA] = etendue[a];
  const [minB, maxB] = etendue[b];
  for (const p of points) {
    const i = Math.floor(((p[a] - minA) / (maxA - minA || 1)) * (largeur - 1));
    const j = Math.floor(((maxB - p[b]) / (maxB - minB || 1)) * (hauteur - 1));
    if (i >= 0 && i < largeur && j >= 0 && j < hauteur) grille[j][i] += 1;
  }
  const pic = Math.max(1, ...grille.flat());
  return grille.map((ligne) => ligne
    .map((v) => NIVEAUX[Math.min(NIVEAUX.length - 1, Math.round((v / pic) ** 0.45 * (NIVEAUX.length - 1)))])
    .join(''));
}

const id = process.argv[2];
const iCapture = Number(process.argv[process.argv.indexOf('--capture') + 1]) || 1;
if (!id) { console.error('Usage : node outils/silhouette.mjs <objet> [--capture N]'); process.exit(2); }

const dossier = path.join('objets', id);
const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'objet.json'), 'utf8'));
const s = manifeste.sessions[iCapture - 1];
const pts = await sommetsDeGlb(path.join(dossier, s.glb));
const b = boite(pts);
const etendue = [[b.mn[0], b.mx[0]], [b.mn[1], b.mx[1]], [b.mn[2], b.mx[2]]];

console.log(`${manifeste.nom} — ${s.label} ${s.id.slice(0, 8)} — ${pts.length} sommets`);
console.log(`boîte ${b.taille.map((x) => x.toFixed(2)).join(' x ')}  (X x Y x Z)`);

// Le rapport 0,5 compense la hauteur d'un caractère de terminal, deux fois sa
// largeur : sans lui toute projection paraît écrasée.
for (const [nom, a, bb] of [['DESSUS (X→, Z↓)', 0, 2], ['FACE (X→, Y↑)', 0, 1], ['CÔTÉ (Z→, Y↑)', 2, 1]]) {
  const largeur = 78;
  const ratio = (etendue[bb][1] - etendue[bb][0]) / (etendue[a][1] - etendue[a][0] || 1);
  const hauteur = Math.max(4, Math.min(40, Math.round(largeur * ratio * 0.5)));
  console.log(`\n--- ${nom} ---`);
  for (const ligne of projeter(pts, a, bb, largeur, hauteur, etendue)) console.log(ligne);
}
