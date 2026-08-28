// Recalage d'une capture sur une autre : similitude (rotation, échelle
// uniforme, translation), estimée par ICP.
//
// POURQUOI UNE SIMILITUDE ET NON UN DÉPLACEMENT RIGIDE. Object Capture ne rend
// pas une échelle fiable : sur le grondin, trois captures du même spécimen
// prises dans l'heure sortaient à des échelles différant de 9 %. Un ICP rigide
// chercherait donc à compenser par une rotation, et n'y arriverait pas.
//
// POURQUOI HORN ET NON UNE SVD. À chaque itération il faut la rotation qui
// aligne au mieux deux jeux de points appariés. La décomposition en valeurs
// singulières le fait, au prix d'une SVD 3×3 et du traitement du cas réfléchi
// (déterminant négatif) — une matrice qui retourne l'objet comme un gant et
// qu'il faut détecter. La méthode d'Horn passe par le plus grand vecteur
// propre d'une matrice symétrique 4×4, lu comme un quaternion : un quaternion
// unitaire EST une rotation propre, le cas réfléchi ne peut pas se produire.

import { depuisQuaternion, appliquer } from './matrice.mjs';
import { Grille, echantillonner, espacement } from './nuage.mjs';

// Valeurs et vecteurs propres d'une matrice symétrique, par rotations de
// Jacobi. Cyclique, sur la matrice 4×4 d'Horn : une dizaine de balayages
// suffisent largement à la précision machine.
function jacobi(A0, n = 4, balayages = 50) {
  const A = A0.map((l) => [...l]);
  let V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let s = 0; s < balayages; s += 1) {
    let hors = 0;
    for (let p = 0; p < n - 1; p += 1) for (let q = p + 1; q < n; q += 1) hors += A[p][q] ** 2;
    if (hors < 1e-24) break;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s2 = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = A[k][p]; const akq = A[k][q];
          A[k][p] = c * akp - s2 * akq;
          A[k][q] = s2 * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = A[p][k]; const aqk = A[q][k];
          A[p][k] = c * apk - s2 * aqk;
          A[q][k] = s2 * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = V[k][p]; const vkq = V[k][q];
          V[k][p] = c * vkp - s2 * vkq;
          V[k][q] = s2 * vkp + c * vkq;
        }
      }
    }
  }
  return { valeurs: A.map((l, i) => l[i]), vecteurs: V };
}

// La similitude qui amène `source` sur `cible`, les deux listes étant
// appariées point à point. Horn 1987.
export function similitude(source, cible, rigide = false) {
  const n = source.length;
  const mp = [0, 0, 0]; const mq = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < 3; k += 1) { mp[k] += source[i][k] / n; mq[k] += cible[i][k] / n; }
  }
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  let normeSource = 0;
  for (let i = 0; i < n; i += 1) {
    const px = source[i][0] - mp[0], py = source[i][1] - mp[1], pz = source[i][2] - mp[2];
    const qx = cible[i][0] - mq[0], qy = cible[i][1] - mq[1], qz = cible[i][2] - mq[2];
    Sxx += px * qx; Sxy += px * qy; Sxz += px * qz;
    Syx += py * qx; Syy += py * qy; Syz += py * qz;
    Szx += pz * qx; Szy += pz * qy; Szz += pz * qz;
    normeSource += px * px + py * py + pz * pz;
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { valeurs, vecteurs } = jacobi(N);
  let meilleur = 0;
  for (let i = 1; i < 4; i += 1) if (valeurs[i] > valeurs[meilleur]) meilleur = i;
  let q = [0, 1, 2, 3].map((i) => vecteurs[i][meilleur]);
  const norme = Math.hypot(...q);
  q = q.map((x) => x / norme);

  // L'échelle est le rapport entre ce que la rotation projette sur la cible et
  // ce que la source mesure d'elle-même.
  const R = depuisQuaternion(q, 1, [0, 0, 0]);
  let projection = 0;
  for (let i = 0; i < n; i += 1) {
    const p = appliquer(R, [source[i][0] - mp[0], source[i][1] - mp[1], source[i][2] - mp[2]]);
    projection += p[0] * (cible[i][0] - mq[0]) + p[1] * (cible[i][1] - mq[1]) + p[2] * (cible[i][2] - mq[2]);
  }
  // RIGIDE : ROTATION ET TRANSLATION, SANS ÉCHELLE.
  //
  // Une similitude est libre de rétrécir la source pour réduire le résidu, et
  // elle ne s en prive pas : recalant le nuage LiDAR sur la photogrammétrie,
  // elle gagnait huit millimètres de RMSE en comprimant le relevé de 8,5 %.
  // Or le mètre ruban dit que l échelle est juste — ce gain payait un rapport
  // de longueurs faux. Quand deux relevés sont déjà à la même échelle, seules
  // la rotation et la translation sont à trouver, et l échelle reste à un.
  const c = rigide ? 1 : (normeSource > 0 ? projection / normeSource : 1);
  const Rp = appliquer(R, mp);
  return depuisQuaternion(q, c, [mq[0] - c * Rp[0], mq[1] - c * Rp[1], mq[2] - c * Rp[2]]);
}

