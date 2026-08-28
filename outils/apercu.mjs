// Rend un objet du catalogue en image, tel que le visualiseur l'affichera.
//
//   node outils/apercu.mjs cadre-1
//   node outils/apercu.mjs cadre-1 --capture 2 --taille 700
//   node outils/apercu.mjs cadre-1 --azimut 97 --elevation 16 --marge 0.56
//   node outils/apercu.mjs cadre-1 --perspective --format 1356x675
//   node outils/apercu.mjs --tous
//
// POURQUOI CET OUTIL EXISTE. silhouette.mjs projette un nuage de points : il
// dit si un objet est couché ou dressé, et rien d'autre. Il ne peut pas dire
// qu'un cadre est présenté de dos, ni qu'il a la tête en bas — pour ça il faut
// voir la TEXTURE. Sans navigateur, la seule façon de la voir est de la rendre
// ici : un rastériseur logiciel de cent lignes, avec tampon de profondeur, qui
// écrit un PNG qu'on peut ouvrir.
//
// La caméra reproduit exactement celle du visualiseur : mêmes azimut et
// élévation que reglages.affichage.vueInitiale, même verticale, même cadrage
// sur la boîte englobante. Ce qu'on voit ici est ce qu'on verra là-bas.
//
// DEUX PROJECTIONS, DEUX USAGES. Par défaut, orthographique : elle suffit à
// juger une orientation et ne dépend ni de la fenêtre ni de la distance.
//
// « --perspective » rend au contraire ce que le visualiseur rend : même champ
// de vision, même marge de cadrage, même couleur de fond, dans le format d'une
// fenêtre. C'est le mode à prendre pour comparer à une capture d'écran de
// l'application — sur un objet posé au milieu d'un grand sol, l'orthographique
// et la perspective ne placent pas du tout les mêmes choses aux mêmes endroits,
// et chercher un azimut en comparant l'une à l'autre revient à chasser un
// décalage qui n'existe pas. Les trois options --azimut, --elevation et --marge
// essaient une vue sans rien réingérer ; c'est ainsi que se choisit une
// vueInitiale, en quelques rendus plutôt qu'à l'aveugle.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { IDENTITE, appliquer, multiplier } from './lib/matrice.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/* ------------------------------------------------- lecture de la géométrie */

async function lireModele(chemin) {
  const doc = await io.read(chemin);
  const morceaux = [];
  const parcourir = (noeud, parent) => {
    const M = multiplier(parent, noeud.getMatrix());
    const maille = noeud.getMesh();
    if (maille) {
      for (const prim of maille.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const uv = prim.getAttribute('TEXCOORD_0');
        const nor = prim.getAttribute('NORMAL');
        const idx = prim.getIndices();
        if (!pos) continue;

        // UN NUAGE DE POINTS N'A PAS D'INDICES, ET CE N'EST PAS UNE ERREUR.
        //
        // Le relevé LiDAR est publié en mode POINTS. Sans ce cas, la primitive
        // était écartée avec les maillages cassés et l'aperçu rendait une image
        // noire — c'est-à-dire qu'il aurait dit « rien à voir » d'un fichier de
        // quatre mégaoctets. On les dessine comme le fait le visualiseur : un
        // petit disque par point, dans sa couleur de sommet.
        if (!idx || prim.getMode() === 0) {
          const couleur = prim.getAttribute('COLOR_0');
          const points = [];
          const teintes = [];
          for (let i = 0; i < pos.getCount(); i += 1) {
            points.push(appliquer(M, pos.getElement(i, [0, 0, 0])));
            const c = couleur ? couleur.getElement(i, [1, 1, 1, 1]) : [1, 1, 1, 1];
            teintes.push([c[0] * 255, c[1] * 255, c[2] * 255]);
          }
          morceaux.push({ nuage: true, points, teintes });
          continue;
        }

        const sommets = [];
        const uvs = [];
        const normales = [];
        for (let i = 0; i < pos.getCount(); i += 1) {
          sommets.push(appliquer(M, pos.getElement(i, [0, 0, 0])));
          uvs.push(uv ? uv.getElement(i, [0, 0]) : [0, 0]);
          normales.push(nor ? nor.getElement(i, [0, 0, 0]) : [0, 1, 0]);
        }
        morceaux.push({
          sommets,
          uvs,
          normales,
          indices: idx.getArray(),
          texture: prim.getMaterial()?.getBaseColorTexture() ?? null,
        });
      }
    }
    for (const enfant of noeud.listChildren()) parcourir(enfant, M);
  };
  for (const noeud of doc.getRoot().getDefaultScene().listChildren()) parcourir(noeud, IDENTITE);
  return morceaux;
}

