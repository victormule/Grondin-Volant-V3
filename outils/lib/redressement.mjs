// Poser un objet face à la caméra.
//
// LE PROBLÈME. Object Capture rend chaque modèle recentré en X et Z et posé sur
// min.y = 0, mais il ne l'ORIENTE pas : un cadre photographié à plat sur le sol
// sort couché, tourné d'un angle quelconque autour de la verticale, et souvent
// incliné de quelques degrés. La vue d'ouverture du visualiseur le regarde
// alors par la tranche — un trait, là où on attend une face.
//
// LA SOLUTION. On cherche le plan dominant du nuage, qui est la face de
// l'objet, et on tourne la géométrie pour l'amener perpendiculaire à l'axe de
// la caméra. L'objet se redresse comme un tableau qu'on accroche : sa face
// vers +Z, son grand côté à l'horizontale, son bas posé sur y = 0.
//
// POURQUOI TOURNER LA GÉOMÉTRIE ET NON LA CAMÉRA. Le réglage « aplomb » du
// visualiseur ne fait tourner que la caméra, et c'est ce qu'il faut faire quand
// des annotations existent déjà — elles sont écrites dans le repère des
// fichiers, et retourner la géométrie sous elles les arracherait de l'objet.
// Mais l'ombre au sol, elle, reste horizontale au monde : elle se retrouve de
// travers sous un objet redressé par la seule caméra. Sur un objet qui n'a
// encore aucune annotation — le cas à l'ingestion — tourner la géométrie règle
// les deux d'un coup. Le repère change, et le manifeste le dit.
//
// L'AMBIGUÏTÉ QUI RESTE. Rien dans la géométrie ne dit si un cadre se regarde
// en portrait ou en paysage, ni quel côté est le haut. On pose le grand côté à
// l'horizontale par défaut, et « redressement.rotationFace » (en degrés, autour
// de l'axe de vue) permet de faire tourner l'objet dans son propre plan.

import { boite } from './nuage.mjs';

/* ------------------------------------------------ le sol, par carte de hauteurs */

// LE SOL N'EST PAS LE PLAN QUI PORTE LE PLUS DE POINTS. C'EST LE PLUS BAS.
//
// Le RANSAC cherche le plan le plus peuplé, et sur une scène posée au sol il se
// trompe : le spécimen du muséum, sa peau, sa palette et le dallage autour
// tiennent ensemble dans une bande de deux centimètres, et l'ajustement final
// sur ces « inliers » mélangés part de travers. Mesuré : le plan retenu tombait
// à 4,3° du dallage, qui restait donc en pente de 5,6° sous un objet censé être
// posé à plat.
//
// Un sol se reconnaît autrement : c'est ce qu'il y a en dessous. Rien de la
// scène ne passe sous lui — un objet posé repose dessus, il ne le traverse pas.
// On quadrille donc le plan horizontal, on garde le point le plus bas de chaque
// cellule, et on ajuste un plan sur cette carte. Le spécimen ne pèse plus rien
// dans l'ajustement : il ne fournit qu'une cellule chacune, celles qu'il cache,
// et le rejet des aberrants s'en occupe.
//
// Ceci suppose que la verticale du fichier est à peu près la bonne, ce qui est
// le cas des sorties Object Capture (Y vers le haut, objet posé sur y = 0). On
// corrige quelques degrés, pas un objet couché.
function planDuSol(points, tolerance) {
  const b = boite(points);
  // Une cellule assez large pour tomber sur du sol même là où le maillage est
  // lâche, assez fine pour que l'objet n'en occupe qu'une petite part.
  const pas = Math.max(b.diagonale / 120, 1e-6);
  const bas = new Map();
  for (const p of points) {
    const cle = `${Math.floor(p[0] / pas)},${Math.floor(p[2] / pas)}`;
    const v = bas.get(cle);
    if (!v || p[1] < v[1]) bas.set(cle, p);
  }
  let retenus = [...bas.values()];
  if (retenus.length < 40) return null;

  // y = a·x + b·z + c, aux moindres carrés, avec réjection des aberrants : le
  // dessous d'une palette, un trou du maillage, un bout de mur.
  let a = 0; let bz = 0; let c = 0;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const n = retenus.length;
    let Sx = 0; let Sz = 0; let Sy = 0; let Sxx = 0; let Szz = 0; let Sxz = 0; let Sxy = 0; let Szy = 0;
    for (const p of retenus) {
      Sx += p[0]; Sz += p[2]; Sy += p[1];
      Sxx += p[0] * p[0]; Szz += p[2] * p[2]; Sxz += p[0] * p[2];
      Sxy += p[0] * p[1]; Szy += p[2] * p[1];
    }
    const M = [[Sxx, Sxz, Sx], [Sxz, Szz, Sz], [Sx, Sz, n]];
    const V = [Sxy, Szy, Sy];
    for (let i = 0; i < 3; i += 1) {
      let pivot = i;
      for (let j = i + 1; j < 3; j += 1) if (Math.abs(M[j][i]) > Math.abs(M[pivot][i])) pivot = j;
      [M[i], M[pivot]] = [M[pivot], M[i]];
      [V[i], V[pivot]] = [V[pivot], V[i]];
      if (Math.abs(M[i][i]) < 1e-12) return null;
      for (let j = i + 1; j < 3; j += 1) {
        const f = M[j][i] / M[i][i];
        for (let k = i; k < 3; k += 1) M[j][k] -= f * M[i][k];
        V[j] -= f * V[i];
      }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i -= 1) {
      let s = V[i];
      for (let k = i + 1; k < 3; k += 1) s -= M[i][k] * x[k];
      x[i] = s / M[i][i];
    }
    [a, bz, c] = x;
    const ecarts = retenus.map((p) => Math.abs(p[1] - (a * p[0] + bz * p[2] + c))).sort((u, v) => u - v);
    const seuil = Math.max(tolerance, ecarts[ecarts.length >> 1] * 3);
    const garde = retenus.filter((p) => Math.abs(p[1] - (a * p[0] + bz * p[2] + c)) < seuil);
    if (garde.length < 40) break;
    retenus = garde;
  }

  const residus = retenus.map((p) => p[1] - (a * p[0] + bz * p[2] + c));
  const rms = Math.sqrt(residus.reduce((s, v) => s + v * v, 0) / residus.length);
  // Un sol qui n'est pas plan n'est pas un sol : dérive de reconstruction,
  // terrain en pente, escalier. Aucune rotation ne le rendra horizontal, et
  // mieux vaut alors laisser le RANSAC décider.
  if (rms > tolerance * 1.5) return null;

  const N = unitaire([-a, 1, -bz]);
  const d = produit(N, [0, c, 0]);
  let dedans = 0;
  for (const p of points) if (Math.abs(produit(N, p) - d) < tolerance) dedans += 1;
  return { N, d, part: dedans / points.length, cellules: retenus.length, rms };
}