// ICP point à point, initialisé par `depart`.
//
// À chaque itération : chaque point source cherche son plus proche voisin dans
// la cible, les appariements les plus lointains sont écartés, et la similitude
// qui minimise l'erreur sur ce qui reste est appliquée. L'écart des appariements
// retenus est renvoyé comme RMSE.
//
// L'écartement des appariements lointains n'est pas une commodité : les deux
// captures ne couvrent pas la même surface — l'une embarque plus de sol, l'autre
// voit une face que la première n'a pas vue. Sans ce filtre, ces zones sans
// vis-à-vis tirent la solution vers elles.
export function recaler(sourceComplete, cibleComplete, depart, options = {}) {
  const {
    iterations = 60,
    echantillon = 4000,
    quantileConserve = 0.7,
    convergence = 1e-6,
    rigide = false,
  } = options;

  const source = echantillonner(sourceComplete, echantillon);
  const grille = new Grille(cibleComplete);
  let M = depart;
  let rmse = Infinity;
  let retenus = 0;

  for (let iter = 0; iter < iterations; iter += 1) {
    const transformes = source.map((p) => appliquer(M, p));
    const paires = [];
    for (let i = 0; i < transformes.length; i += 1) {
      const v = grille.proche(transformes[i]);
      if (v) paires.push({ i, cible: v.point, d: v.distance });
    }
    if (paires.length < 12) break;

    paires.sort((a, b) => a.d - b.d);
    const garde = paires.slice(0, Math.max(12, Math.floor(paires.length * quantileConserve)));

    // La similitude est estimée sur les points DÉJÀ transformés, puis composée
    // avec M : on cherche la correction, pas la transformation complète.
    const correction = similitude(garde.map((p) => transformes[p.i]), garde.map((p) => p.cible), rigide);
    M = multiplier4(correction, M);

    const precedent = rmse;
    rmse = Math.sqrt(garde.reduce((s, p) => s + p.d * p.d, 0) / garde.length);
    retenus = garde.length;
    if (Math.abs(precedent - rmse) < convergence) break;
  }

  // LE RÉSIDU PUBLIÉ SE MESURE SUR LE RECOUVREMENT, ET LE RECOUVREMENT SE
  // DÉFINIT GÉOMÉTRIQUEMENT.
  //
  // Trois chiffres se disputaient la place, et deux sont trompeurs.
  //
  // Le RMSE sur les appariements que l'ICP a retenus baisse tout seul quand on
  // resserre le filtre, sans que rien ne s'aligne mieux : mesuré sur Cadre 1,
  // passer de 70 % à 25 % de paires conservées le fait tomber de 9,8 à 6,2 mm
  // pendant que l'écart médian sur tous les points ne bouge pas d'un dixième.
  // C'est un chiffre qui mesure son propre seuil.
  //
  // Le RMSE sur TOUS les points, lui, vaut 37 mm là où la médiane vaut 11 : il
  // est dominé par la queue, c'est-à-dire par les endroits qu'une seule des
  // deux captures a vus. Une capture qui embarque trois mètres de sol que
  // l'autre n'a pas vus n'est pas mal recalée pour autant.
  //
  // Reste le seul découpage qui ne soit pas un réglage : un point dont le plus
  // proche voisin est plus loin que quelques espacements de maillage n'a PAS de
  // vis-à-vis. Il est hors du recouvrement, et il n'a rien à dire sur la
  // qualité de l'alignement. Le résidu se mesure sur le reste, et la part de
  // points retenus est publiée avec lui — un lecteur qui voit « 4 mm sur 38 %
  // de la surface » sait exactement ce qu'il lit.
  const grilleFinale = new Grille(cibleComplete);
  // Trois fois l'espacement propre du maillage cible : au-delà, un point n'a
  // pas de vis-à-vis, il regarde une surface que l'autre capture n'a pas vue.
  const pas = espacement(cibleComplete);
  const seuil = pas * 3;
  const toutes = [];
  for (const point of echantillonner(sourceComplete, 4000)) {
    const v = grilleFinale.proche(appliquer(M, point));
    if (v) toutes.push(v.distance);
  }
  toutes.sort((x, y) => x - y);
  const recouvrement = toutes.filter((d) => d < seuil);
  const quadratique = (l) => (l.length
    ? Math.sqrt(l.reduce((s, d) => s + d * d, 0) / l.length)
    : NaN);

  return {
    M,
    // Ce que lit l'application : l'incertitude de position d'une annotation
    // posée sur une capture et regardée sur une autre.
    rmse: quadratique(recouvrement),
    partRecouvrement: toutes.length ? recouvrement.length / toutes.length : 0,
    seuilRecouvrement: seuil,
    espacementMaillage: pas,
    mediane: toutes[Math.floor(toutes.length / 2)] ?? NaN,
    p90: toutes[Math.floor(toutes.length * 0.9)] ?? NaN,
    rmseComplet: quadratique(toutes),
    apparies: toutes.length,
    retenus,
    total: source.length,
  };
}