/* -------------------------------------------------------------- la caméra */

// Reprend le calcul de scene3d.cadrer : une direction construite en
// coordonnées sphériques, l'élévation comptée depuis l'horizon.
function repereVue(azimut, elevation) {
  const phi = ((90 - elevation) * Math.PI) / 180;
  const theta = (azimut * Math.PI) / 180;
  const z = [
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  ];
  const haut = [0, 1, 0];
  let x = [
    haut[1] * z[2] - haut[2] * z[1],
    haut[2] * z[0] - haut[0] * z[2],
    haut[0] * z[1] - haut[1] * z[0],
  ];
  let n = Math.hypot(...x);
  // Regard exactement vertical : la verticale ne définit plus de droite, on en
  // choisit une arbitrairement plutôt que de diviser par zéro.
  if (n < 1e-6) { x = [1, 0, 0]; n = 1; }
  x = x.map((v) => v / n);
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return { x, y, z };
}

/* ------------------------------------------------------------ rastérisation */

// LES DEUX PROJECTIONS.
//
// ORTHOGRAPHIQUE par défaut : elle répond à « le cadre est-il présenté de dos,
// le spécimen a-t-il la tête en bas », et elle y répond sans dépendre ni de la
// fenêtre ni de la distance.
//
// PERSPECTIVE sur demande : celle du visualiseur, même champ de vision, même
// règle de cadrage, même format d'image. Elle répond à une autre question —
// « verra-t-on CETTE image-là ? » — et il faut la poser dès qu'on compare
// l'aperçu à une capture d'écran de l'application. La différence n'est pas
// cosmétique quand un sol s'étend loin devant : en perspective il s'ouvre vers
// le bas du cadre et ramène les objets lointains vers le centre, en
// orthographique il reste une bande et tout garde sa taille.
async function rendre(morceaux, {
  azimut, elevation, marge, taille, sansCull, grille, emprise,
  perspective = false, aspect = 1, champVision = 30, fond = [24, 24, 24],
}) {
  const { x: ax, y: ay, z: az } = repereVue(azimut, elevation);
  const pt = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
  const H = taille;
  const L = Math.max(1, Math.round(taille * aspect));

  let mnX = Infinity; let mxX = -Infinity; let mnY = Infinity; let mxY = -Infinity;
  const bmn = [Infinity, Infinity, Infinity];
  const bmx = [-Infinity, -Infinity, -Infinity];
  for (const m of morceaux) {
    for (const p of (m.nuage ? m.points : m.sommets)) {
      const u = pt(ax, p); const v = pt(ay, p);
      if (u < mnX) mnX = u; if (u > mxX) mxX = u;
      if (v < mnY) mnY = v; if (v > mxY) mxY = v;
      for (let i = 0; i < 3; i += 1) {
        if (p[i] < bmn[i]) bmn[i] = p[i];
        if (p[i] > bmx[i]) bmx[i] = p[i];
      }
    }
  }
  const cx = (mxX + mnX) / 2;
  const cy = (mxY + mnY) / 2;
  const echelle = Math.min(L / ((mxX - mnX) * marge), H / ((mxY - mnY) * marge));

  // projeter(p) rend [x écran, y écran, profondeur], profondeur croissante vers
  // la caméra ; rayonPoint(profondeur) rend le rayon en pixels d'un point du
  // nuage vu à cette profondeur.
  let projeter;
  let rayonPoint;
  if (perspective) {
    // Reprend distanceDeCadrage de scene3d : la plus petite distance à laquelle
    // les huit coins de la boîte tiennent encore dans le tronc de vision.
    const tanV = Math.tan((champVision * Math.PI) / 360);
    const tanH = tanV * (L / H);
    const cible = [(bmn[0] + bmx[0]) / 2, (bmn[1] + bmx[1]) / 2, (bmn[2] + bmx[2]) / 2];
    let distance = 0;
    for (const x of [bmn[0], bmx[0]]) {
      for (const y of [bmn[1], bmx[1]]) {
        for (const z of [bmn[2], bmx[2]]) {
          const c = [x - cible[0], y - cible[1], z - cible[2]];
          const profondeurCoin = pt(az, c);
          distance = Math.max(
            distance,
            profondeurCoin + Math.abs(pt(ax, c)) / tanH,
            profondeurCoin + Math.abs(pt(ay, c)) / tanV,
          );
        }
      }
    }
    distance *= marge;
    const diagonale = Math.hypot(bmx[0] - bmn[0], bmx[1] - bmn[1], bmx[2] - bmn[2]);
    projeter = (p) => {
      const c = [p[0] - cible[0], p[1] - cible[1], p[2] - cible[2]];
      const w = distance - pt(az, c);
      if (w <= 1e-4) return null;
      return [
        ((pt(ax, c) / (w * tanH)) * 0.5 + 0.5) * L,
        (0.5 - (pt(ay, c) / (w * tanV)) * 0.5) * H,
        -w,
      ];
    };
    // Le visualiseur donne aux points une taille en unités du monde
    // (sizeAttenuation) : à l'écran, ils grossissent en approchant.
    rayonPoint = (z) => Math.max(0.5, ((diagonale / 700) / 2 / (-z * tanV)) * (H / 2));
  } else {
    projeter = (p) => [
      (pt(ax, p) - cx) * echelle + L / 2,
      H / 2 - (pt(ay, p) - cy) * echelle,
      pt(az, p),
    ];
    const diag = Math.hypot(mxX - mnX, mxY - mnY);
    const rayon = Math.max(0.6, (diag / 700) * echelle * 0.5);
    rayonPoint = () => rayon;
  }

  // LE FOND EST CELUI DE L'APPLICATION EN PERSPECTIVE.
  //
  // Sur fond sombre, impossible de dire si une plage claire au bord de
  // l'image est une bâche posée au sol ou le vide au-delà du sol relevé —
  // et c'est exactement ce qu'on cherche à reconnaître quand on compare
  // l'aperçu à une capture d'écran. Avec la couleur de fond du visualiseur,
  // la question ne se pose plus : ce qui est fond a la même teinte des deux
  // côtés.
  const couleurs = new Uint8Array(L * H * 3);
  for (let i = 0; i < couleurs.length; i += 3) {
    couleurs[i] = fond[0]; couleurs[i + 1] = fond[1]; couleurs[i + 2] = fond[2];
  }
  const profondeur = new Float32Array(L * H).fill(-Infinity);

  for (const m of morceaux) {
    if (m.nuage) {
      for (let i = 0; i < m.points.length; i += 1) {
        const e = projeter(m.points[i]);
        if (!e) continue;
        const [sx, sy, sz] = e;
        const rayon = rayonPoint(sz);
        const r2 = rayon * rayon;
        const [tr, tv, tb] = m.teintes[i];
        for (let y = Math.floor(sy - rayon); y <= Math.ceil(sy + rayon); y += 1) {
          if (y < 0 || y >= H) continue;
          for (let x = Math.floor(sx - rayon); x <= Math.ceil(sx + rayon); x += 1) {
            if (x < 0 || x >= L) continue;
            if ((x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2 > r2) continue;
            const k = y * L + x;
            if (sz <= profondeur[k]) continue;
            profondeur[k] = sz;
            couleurs[k * 3] = tr; couleurs[k * 3 + 1] = tv; couleurs[k * 3 + 2] = tb;
          }
        }
      }
      continue;
    }
    let tex = null;
    if (m.texture) {
      const brut = await sharp(Buffer.from(m.texture.getImage()))
        .raw().toColourspace('srgb').toBuffer({ resolveWithObject: true });
      tex = { data: brut.data, w: brut.info.width, h: brut.info.height, c: brut.info.channels };
    }

    // Les sommets en coordonnées écran, une fois pour toutes.
    const ecran = m.sommets.map(projeter);

    for (let t = 0; t < m.indices.length; t += 3) {
      const i0 = m.indices[t]; const i1 = m.indices[t + 1]; const i2 = m.indices[t + 2];
      const a = ecran[i0]; const b = ecran[i1]; const c = ecran[i2];
      // Un sommet derrière la caméra : le triangle n'a pas de projection
      // honnête, on le laisse.
      if (!a || !b || !c) continue;
      const aire = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(aire) < 1e-9) continue;

      // ÉLIMINATION DES FACES ARRIÈRE, comme le fait three.js.
      //
      // Sans elle cet outil ment. Il montrait la surface la plus proche quelle
      // que soit son orientation, donc la face peinte d'un tableau même quand
      // le maillage la présentait à l'envers — pendant que l'application, qui
      // rend en side: FrontSide, éliminait cette même surface et affichait le
      // dos. Deux cadres sur quatre étaient dans ce cas, et l'aperçu disait que
      // tout allait bien.
      //
      // La normale géométrique vient de l'ordre des sommets, exactement comme
      // pour le GPU : une face tournée vers la caméra a sa normale du côté de
      // l'axe de vue.
      const p0 = m.sommets[i0]; const p1 = m.sommets[i1]; const p2 = m.sommets[i2];
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const g = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      if (!sansCull && pt(az, g) <= 0) continue;

      // Éclairage minimal : la normale contre l'axe de vue. Le but n'est pas un
      // beau rendu, c'est de distinguer un relief d'un aplat.
      const nz = Math.abs(pt(az, m.normales[i0]));
      const lumiere = 0.55 + 0.45 * Math.min(1, Math.max(0, nz));

      const xMin = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const xMax = Math.min(L - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const yMin = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const yMax = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));

      for (let y = yMin; y <= yMax; y += 1) {
        for (let x = xMin; x <= xMax; x += 1) {
          const px = x + 0.5; const py = y + 0.5;
          const l0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / aire;
          const l1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / aire;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;

          const z = l0 * a[2] + l1 * b[2] + l2 * c[2];
          const k = y * L + x;
          if (z <= profondeur[k]) continue;
          profondeur[k] = z;

          let r = 200; let vert = 200; let bl = 200;
          if (tex) {
            const su = l0 * m.uvs[i0][0] + l1 * m.uvs[i1][0] + l2 * m.uvs[i2][0];
            const sv = l0 * m.uvs[i0][1] + l1 * m.uvs[i1][1] + l2 * m.uvs[i2][1];
            const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(su * tex.w)));
            const ty = Math.min(tex.h - 1, Math.max(0, Math.floor(sv * tex.h)));
            const o = (ty * tex.w + tx) * tex.c;
            r = tex.data[o]; vert = tex.data[o + 1]; bl = tex.data[o + 2];
          }
          couleurs[k * 3] = Math.min(255, r * lumiere);
          couleurs[k * 3 + 1] = Math.min(255, vert * lumiere);
          couleurs[k * 3 + 2] = Math.min(255, bl * lumiere);
        }
      }
    }
  }

  // LA GRILLE DE RECADRAGE.
  //
  // « --recadrer x0,y0,x1,y1 » attend des fractions de la boîte englobante de
  // l'objet redressé, et rien dans le rendu ne dit où tombe 0,07. On les lisait
  // donc au jugé, on réingérait, on regardait, on recommençait — et sur Cadre 2
  // ce tâtonnement a fini par manger le bas du cadre.
  //
  // Ces lignes SONT ces fractions. Le repère est celui de la boîte, pas celui
  // de l'image : elles sont posées sur mn→mx de la géométrie projetée, la marge
  // de cadrage exclue. Ce qu'on lit ici se recopie tel quel dans la commande.
  //
  // Elles n'ont de sens qu'en orthographique, la seule projection où une
  // fraction de la boîte tombe toujours au même endroit de l'image.
  const versX = (f) => Math.round((mnX + f * (mxX - mnX) - cx) * echelle + L / 2);
  const versY = (f) => Math.round(H / 2 - (mnY + f * (mxY - mnY) - cy) * echelle);
  const poser = (x, y, [r, v, b]) => {
    if (x < 0 || x >= L || y < 0 || y >= H) return;
    const k = (y * L + x) * 3;
    couleurs[k] = r; couleurs[k + 1] = v; couleurs[k + 2] = b;
  };

  // L'EMPRISE PROPOSÉE, AVANT DE LA DÉCOUPER POUR DE BON.
  //
  // Choisir un recadrage coûtait une réingestion complète par essai — plusieurs
  // minutes pour apprendre qu'on s'était trompé de deux centièmes. Ici la même
  // décision se prend en quelques secondes : ce qui sortira de l'emprise est
  // assombri, le cadre retenu est tracé. On itère sur l'image, on n'ingère
  // qu'une fois, avec des nombres qu'on a vus.
  if (emprise && !perspective) {
    const [x0, y0, x1, y1] = emprise;
    const gx0 = versX(x0); const gx1 = versX(x1);
    const gy0 = versY(y1); const gy1 = versY(y0);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < L; x += 1) {
        if (x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) continue;
        const k = (y * L + x) * 3;
        couleurs[k] = (couleurs[k] * 0.28) | 0;
        couleurs[k + 1] = (couleurs[k + 1] * 0.28) | 0;
        couleurs[k + 2] = (couleurs[k + 2] * 0.34) | 0;
      }
    }
    for (let x = gx0; x <= gx1; x += 1) { poser(x, gy0, [80, 230, 140]); poser(x, gy1, [80, 230, 140]); }
    for (let y = gy0; y <= gy1; y += 1) { poser(gx0, y, [80, 230, 140]); poser(gx1, y, [80, 230, 140]); }
  }

  if (grille && !perspective) {
    for (let i = 0; i <= 20; i += 1) {
      const f = i / 20;
      // Les dixièmes en clair, les vingtièmes en sombre : on compte les
      // graduations sans avoir à les mesurer.
      const teinte = i % 2 === 0 ? [255, 96, 64] : [120, 120, 140];
      const gx = versX(f);
      const gy = versY(f);
      for (let p = 0; p < Math.max(L, H); p += 1) {
        // Pointillé pour ne pas cacher ce qu'on est en train de juger.
        if (p % 6 < 3) { poser(gx, p, teinte); poser(p, gy, teinte); }
      }
      // Une encoche pleine au bord, pour retrouver les dixièmes du regard.
      if (i % 2 === 0) {
        for (let p = 0; p < 10; p += 1) {
          poser(gx, p, teinte); poser(gx, H - 1 - p, teinte);
          poser(p, gy, teinte); poser(L - 1 - p, gy, teinte);
        }
      }
    }
  }

  return sharp(Buffer.from(couleurs), { raw: { width: L, height: H, channels: 3 } });
}