/* --------------------------- poser une couche sur le sol d'une autre */

// DEUX RELEVÉS DU MÊME SOL DOIVENT LE POSER À LA MÊME HAUTEUR.
//
// L'ICP minimise un résidu de point à point sur toute la zone commune, et cette
// zone est dominée par le spécimen : un biais vertical d'un centimètre au sol
// ne lui coûte presque rien. À l'œil il coûte beaucoup — au ras du sol, un
// centimètre est une ligne de contact qui flotte, et c'est la première chose
// qu'on voit en passant d'un procédé à l'autre.
//
// La mesure ici ne suppose aucun modèle et ne dépend d'aucun ajustement : on
// maille le plan horizontal, on ne garde que les cellules où LES DEUX couches
// ont vu le sol — la bande basse — et on compare leurs hauteurs médianes. La
// médiane des écarts est le décalage ; les quartiles disent s'il est net ou
// s'il varie d'un bout à l'autre de la salle, auquel cas il ne s'agit pas d'un
// décalage mais d'une inclinaison, et une translation serait un cache-misère.
//
// Ce qu'on en fait est une TRANSLATION, rien d'autre : aucun point n'est
// écarté, aucun recadrage, le sol reste entier — il est la donnée.
export function caleAuSol(source, reference, options = {}) {
  const pas = options.pas ?? 0.03;
  const bande = options.bande ?? 0.06;
  const niveau = options.niveau ?? 0;
  const minimum = options.minimum ?? 4;

  const cellules = (points) => {
    const g = new Map();
    for (const p of points) {
      if (p[1] > niveau + bande || p[1] < niveau - bande) continue;
      const cle = `${Math.round(p[0] / pas)},${Math.round(p[2] / pas)}`;
      const v = g.get(cle);
      if (v) v.push(p[1]); else g.set(cle, [p[1]]);
    }
    return g;
  };
  const mediane = (v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };

  const aRef = cellules(reference);
  const aSrc = cellules(source);
  const ecarts = [];
  for (const [cle, hauteursRef] of aRef) {
    const hauteursSrc = aSrc.get(cle);
    if (!hauteursSrc || hauteursRef.length < minimum || hauteursSrc.length < minimum) continue;
    ecarts.push(mediane(hauteursSrc) - mediane(hauteursRef));
  }
  // Trop peu de sol commun pour trancher : on ne déplace rien plutôt que de
  // caler sur trois cellules.
  if (ecarts.length < 20) return null;
  ecarts.sort((a, b) => a - b);
  const quantile = (f) => ecarts[Math.floor(f * (ecarts.length - 1))];
  return {
    ecart: ecarts[ecarts.length >> 1],
    cellules: ecarts.length,
    q25: quantile(0.25),
    q75: quantile(0.75),
  };
}

