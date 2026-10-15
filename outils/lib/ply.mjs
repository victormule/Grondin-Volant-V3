// Lecture d'un nuage de points PLY ASCII, et réduction par voxels.
//
// dür.air exporte le relevé LiDAR sous deux formes : un maillage
// (complete_mesh) et le nuage de ses points, coloré (sparse_cloud). Le second
// est ce qu'on veut montrer quand on veut montrer du LiDAR — un maillage
// reconstruit par ARKit lisse et bouche, et donne à voir une surface là où la
// mesure n'a rendu que des points.
//
// LE REPÈRE. Les deux fichiers ne sont pas écrits pareil, et l'en-tête le dit :
// le maillage est en coordonnées ARKit brutes, le nuage est annoncé « Standard
// 3D (Y=up, Z=backward) - converted from ARKit ». Concrètement le nuage a subi
// (x, y, z) → (x, −z, y). On défait cette conversion pour revenir au repère
// ARKit, le seul où la matrice d'alignement de la photogrammétrie a un sens.
// Vérifié sommet à sommet : le premier point du nuage, (2.00232, 3.5922,
// −1.38653), redevient (2.00232, −1.38653, −3.5922), qui est bien le premier
// sommet du maillage.

import fs from 'node:fs';
import readline from 'node:readline';

function lireEntete(lignes) {
  const proprietes = [];
  let sommets = 0;
  let format = null;
  let dansSommets = false;
  for (const ligne of lignes) {
    const mots = ligne.trim().split(/\s+/);
    if (mots[0] === 'format') format = mots[1];
    else if (mots[0] === 'element') {
      dansSommets = mots[1] === 'vertex';
      if (dansSommets) sommets = Number(mots[2]);
    } else if (mots[0] === 'property' && dansSommets) proprietes.push(mots[mots.length - 1]);
    else if (mots[0] === 'end_header') break;
  }
  return { proprietes, sommets, format };
}

/**
 * Lit un nuage PLY ASCII et le réduit par voxels.
 *
 * La réduction n'est pas un rognage : elle garde toute l'étendue et abaisse la
 * résolution. Un LiDAR de téléphone mesure à un ou deux centimètres près ; deux
 * millions de points sur une salle de dix mètres en décrivent donc beaucoup
 * moins qu'ils n'en laissent croire, et un point par voxel de deux centimètres
 * ne perd rien de mesuré. Sur le disque, en revanche, la différence est un
 * fichier que le navigateur charge et un fichier qu'il ne charge pas.
 *
 * @param {string} chemin
 * @param {{ voxel?: number, repereArkit?: boolean }} options
 */
export async function lireNuagePLY(chemin, { voxel = 0.02, repereArkit = true } = {}) {
  const flux = readline.createInterface({
    input: fs.createReadStream(chemin),
    crlfDelay: Infinity,
  });

  const entete = [];
  let dansEntete = true;
  let colonnes = null;
  let index = null;

  // Un voxel garde la somme de ses points, et rend leur moyenne : le nuage
  // reste centré sur la matière plutôt que sur le premier point rencontré.
  const cases = new Map();
  let lus = 0;

  for await (const ligne of flux) {
    if (dansEntete) {
      entete.push(ligne);
      if (ligne.trim() === 'end_header') {
        dansEntete = false;
        const { proprietes, format } = lireEntete(entete);
        if (format !== 'ascii') throw new Error(`PLY ${format} non pris en charge (ascii attendu)`);
        colonnes = proprietes;
        index = {
          x: colonnes.indexOf('x'),
          y: colonnes.indexOf('y'),
          z: colonnes.indexOf('z'),
          r: colonnes.indexOf('red'),
          v: colonnes.indexOf('green'),
          b: colonnes.indexOf('blue'),
        };
        if (index.x < 0 || index.y < 0 || index.z < 0) throw new Error('PLY sans x/y/z');
      }
      continue;
    }
    if (ligne.length === 0) continue;

    const champs = ligne.split(' ');
    // Les faces, s'il y en a, commencent par un compte entier : un nuage n'en a
    // pas, mais un maillage exporté au même format en aurait, et il ne faut pas
    // les lire comme des sommets.
    if (champs.length < colonnes.length) break;

    let x = +champs[index.x];
    let y = +champs[index.y];
    let z = +champs[index.z];
    if (repereArkit) {
      // (x, −z, y) → (x, y, z) : on défait la conversion annoncée par l'en-tête.
      const ay = z;
      const az = -y;
      y = ay;
      z = az;
    }
    lus += 1;

    const cle = `${Math.floor(x / voxel)},${Math.floor(y / voxel)},${Math.floor(z / voxel)}`;
    const c = cases.get(cle);
    if (c) {
      c[0] += x; c[1] += y; c[2] += z; c[6] += 1;
      if (index.r >= 0) { c[3] += +champs[index.r]; c[4] += +champs[index.v]; c[5] += +champs[index.b]; }
    } else {
      cases.set(cle, index.r >= 0
        ? [x, y, z, +champs[index.r], +champs[index.v], +champs[index.b], 1]
        : [x, y, z, 255, 255, 255, 1]);
    }
  }

  const n = cases.size;
  const positions = new Float32Array(n * 3);
  const couleurs = new Uint8Array(n * 3);
  let i = 0;
  for (const c of cases.values()) {
    positions[i * 3] = c[0] / c[6];
    positions[i * 3 + 1] = c[1] / c[6];
    positions[i * 3 + 2] = c[2] / c[6];
    couleurs[i * 3] = Math.min(255, Math.round(c[3] / c[6]));
    couleurs[i * 3 + 1] = Math.min(255, Math.round(c[4] / c[6]));
    couleurs[i * 3 + 2] = Math.min(255, Math.round(c[5] / c[6]));
    i += 1;
  }
  return { positions, couleurs, lus, gardes: n, voxel };
}