/* ------------------------------------------------------------------ pilote */

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : defaut;
};
const taille = Number(option('taille', '560'));
// La vignette publiée ne suit pas --taille : voir plus bas.
const TAILLE_VIGNETTE = 900;
const iCapture = Number(option('capture', '1'));
const tous = args.includes('--tous');
// Pour comparer : sans elimination, on voit la surface la plus proche quelle que
// soit son orientation. L ecart entre les deux rendus EST le probleme.
const sansCull = args.includes('--sans-cull');
// Les fractions de « --recadrer », tracées sur l'objet : rouge aux dixièmes,
// gris aux vingtièmes. Sert à choisir un recadrage en le lisant plutôt qu'en
// le devinant.
const grille = args.includes('--grille');
// Un recadrage a l essai, dans les memes fractions que « ingerer.mjs --recadrer ».
const emprise = (option('recadrer', null) ?? '').split(',').map(Number).filter(Number.isFinite);
const empriseValide = emprise.length === 4 ? emprise : null;
// Pour essayer une vue sans reingerer : le manifeste garde la sienne, ces deux
// options ne changent que le rendu.
const forceAzimut = option('azimut', null);
const forceElevation = option('elevation', null);
// Le cadrage lui aussi s'essaie sans réingérer : « --marge 0.5 » approche la
// caméra de moitié, « --marge 1.4 » recule d'autant.
const forceMarge = option('marge', null);
// La perspective du visualiseur, et le format de sa fenêtre : « --perspective »
// seul prend 1356×675, la fenêtre d'un portable, « --format 1600x900 » la change.
const perspective = args.includes('--perspective');
const format = (option('format', '1356x675') ?? '').split('x').map(Number);
const aspect = perspective && format.length === 2 && format.every(Number.isFinite)
  ? format[0] / format[1] : 1;