function multiplier4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let l = 0; l < 4; l += 1) {
      o[c * 4 + l] = a[l] * b[c * 4] + a[4 + l] * b[c * 4 + 1]
        + a[8 + l] * b[c * 4 + 2] + a[12 + l] * b[c * 4 + 3];
    }
  }
  return o;
}

// Recalage sans matrice d'alignement.
//
// Toutes les captures ne portent pas d'alignmentInfo — dür.air ne le calcule
// que s'il a pu apparier assez de points de repère. Il reste malgré tout un
// a priori fort, et il vient d'Object Capture : chaque modèle sort recentré en
// X et Z, posé sur min.y = 0, l'axe Y vers le haut. La transformation cherchée
// n'a donc que cinq degrés de liberté au lieu de sept — une rotation autour de
// la verticale, une échelle, et un décalage dans le plan.
//
// On balaie la rotation. Pour chaque angle, quelques itérations d'ICP suffisent
// à dire si la piste est bonne ; on garde la meilleure et on la mène à terme.
export function recalerSansAmorce(source, cible, options = {}) {
  const { pas = 10, iterationsEssai = 12, echantillonEssai = 1500 } = options;

  const bs = boiteDe(source);
  const bc = boiteDe(cible);
  const echelle = bc.diagonale / (bs.diagonale || 1);

  let meilleur = null;
  for (let angle = 0; angle < 360; angle += pas) {
    const depart = poseInitiale(bs, bc, echelle, (angle * Math.PI) / 180);
    const essai = recaler(source, cible, depart, {
      iterations: iterationsEssai,
      echantillon: echantillonEssai,
    });
    if (!meilleur || essai.rmse < meilleur.essai.rmse) meilleur = { angle, essai };
  }

  const abouti = recaler(source, cible, meilleur.essai.M, options);
  return { ...abouti, angleRetenu: meilleur.angle, essais: Math.round(360 / pas) };
}

// Pose la source sur la cible : même empreinte au sol, même assise, tournée
// d'un angle autour de la verticale.
function poseInitiale(bs, bc, c, theta) {
  const cos = Math.cos(theta) * c;
  const sin = Math.sin(theta) * c;
  // Le centre en X et Z, mais le BAS en Y : les deux modèles sont posés sur
  // zéro, et c'est leur assise qui coïncide, pas le milieu de leur hauteur.
  const source = [bs.centre[0], bs.mn[1], bs.centre[2]];
  const cible = [bc.centre[0], bc.mn[1], bc.centre[2]];
  const tourne = [
    cos * source[0] + sin * source[2],
    c * source[1],
    -sin * source[0] + cos * source[2],
  ];
  return [
    cos, 0, -sin, 0,
    0, c, 0, 0,
    sin, 0, cos, 0,
    cible[0] - tourne[0], cible[1] - tourne[1], cible[2] - tourne[2], 1,
  ];
}

function boiteDe(points) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i += 1) {
      if (p[i] < mn[i]) mn[i] = p[i];
      if (p[i] > mx[i]) mx[i] = p[i];
    }
  }
  return {
    mn,
    mx,
    centre: mx.map((x, i) => (x + mn[i]) / 2),
    diagonale: Math.hypot(...mx.map((x, i) => x - mn[i])),
  };
}