/**
 * Un PLY de gaussiennes (3D Gaussian Splatting) se reconnaît à ses
 * coefficients d'harmoniques sphériques : « f_dc_0 » dans l'en-tête.
 */
export function estPlyGaussien(chemin) {
  const fd = fs.openSync(chemin, 'r');
  try {
    const tampon = Buffer.alloc(8192);
    const lus = fs.readSync(fd, tampon, 0, tampon.length, 0);
    const entete = tampon.subarray(0, lus).toString('latin1').split('end_header')[0];
    return entete.includes('property float f_dc_0');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Lit un PLY de gaussiennes binaire et en fait un nuage de points coloré : le
 * centre de chaque gaussienne, de la couleur que lui donne son terme d'ordre 0
 * (couleur = 0,5 + C0 · f_dc, avec C0 = 0,2820948).
 *
 * C'EST UN NUAGE DE CENTRES, PAS UN RENDU PAR SPLATS. Le visualiseur affiche des
 * maillages et des nuages de points ; il ne sait pas étaler une gaussienne.
 * Les centres disent où le splatting a placé la matière, et leur teinte celle
 * qu'il lui a donnée — pas la finesse du rendu. Les gaussiennes presque
 * transparentes (opacité < 0,3) sont écartées : elles servent à lisser le rendu,
 * elles ne désignent aucune surface.
 *
 * LE REPÈRE. Contrairement au sparse_cloud, aucune conversion d'axes : les
 * positions sont déjà dans le monde ARKit, en mètres (vérifié : médiane à
 * quelques centimètres de celle du LiDAR de la même session).
 */
export function lireGaussianPLY(chemin, { opaciteMin = 0.3 } = {}) {
  const tout = fs.readFileSync(chemin);
  const fin = tout.indexOf('end_header\n');
  if (fin < 0) throw new Error('PLY sans end_header');
  const lignes = tout.subarray(0, fin).toString('latin1').split('\n');
  const format = lignes.find((l) => l.startsWith('format '))?.split(/\s+/)[1];
  if (format !== 'binary_little_endian') throw new Error(`PLY ${format} non pris en charge (binary_little_endian attendu)`);
  const sommets = Number(lignes.find((l) => l.startsWith('element vertex '))?.split(/\s+/)[2]);
  const noms = lignes.filter((l) => l.startsWith('property ')).map((l) => l.trim().split(/\s+/));
  if (noms.some(([, type]) => type !== 'float')) throw new Error('PLY gaussien : propriétés non flottantes');
  const cols = noms.map(([, , nom]) => nom);
  const i = (nom) => cols.indexOf(nom);
  const [ix, iy, iz, r, v, b, io] = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'].map(i);
  if ([ix, iy, iz, r, v, b, io].some((k) => k < 0)) throw new Error('PLY gaussien incomplet');

  const donnees = new Float32Array(tout.buffer.slice(tout.byteOffset + fin + 11,
    tout.byteOffset + fin + 11 + sommets * cols.length * 4));
  const C0 = 0.28209479177387814;
  const teinte = (f) => Math.max(0, Math.min(255, Math.round((0.5 + C0 * f) * 255)));
  const pos = [];
  const col = [];
  for (let s = 0; s < sommets; s += 1) {
    const o = s * cols.length;
    if (1 / (1 + Math.exp(-donnees[o + io])) < opaciteMin) continue;
    pos.push(donnees[o + ix], donnees[o + iy], donnees[o + iz]);
    col.push(teinte(donnees[o + r]), teinte(donnees[o + v]), teinte(donnees[o + b]));
  }
  return { positions: Float32Array.from(pos), couleurs: Uint8Array.from(col), lus: sommets, gardes: pos.length / 3, voxel: 0 };
}