// LE CHAMP DE VISION ET LA MARGE NE SONT PAS RECOPIÉS ICI : ILS SONT LUS.
//
// Un aperçu qui promet la vue de l'application ne peut pas dériver d'elle en
// silence. Les deux nombres viennent donc de src/reglages.js, à chaque rendu ;
// s'ils y changent, l'aperçu change avec eux.
const reglages = fs.readFileSync(new URL('../src/reglages.js', import.meta.url), 'utf8');
const champVision = Number(/champVision:\s*([\d.]+)/.exec(reglages)?.[1] ?? 30);
const margeCamera = Number(/marge:\s*([\d.]+)/.exec(reglages)?.[1] ?? 1.22);
const teinteFond = /couleur:\s*'#([0-9a-fA-F]{6})'/.exec(reglages)?.[1] ?? 'ecebe7';
const fondClair = [0, 2, 4].map((i) => parseInt(teinteFond.slice(i, i + 2), 16));

const cibles = tous
  ? JSON.parse(fs.readFileSync('objets/catalogue.json', 'utf8')).map((e) => e.id)
  : args.filter((a) => !a.startsWith('--') && fs.existsSync(path.join('objets', a)));

if (cibles.length === 0) {
  console.error('Usage : node outils/apercu.mjs <objet> [--capture N] [--taille N]');
  console.error('        node outils/apercu.mjs <objet> --perspective [--format 1356x675]');
  console.error('        node outils/apercu.mjs --tous');
  process.exit(2);
}