/* --------------------------------- plan dominant, par RANSAC puis moindres carrés */

function planRansac(points, tolerance, essais = 800) {
  let meilleur = { inliers: 0 };
  const n = points.length;
  const pas = Math.max(1, Math.floor(n / 3000));
  for (let k = 0; k < essais; k += 1) {
    const a = points[(Math.random() * n) | 0];
    const b = points[(Math.random() * n) | 0];
    const c = points[(Math.random() * n) | 0];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const N = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const norme = Math.hypot(...N);
    if (norme < 1e-9) continue;
    for (let i = 0; i < 3; i += 1) N[i] /= norme;
    const d = N[0] * a[0] + N[1] * a[1] + N[2] * a[2];
    let inliers = 0;
    for (let i = 0; i < n; i += pas) {
      if (Math.abs(N[0] * points[i][0] + N[1] * points[i][1] + N[2] * points[i][2] - d) < tolerance) inliers += 1;
    }
    if (inliers > meilleur.inliers) meilleur = { inliers, N, d, part: inliers / Math.ceil(n / pas) };
  }
  return meilleur;
}

// Diagonalise une matrice symétrique 3×3 (Jacobi cyclique), valeurs propres
// décroissantes.
function axesPropres(C) {
  const A = C.map((l) => [...l]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let s = 0; s < 60; s += 1) {
    let hors = 0;
    for (let p = 0; p < 2; p += 1) for (let q = p + 1; q < 3; q += 1) hors += A[p][q] ** 2;
    if (hors < 1e-26) break;
    for (let p = 0; p < 2; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(A[p][q]) < 1e-20) continue;
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

function covariance(points) {
  const n = points.length;
  const m = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i += 1) m[i] += p[i] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) C[i][j] += (d[i] * d[j]) / n;
  }
  return { centre: m, C };
}

const produit = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const croix = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unitaire = (v) => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/* ------------------------------------------------------------------ la pose */

