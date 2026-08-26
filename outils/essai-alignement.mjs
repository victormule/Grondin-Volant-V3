// Mesure ce que valent, l'une après l'autre, les deux étapes du recalage :
// la matrice d'alignement de dür.air, puis l'ICP qu'elle initialise.
//
//   node outils/essai-alignement.mjs "<dossier d'export dür.air>"
import fs from 'node:fs';
import path from 'node:path';
import { inverse, multiplier, appliquer, echelleDe } from './lib/matrice.mjs';
import { lireSommetsOBJ, boite, Grille, echantillonner } from './lib/nuage.mjs';
import { recaler } from './lib/icp.mjs';

const ecart = (source, cible, M) => {
  const grille = new Grille(cible);
  const d = [];
  for (const p of echantillonner(source, 3000)) {
    const v = grille.proche(appliquer(M, p));
    if (v) d.push(v.distance);
  }
  d.sort((a, b) => a - b);
  return { n: d.length, mediane: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN };
};

const dossier = process.argv[2];
const racineSessions = path.join(dossier, 'sessions');
const captures = fs.readdirSync(racineSessions).map((id) => {
  const p = path.join(racineSessions, id, 'photogrammetry');
  if (!fs.existsSync(p)) return null;
  const obj = fs.readdirSync(p).find((f) => f.endsWith('.obj'));
  const meta = fs.readdirSync(p).find((f) => f.endsWith('_metadata.json'));
  if (!obj || !meta) return null;
  const a = JSON.parse(fs.readFileSync(path.join(p, meta), 'utf8')).alignmentInfo;
  return { id, obj: path.join(p, obj), M: a.transformMatrix.map(Number), v: lireSommetsOBJ(path.join(p, obj)) };
}).filter(Boolean);

console.log(`${captures.length} capture(s) avec modele — reference : ${captures[0].id.slice(0, 8)}\n`);
const Mref = inverse(captures[0].M);

for (let i = 1; i < captures.length; i += 1) {
  const grossier = multiplier(Mref, captures[i].M);
  const avant = ecart(captures[i].v, captures[0].v, grossier);
  const t0 = Date.now();
  const { M, rmse, retenus, total } = recaler(captures[i].v, captures[0].v, grossier);
  const apres = ecart(captures[i].v, captures[0].v, M);
  const b = boite(captures[0].v);
  console.log(`capture ${i + 1}  ${captures[i].id.slice(0, 8)}`);
  console.log(`  matrice dur.air seule : mediane ${(avant.mediane * 1000).toFixed(1)} mm, p90 ${(avant.p90 * 1000).toFixed(1)} mm`);
  console.log(`  + ICP (${((Date.now() - t0) / 1000).toFixed(1)} s)      : mediane ${(apres.mediane * 1000).toFixed(1)} mm, p90 ${(apres.p90 * 1000).toFixed(1)} mm`);
  console.log(`  RMSE sur ${retenus}/${total} appariements retenus : ${(rmse * 1000).toFixed(2)} mm  (${(100 * rmse / b.diagonale).toFixed(2)} % de la diagonale)`);
  console.log(`  echelle appliquee : x${echelleDe(M).toFixed(4)}\n`);
}