fs.mkdirSync('apercus', { recursive: true });
for (const id of cibles) {
  const dossier = path.join('objets', id);
  const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'objet.json'), 'utf8'));
  const session = manifeste.sessions[iCapture - 1];
  if (!session) continue;
  const vue = manifeste.reglages?.affichage?.vueInitiale ?? { azimut: 0, elevation: 0, marge: 1 };
  const morceaux = await lireModele(path.join(dossier, session.glb));
  const reglagesRendu = {
    azimut: forceAzimut !== null ? Number(forceAzimut) : (vue.azimut ?? 0),
    elevation: forceElevation !== null ? Number(forceElevation) : (vue.elevation ?? 0),
    // En orthographique la marge élargit le cadrage ; en perspective elle
    // recule la caméra, exactement comme dans scene3d.cadrer.
    marge: (forceMarge !== null ? Number(forceMarge) : (vue.marge ?? 1))
      * (perspective ? margeCamera : 1.1),
    sansCull,
    grille,
    emprise: empriseValide,
    perspective,
    aspect,
    champVision,
    // Le fond du visualiseur en perspective ; le gris sombre ailleurs, où il
    // sert à lire une silhouette.
    fond: perspective ? fondClair : [24, 24, 24],
  };
  const image = await rendre(morceaux, { ...reglagesRendu, taille });
  const suffixe = `${iCapture > 1 ? `-capture${iCapture}` : ''}${sansCull ? '-sans-cull' : ''}`
    + `${grille ? '-grille' : ''}${empriseValide ? '-emprise' : ''}`
    + `${forceElevation !== null ? `-el${forceElevation}` : ''}${forceAzimut !== null ? `-az${forceAzimut}` : ''}`
    + `${forceMarge !== null ? `-m${forceMarge}` : ''}`
    + `${perspective ? '-persp' : ''}`;
  const sortie = path.join('apercus', `${id}${suffixe}.png`);
  await image.png().toFile(sortie);

  // LA VIGNETTE DU CATALOGUE SE REND POUR ELLE-MÊME.
  //
  // Elle est PUBLIÉE : la page d'accueil la sert, donc elle vit à côté du modèle
  // qu'elle montre et se refait à chaque aperçu — aucun risque de présenter un
  // objet d'avant.
  //
  // Mais elle ne se découpe plus dans l'image d'écran : celle-ci suit --taille,
  // et une vignette tirée d'un rendu de 300 pixels puis étirée à 640 est une
  // vignette floue publiée par accident. Elle a donc sa propre taille, fixe, et
  // deux objets rendus le même jour à deux tailles différentes donnent le même
  // fichier.
  const vignette = path.join(dossier, 'vignette.jpg');
  if (forceAzimut === null && forceElevation === null && forceMarge === null && iCapture === 1
    && !sansCull && !grille && !empriseValide && !perspective) {
    const grande = taille >= TAILLE_VIGNETTE ? image : await rendre(morceaux, {
      ...reglagesRendu, taille: TAILLE_VIGNETTE,
    });
    await grande.clone()
      .resize(640, 640, { fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(vignette);
  }

  console.log(`${sortie}  —  ${manifeste.nom}, ${session.label}, `
    + `vue azimut ${vue.azimut} élévation ${vue.elevation}`
    + `${perspective ? `, perspective ${champVision}° en ${Math.round(taille * aspect)}×${taille}` : ''}`);
}
