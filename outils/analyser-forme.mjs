// Que contient vraiment le nuage d'une capture ?
//
//   node outils/analyser-forme.mjs cadre-1
//
// Avant de recadrer ou d'orienter quoi que ce soit, il faut savoir ce qu'on
// regarde. Object Capture rend l'objet ET ce qui l'entoure dans la boîte que
// l'opérateur a tracée sur le téléphone : du sol, parfois un mur. Un cadre est
// une dalle plate ; un sol aussi. Les deux se ressemblent en analyse en
// composantes principales, et c'est justement l'ambiguïté qu'il faut lever.
//
// Ce script ne décide rien. Il mesure : axes principaux, planéité, et la
// recherche du plus grand plan par RANSAC, pour qu'on voie si l'objet domine
// son décor ou l'inverse.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { IDENTITE, appliquer, multiplier } from './lib/matrice.mjs';
import { boite } from './lib/nuage.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export async function sommetsDeGlb(chemin) {
  const doc = await io.read(chemin);
  const points = [];
  const parcourir = (noeud, parent) => {
    const M = multiplier(parent, noeud.getMatrix());
    const maille = noeud.getMesh();
    if (maille) {
      for (const prim of maille.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i += 1) points.push(appliquer(M, pos.getElement(i, [0, 0, 0])));
      }
    }
    for (const enfant of noeud.listChildren()) parcourir(enfant, M);
  };
  for (const noeud of doc.getRoot().getDefaultScene().listChildren()) parcourir(noeud, IDENTITE);
  return points;
}

/* --------------------------------------------- axes principaux (Jacobi) */

function jacobi3(A0) {
  const A = A0.map((l) => [...l]);
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let s = 0; s < 60; s += 1) {
    let hors = 0;
    for (let p = 0; p < 2; p += 1) for (let q = p + 1; q < 3; q += 1) hors += A[p][q] ** 2;
    if (hors < 1e-24) break;
    for (let p = 0; p < 2; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sn = t * c;
        for (let k = 0; k < 3; k += 1) {
          const akp = A[k][p]; const akq = A[k][q];
          A[k][p] = c * akp - sn * akq; A[k][q] = sn * akp + c * akq;
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = A[p][k]; const aqk = A[q][k];
          A[p][k] = c * apk - sn * aqk; A[q][k] = sn * apk + c * aqk;
        }
        for (let k = 0; k < 3; k += 1) {
          const vkp = V[k][p]; const vkq = V[k][q];
          V[k][p] = c * vkp - sn * vkq; V[k][q] = sn * vkp + c * vkq;
        }
      }
    }
  }
  const ordre = [0, 1, 2].sort((a, b) => A[b][b] - A[a][a]);
  return {
    valeurs: ordre.map((i) => A[i][i]),
    axes: ordre.map((i) => [V[0][i], V[1][i], V[2][i]]),
  };
}

export function axesPrincipaux(points) {
  const n = points.length;
  const m = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i += 1) m[i] += p[i] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) C[i][j] += (d[i] * d[j]) / n;
  }
  return { centre: m, ...jacobi3(C) };
}

/* ------------------------------------------------- plus grand plan (RANSAC) */

export function plusGrandPlan(points, tolerance, essais = 400) {
  let meilleur = { compte: 0 };
  const n = points.length;
  for (let k = 0; k < essais; k += 1) {
    const a = points[(Math.random() * n) | 0];
    const b = points[(Math.random() * n) | 0];
    const c = points[(Math.random() * n) | 0];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    const nz = u[0] * v[1] - u[1] * v[0];
    const norme = Math.hypot(nx, ny, nz);
    if (norme < 1e-9) continue;
    const N = [nx / norme, ny / norme, nz / norme];
    const d = N[0] * a[0] + N[1] * a[1] + N[2] * a[2];
    let compte = 0;
    for (let i = 0; i < n; i += 7) {
      if (Math.abs(N[0] * points[i][0] + N[1] * points[i][1] + N[2] * points[i][2] - d) < tolerance) compte += 1;
    }
    if (compte > meilleur.compte) meilleur = { compte, normale: N, d, part: compte / Math.ceil(n / 7) };
  }
  return meilleur;
}

/* ------------------------------------------------------------------ sortie */

const f = (a) => `[${a.map((x) => (x >= 0 ? ' ' : '') + x.toFixed(3)).join(' ')}]`;
const angleAvecY = (N) => (Math.acos(Math.min(1, Math.abs(N[1]))) * 180) / Math.PI;

if (import.meta.url === `file://${process.argv[1].split('\\').join('/')}`
  || import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const id = process.argv[2];
  if (!id) { console.error('Usage : node outils/analyser-forme.mjs <objet>'); process.exit(2); }
  const dossier = path.join('objets', id);
  const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'objet.json'), 'utf8'));

  for (const s of manifeste.sessions) {
    const pts = await sommetsDeGlb(path.join(dossier, s.glb));
    const b = boite(pts);
    const { valeurs, axes } = axesPrincipaux(pts);
    const total = valeurs[0] + valeurs[1] + valeurs[2];
    const plan = plusGrandPlan(pts, b.diagonale * 0.004);

    console.log(`${s.label} ${s.id.slice(0, 8)} — ${pts.length} sommets`);
    console.log(`  boîte      taille ${f(b.taille)}  min.y ${b.mn[1].toFixed(3)}  diagonale ${b.diagonale.toFixed(3)}`);
    console.log(`  variance   ${valeurs.map((v) => `${((v / total) * 100).toFixed(1)} %`).join('  ')}`);
    console.log(`  axe mince  ${f(axes[2])}   (${angleAvecY(axes[2]).toFixed(0)}° de la verticale)`);
    console.log(`  plan RANSAC ${f(plan.normale ?? [0, 0, 0])} — ${(plan.part * 100).toFixed(0)} % des points `
      + `(${angleAvecY(plan.normale ?? [0, 1, 0]).toFixed(0)}° de la verticale)`);
    console.log('');
  }
}