// Rend la matrice qui pose `points` face à +Z, grand côté vers +X, bas sur y=0
// et centré en X et Z.
export function poseFaceCamera(points, options = {}) {
  const { rotationFace = 0, normales = null, aPlat = false } = options;
  const b = boite(points);
  const tolerance = b.diagonale * 0.006;

  // Un objet posé se règle sur le sol ; un objet dressé, sur sa propre face.
  // Le sol se cherche par le dessous (voir planDuSol) et non par le nombre de
  // points, et l'on ne retombe sur le RANSAC que s'il n'y a pas de sol plan.
  const sol = aPlat ? planDuSol(points, tolerance) : null;
  const plan = sol ?? planRansac(points, tolerance);
  if (!plan.N) return { M: null, raison: 'aucun plan dominant' };
  const methode = sol
    ? `sol par carte de hauteurs (${sol.cellules} cellules, planéité ${(sol.rms * 1000).toFixed(1)} mm)`
    : 'plan dominant par RANSAC';

  // Les points du plan, puis leurs axes propres : la normale des moindres
  // carrés est plus juste que celle du triplet tiré au sort, et les deux axes
  // restants donnent le grand et le petit côté DANS le plan.
  const indicesInliers = [];
  const inliers = [];
  for (let i = 0; i < points.length; i += 1) {
    if (Math.abs(produit(plan.N, points[i]) - plan.d) < tolerance) {
      indicesInliers.push(i);
      inliers.push(points[i]);
    }
  }
  const { centre, C } = covariance(inliers);
  const { axes } = axesPropres(C);
  // Le réajustement par ACP corrige la normale d'un triplet tiré au sort — mais
  // il DÉFERAIT celle du sol. Ces « inliers » sont tout ce qui passe à moins
  // d'une tolérance du plan : le dallage, mais aussi le bas de la palette, le
  // bord de la peau, les copeaux. L'ACP les pèse tous pareil et repart de
  // travers, ce qui est précisément la faute qu'on vient de corriger. La carte
  // de hauteurs, elle, a déjà rejeté ces points-là. On garde sa normale.
  let N = sol ? plan.N : unitaire(axes[2]);

  // DE QUEL CÔTÉ REGARDE LA SURFACE ? C'EST LE MAILLAGE QUI LE SAIT.
  //
  // Première version de cette règle : « la face est celle du dessus », puisque
  // ces objets sont photographiés posés à plat. Elle s'est trompée sur deux
  // cadres sur quatre — une capture n'est pas toujours prise du côté qu'on
  // croit, et un tableau peut être scanné retourné.
  //
  // La conséquence n'était pas discrète, mais elle était invisible dans un
  // rendu de nuage de points : three.js élimine les faces d'après l'ORDRE DES
  // SOMMETS (side: FrontSide). Une surface présentée à l'envers est donc
  // purement retirée, et l'application montre ce qu'il y a derrière — le dos de
  // l'objet, vu de l'intérieur. Mesuré sur Cadre 2 : 1 % seulement des normales
  // tournées vers la caméra.
  //
  // Les normales des sommets disent, elles, de quel côté la surface regarde.
  // On les suit, et on ne suppose plus rien.
  let sens = N[1] >= 0 ? 1 : -1;
  if (normales) {
    let somme = 0;
    for (const i of indicesInliers) {
      if (normales[i]) somme += produit(N, normales[i]);
    }
    if (somme !== 0) sens = somme > 0 ? 1 : -1;
  }
  if (sens < 0) N = N.map((x) => -x);

  // LES CÔTÉS SE TROUVENT PAR LE RECTANGLE D'AIRE MINIMALE, PAS PAR L'ACP.
  //
  // L'analyse en composantes principales donne le grand axe d'un nuage, ce qui
  // n'est le côté d'un rectangle que si celui-ci est franchement allongé. Sur
  // un cadre presque carré les deux valeurs propres s'égalisent, la direction
  // devient indéterminée, et les axes tombent sur les DIAGONALES : l'objet
  // s'affiche en losange, tourné de quarante-cinq degrés. C'est exactement ce
  // qu'on a obtenu sur Cadre 4 (1,62 sur 1,44 — un carré, pour l'ACP).
  //
  // Le rectangle englobant d'aire minimale n'a pas ce défaut : il est calé sur
  // les bords de l'objet quel que soit son rapport de côtés. Un de ses côtés
  // porte forcément une arête de l'enveloppe convexe, ce qui rend la recherche
  // finie — on essaie chaque arête, on garde la plus petite aire.
  const base1 = unitaire(axes[0][0] * N[0] + axes[0][1] * N[1] + axes[0][2] * N[2] > 0.9
    ? axes[1] : axes[0]);
  const u0 = unitaire([
    base1[0] - produit(base1, N) * N[0],
    base1[1] - produit(base1, N) * N[1],
    base1[2] - produit(base1, N) * N[2],
  ]);
  const v0 = croix(N, u0);
  const plans2d = inliers.map((p) => [produit(p, u0), produit(p, v0)]);
  const { cos, sin } = rectangleMinimal(plans2d);

  let e1 = unitaire([
    u0[0] * cos + v0[0] * sin,
    u0[1] * cos + v0[1] * sin,
    u0[2] * cos + v0[2] * sin,
  ]);
  let e2 = croix(N, e1);
  if (produit(croix(e1, e2), N) < 0) e2 = e2.map((x) => -x);

  // Le grand côté à l'horizontale : on tient l'objet en paysage par défaut.
  const etendue = (axe) => {
    let mn = Infinity; let mx = -Infinity;
    for (const p of inliers) { const t2 = produit(p, axe); if (t2 < mn) mn = t2; if (t2 > mx) mx = t2; }
    return mx - mn;
  };
  if (etendue(e2) > etendue(e1)) { const t2 = e1; e1 = e2; e2 = t2.map((x) => -x); }

  // Rotation dans le plan de la face, si l'orientation par défaut ne convient
  // pas — un cadre en portrait plutôt qu'en paysage, ou tête-bêche.
  const t = (rotationFace * Math.PI) / 180;
  const [cs, sn] = [Math.cos(t), Math.sin(t)];
  const f1 = [e1[0] * cs + e2[0] * sn, e1[1] * cs + e2[1] * sn, e1[2] * cs + e2[2] * sn];
  const f2 = [-e1[0] * sn + e2[0] * cs, -e1[1] * sn + e2[1] * cs, -e1[2] * sn + e2[2] * cs];

  // DEBOUT OU À PLAT — deux façons d'être bien posé, et l'objet décide.
  //
  // Un tableau accroché se regarde de face : sa normale vient vers la caméra.
  // Un objet posé au sol se regarde d'en haut, en oblique : sa normale monte,
  // et la vue d'ouverture prend de la hauteur (voir le manifeste). Redresser
  // un sol carrelé comme un tableau donnerait un mur de carrelage, ce qui est
  // exact et absurde.
  //
  // Debout : R a pour lignes f1, f2, N — R·f1 = +X, R·f2 = +Y, R·N = +Z.
  // À plat : R a pour lignes f1, N, f3 — R·f1 = +X, R·N = +Y, R·f3 = +Z,
  //          avec f3 = f1 × N pour que le repère reste direct.
  const f3 = croix(f1, N);
  const R = aPlat
    ? [
      f1[0], N[0], f3[0], 0,
      f1[1], N[1], f3[1], 0,
      f1[2], N[2], f3[2], 0,
      0, 0, 0, 1,
    ]
    : [
      f1[0], f2[0], N[0], 0,
      f1[1], f2[1], N[1], 0,
      f1[2], f2[2], N[2], 0,
      0, 0, 0, 1,
    ];

  // Puis on repose l'objet : centré en X et Z, assis sur y = 0. C'est la
  // convention que suit déjà Object Capture, et celle sur laquelle comptent
  // l'ombre de contact et l'axe de rotation.
  const tournes = points.map((p) => [
    R[0] * p[0] + R[4] * p[1] + R[8] * p[2],
    R[1] * p[0] + R[5] * p[1] + R[9] * p[2],
    R[2] * p[0] + R[6] * p[1] + R[10] * p[2],
  ]);
  const bt = boite(tournes);
  const M = [...R];
  M[12] = -bt.centre[0];
  M[13] = -bt.mn[1];
  M[14] = -bt.centre[2];

  return {
    M,
    normale: N,
    partPlan: plan.part,
    methode,
    inliers: inliers.length,
    taille: bt.taille,
    // L'inclinaison que le redressement vient de corriger : l'angle entre la
    // face de l'objet et l'horizontale du monde. Grand, il dit que l'objet
    // était franchement de travers ; nul, que la capture était déjà d'aplomb.
    inclinaison: (Math.acos(Math.min(1, Math.abs(N[1]))) * 180) / Math.PI,
    centreInliers: centre,
  };
}

