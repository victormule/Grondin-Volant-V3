// ICP point-à-plan, à similitude.
//
// POURQUOI PAS POINT-À-POINT. La version point-à-point minimise la distance
// entre un sommet et le sommet le plus proche de l'autre capture. Or deux
// photogrammétries du même objet n'échantillonnent PAS les mêmes points de la
// surface : le vis-à-vis exact d'un sommet tombe presque toujours entre trois
// sommets de l'autre maillage, et l'écart résiduel mesure alors surtout la
// finesse du maillage. C'est ce qu'on observait — un résidu qui plafonnait
// autour d'une arête, quoi qu'on fasse.
//
// Le point-à-plan minimise la distance du sommet au PLAN TANGENT de son
// vis-à-vis, et non au vis-à-vis lui-même. Glisser le long de la surface ne
// coûte plus rien, ce qui est exactement le degré de liberté qu'il faut
// laisser libre : les deux maillages décrivent la même surface, pas les mêmes
// points. La convergence est plus rapide, et le plancher plus bas.
//
// La linéarisation. Le résidu (s·R·p + t − q)·n est développé autour de la
// solution courante avec R ≈ I + [ω]× et s ≈ 1 + σ :
//
//     ω·(p×n) + σ·(p·n) + t·n = (q − p)·n
//
// soit sept inconnues, linéaires. Une itération d'ICP est donc un système 7×7,
// résolu par les équations normales, et la correction est repassée en matrice
// par Rodrigues.

import { appliquer, multiplier, resoudre, depuisAxeAngle } from './matrice.mjs';
import { Grille, echantillonner, espacement } from './nuage.mjs';

// Transporte une normale par une similitude : l'échelle uniforme ne la change
// pas, seule la rotation compte, et renormaliser suffit.
function tournerNormale(M, n) {
  const v = [
    M[0] * n[0] + M[4] * n[1] + M[8] * n[2],
    M[1] * n[0] + M[5] * n[1] + M[9] * n[2],
    M[2] * n[0] + M[6] * n[1] + M[10] * n[2],
  ];
  const norme = Math.hypot(...v) || 1;
  return [v[0] / norme, v[1] / norme, v[2] / norme];
}

export function recalerPlan(source, cible, depart, options = {}) {
  const {
    iterations = 80,
    echantillon = 6000,
    quantileConserve = 0.8,
    convergence = 1e-7,
    // Un vis-à-vis dont la normale part dans l'autre sens n'en est pas un :
    // c'est la face opposée d'une paroi mince, vue de l'autre côté. Sur un
    // cadre — deux surfaces parallèles à quelques millimètres — c'est le
    // premier piège, et il tire l'alignement d'une épaisseur entière.
    cosNormaleMin = 0.5,
  } = options;

  const indices = source.positions.map((_, i) => i);
  const retenus = echantillonner(indices, echantillon);
  const grille = new Grille(cible.positions);

  // Le plus proche voisin rend un point ; il faut sa normale. La grille ne
  // rend pas d'indice, donc on indexe les normales par coordonnée.
  const normaleDe = new Map();
  for (let i = 0; i < cible.positions.length; i += 1) {
    if (cible.normales[i]) normaleDe.set(cible.positions[i], cible.normales[i]);
  }

  let M = depart;
  let rmse = Infinity;

  for (let iter = 0; iter < iterations; iter += 1) {
    const paires = [];
    for (const i of retenus) {
      const p = appliquer(M, source.positions[i]);
      const v = grille.proche(p);
      if (!v) continue;
      const n = normaleDe.get(v.point);
      if (!n) continue;
      const ns = source.normales[i] ? tournerNormale(M, source.normales[i]) : null;
      if (ns && ns[0] * n[0] + ns[1] * n[1] + ns[2] * n[2] < cosNormaleMin) continue;
      paires.push({ p, q: v.point, n, d: Math.abs((v.point[0] - p[0]) * n[0] + (v.point[1] - p[1]) * n[1] + (v.point[2] - p[2]) * n[2]) });
    }
    if (paires.length < 20) break;

    paires.sort((a, b) => a.d - b.d);
    const garde = paires.slice(0, Math.max(20, Math.floor(paires.length * quantileConserve)));

    // Équations normales du système 7×7.
    const A = Array.from({ length: 7 }, () => new Array(7).fill(0));
    const b = new Array(7).fill(0);
    for (const { p, q, n } of garde) {
      const c = [
        p[1] * n[2] - p[2] * n[1],
        p[2] * n[0] - p[0] * n[2],
        p[0] * n[1] - p[1] * n[0],
        p[0] * n[0] + p[1] * n[1] + p[2] * n[2],
        n[0], n[1], n[2],
      ];
      const r = (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] + (q[2] - p[2]) * n[2];
      for (let i = 0; i < 7; i += 1) {
        b[i] += c[i] * r;
        for (let j = 0; j < 7; j += 1) A[i][j] += c[i] * c[j];
      }
    }
    // Amortissement de Levenberg : la ligne de l'échelle et celles de la
    // rotation sont mal conditionnées sur une surface plane, où glisser et
    // grossir se ressemblent.
    for (let i = 0; i < 7; i += 1) A[i][i] *= 1.0001;

    const x = resoudre(A, b);
    if (!x || x.some((v) => !Number.isFinite(v))) break;

    const correction = depuisAxeAngle([x[0], x[1], x[2]], 1 + x[3], [x[4], x[5], x[6]]);
    M = multiplier(correction, M);

    const precedent = rmse;
    rmse = Math.sqrt(garde.reduce((s, p) => s + p.d * p.d, 0) / garde.length);
    if (Math.abs(precedent - rmse) < convergence) break;
  }

  return { M, rmsePlan: rmse };
}

// Le résidu tel qu'il sera publié : distance de point à point, sur le
// recouvrement géométrique. Le point-à-plan optimise autre chose que ce qu'on
// annonce, et il serait malhonnête d'annoncer son propre critère — une
// distance au plan tangent est plus petite qu'une distance au point par
// construction, et c'est la seconde qui dit où une annotation atterrira.
export function jugerRecalage(source, cible, M) {
  const grille = new Grille(cible.positions);
  const pas = espacement(cible.positions);
  const seuil = pas * 3;
  const distances = [];
  for (const p of echantillonner(source.positions, 4000)) {
    const v = grille.proche(appliquer(M, p));
    if (v) distances.push(v.distance);
  }
  distances.sort((a, b) => a - b);
  const recouvrement = distances.filter((d) => d < seuil);
  const quadratique = (l) => (l.length ? Math.sqrt(l.reduce((s, d) => s + d * d, 0) / l.length) : NaN);
  return {
    rmse: quadratique(recouvrement),
    partRecouvrement: distances.length ? recouvrement.length / distances.length : 0,
    mediane: distances[Math.floor(distances.length / 2)] ?? NaN,
    p90: distances[Math.floor(distances.length * 0.9)] ?? NaN,
    espacementMaillage: pas,
  };
}
