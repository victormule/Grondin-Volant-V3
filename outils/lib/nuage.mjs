// Nuages de points : lecture d'un OBJ, et recherche du plus proche voisin.
//
// La recherche passe par une grille régulière plutôt qu'un arbre k-d. Sur des
// maillages photogrammétriques de quinze mille sommets à densité à peu près
// uniforme, la grille est aussi rapide, tient en trente lignes, et son pas se
// choisit tout seul à partir de l'espacement moyen des points.

import fs from 'node:fs';

export function lireSommetsOBJ(chemin) {
  const sommets = [];
  const texte = fs.readFileSync(chemin, 'utf8');
  let debut = 0;
  while (debut < texte.length) {
    let fin = texte.indexOf('\n', debut);
    if (fin < 0) fin = texte.length;
    if (texte.charCodeAt(debut) === 118 /* v */ && texte.charCodeAt(debut + 1) === 32) {
      const p = texte.slice(debut + 2, fin).split(' ');
      sommets.push([+p[0], +p[1], +p[2]]);
    }
    debut = fin + 1;
  }
  return sommets;
}

export function boite(points) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i += 1) {
      if (p[i] < mn[i]) mn[i] = p[i];
      if (p[i] > mx[i]) mx[i] = p[i];
    }
  }
  return {
    mn, mx,
    taille: mx.map((x, i) => x - mn[i]),
    centre: mx.map((x, i) => (x + mn[i]) / 2),
    diagonale: Math.hypot(...mx.map((x, i) => x - mn[i])),
  };
}

// La grille. Le pas vaut par défaut la diagonale divisée par la racine cubique
// du nombre de points : environ un point par case, ce qui rend la recherche
// dans les vingt-sept cases voisines à peu près constante.
export class Grille {
  constructor(points, pas) {
    const b = boite(points);
    this.pas = pas ?? Math.max(b.diagonale / Math.cbrt(points.length), 1e-6);
    this.cases = new Map();
    for (const p of points) {
      const k = this._cle(p);
      const c = this.cases.get(k);
      if (c) c.push(p); else this.cases.set(k, [p]);
    }
  }

  _cle(p) {
    return `${Math.floor(p[0] / this.pas)},${Math.floor(p[1] / this.pas)},${Math.floor(p[2] / this.pas)}`;
  }

  // Le plus proche voisin, ou null si aucun point ne se trouve dans les cases
  // voisines. Rendre null plutôt que d'élargir la recherche est délibéré :
  // c'est ainsi que l'ICP écarte les zones qu'une capture est seule à couvrir.
  proche(p) {
    const i = Math.floor(p[0] / this.pas);
    const j = Math.floor(p[1] / this.pas);
    const k = Math.floor(p[2] / this.pas);
    let meilleur = null;
    let carre = Infinity;
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (let c = -1; c <= 1; c += 1) {
          const lot = this.cases.get(`${i + a},${j + b},${k + c}`);
          if (!lot) continue;
          for (const q of lot) {
            const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
            if (d < carre) { carre = d; meilleur = q; }
          }
        }
      }
    }
    return meilleur ? { point: meilleur, distance: Math.sqrt(carre) } : null;
  }
}

// L'espacement propre d'un nuage : la distance médiane d'un point à son plus
// proche voisin, mesurée dans le nuage lui-même.
//
// C'est l'échelle intrinsèque du maillage, et la seule façon honnête de dire
// si deux surfaces se recouvrent. Le pas de la grille ne le donne PAS : il est
// calculé pour tenir environ un point par case dans un VOLUME, alors que les
// points décrivent une surface — sur Cadre 1, le pas vaut un cinquième du
// modèle quand les sommets sont vingt fois plus serrés que cela.
export function espacement(points, echantillonTaille = 2000) {
  const grille = new Grille(points);
  // Les sommets confondus ne comptent pas. Un maillage glTF dédouble ses
  // sommets le long des coutures UV : même position, UV différents. Ils sont à
  // distance nulle l'un de l'autre, et sur le grondin ils sont assez nombreux
  // pour que la médiane tombe à zéro — d'où un seuil de recouvrement nul et,
  // en aval, un résidu mesuré sur zéro pour cent des points.
  const confondus = boite(points).diagonale * 1e-7;
  const d = [];
  for (const p of echantillonner(points, echantillonTaille)) {
    // Le point se trouve lui-même à distance nulle : on cherche le suivant.
    const i = Math.floor(p[0] / grille.pas);
    const j = Math.floor(p[1] / grille.pas);
    const k = Math.floor(p[2] / grille.pas);
    let meilleur = Infinity;
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (let c = -1; c <= 1; c += 1) {
          for (const q of grille.cases.get(`${i + a},${j + b},${k + c}`) ?? []) {
            if (q === p) continue;
            // eslint-disable-next-line no-continue
            const s = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
            if (s < meilleur) meilleur = s;
          }
        }
      }
    }
    if (meilleur < Infinity && meilleur > confondus * confondus) d.push(Math.sqrt(meilleur));
  }
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] ?? NaN;
}

// Un point sur n, pour que l'ICP travaille sur quelques milliers de points au
// lieu de quinze mille : la transformation trouvée est la même, le temps est
// divisé par le pas.
export const echantillonner = (points, cible) => (points.length <= cible
  ? points
  : points.filter((_, i) => i % Math.ceil(points.length / cible) === 0));

// Sommets ET normales d'un OBJ, appariés par face.
//
// Le format OBJ indexe séparément positions, UV et normales : « f 1/1/1 » veut
// dire sommet 1, UV 1, normale 1, et rien n'oblige les trois listes à se
// correspondre. Object Capture écrit autant de vn que de v et les fait
// coïncider, mais s'appuyer là-dessus serait s'appuyer sur une coïncidence :
// on relit donc les faces pour associer chaque position à sa normale.
export function lireNuageOBJ(chemin) {
  const positions = [];
  const normalesBrutes = [];
  const texte = fs.readFileSync(chemin, 'utf8');
  const faces = [];

  let debut = 0;
  while (debut < texte.length) {
    let fin = texte.indexOf('\n', debut);
    if (fin < 0) fin = texte.length;
    const c0 = texte.charCodeAt(debut);
    const c1 = texte.charCodeAt(debut + 1);
    if (c0 === 118 && c1 === 32) {
      const p = texte.slice(debut + 2, fin).split(' ');
      positions.push([+p[0], +p[1], +p[2]]);
    } else if (c0 === 118 && c1 === 110) {
      const p = texte.slice(debut + 3, fin).split(' ');
      normalesBrutes.push([+p[0], +p[1], +p[2]]);
    } else if (c0 === 102 && c1 === 32) {
      faces.push(texte.slice(debut + 2, fin).trim().split(/\s+/));
    }
    debut = fin + 1;
  }

  const normales = new Array(positions.length).fill(null);
  for (const face of faces) {
    for (const coin of face) {
      const parts = coin.split('/');
      const iv = Number(parts[0]);
      const inor = parts.length > 2 && parts[2] ? Number(parts[2]) : 0;
      if (!iv || !inor) continue;
      const p = iv > 0 ? iv - 1 : positions.length + iv;
      const n = inor > 0 ? inor - 1 : normalesBrutes.length + inor;
      if (normales[p] === null && normalesBrutes[n]) normales[p] = normalesBrutes[n];
    }
  }
  return { positions, normales };
}