/* ------------------------------------------- rectangle englobant d'aire minimale */

// Enveloppe convexe 2D, chaîne monotone d'Andrew. Rend les sommets dans le sens
// trigonométrique.
function enveloppeConvexe(points) {
  const p = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (p.length < 3) return p;
  const croix2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [];
  for (const q of p) {
    while (bas.length >= 2 && croix2(bas[bas.length - 2], bas[bas.length - 1], q) <= 0) bas.pop();
    bas.push(q);
  }
  const haut = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i];
    while (haut.length >= 2 && croix2(haut[haut.length - 2], haut[haut.length - 1], q) <= 0) haut.pop();
    haut.push(q);
  }
  bas.pop(); haut.pop();
  return bas.concat(haut);
}

// L'orientation du rectangle englobant de plus petite aire.
//
// Théorème classique : un côté de ce rectangle porte forcément une arête de
// l'enveloppe convexe. Il suffit donc d'essayer les directions des arêtes de
// l'enveloppe — quelques dizaines, pas un balayage d'angles — et de garder
// celle qui donne la plus petite aire. Rendu sous forme de cosinus et sinus,
// pour éviter un aller-retour par l'angle.
export function rectangleMinimal(points2d) {
  const h = enveloppeConvexe(points2d);
  if (h.length < 3) return { cos: 1, sin: 0, aire: Infinity };
  let meilleur = { aire: Infinity, cos: 1, sin: 0 };
  for (let i = 0; i < h.length; i += 1) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const norme = Math.hypot(dx, dy);
    if (norme < 1e-12) continue;
    const cos = dx / norme;
    const sin = dy / norme;
    let uMin = Infinity; let uMax = -Infinity; let vMin = Infinity; let vMax = -Infinity;
    for (const q of h) {
      const u = q[0] * cos + q[1] * sin;
      const v = -q[0] * sin + q[1] * cos;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    const aire = (uMax - uMin) * (vMax - vMin);
    if (aire < meilleur.aire) meilleur = { aire, cos, sin, cotes: [uMax - uMin, vMax - vMin] };
  }
  return meilleur;
}
