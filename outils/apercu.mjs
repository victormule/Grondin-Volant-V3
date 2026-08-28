// Rend un objet du catalogue en image, tel que le visualiseur l'affichera.
//
//   node outils/apercu.mjs cadre-1
//   node outils/apercu.mjs cadre-1 --capture 2 --taille 700
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
// La projection est orthographique là où le visualiseur est en perspective :
// la différence ne change ni l'orientation, ni le sens, ni le haut et le bas —
// les seules choses que cet outil sert à vérifier.

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

async function rendre(morceaux, {
  azimut, elevation, marge, taille, sansCull, grille, emprise,
}) {
  const { x: ax, y: ay, z: az } = repereVue(azimut, elevation);
  const pt = (a, p) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];

  let mnX = Infinity; let mxX = -Infinity; let mnY = Infinity; let mxY = -Infinity;
  for (const m of morceaux) {
    for (const p of (m.nuage ? m.points : m.sommets)) {
      const u = pt(ax, p); const v = pt(ay, p);
      if (u < mnX) mnX = u; if (u > mxX) mxX = u;
      if (v < mnY) mnY = v; if (v > mxY) mxY = v;
    }
  }
  const etendue = Math.max(mxX - mnX, mxY - mnY) * marge;
  const cx = (mxX + mnX) / 2;
  const cy = (mxY + mnY) / 2;
  const echelle = taille / etendue;

  const couleurs = new Uint8Array(taille * taille * 3).fill(24);
  const profondeur = new Float32Array(taille * taille).fill(-Infinity);

  for (const m of morceaux) {
    if (m.nuage) {
      // Le rayon suit la taille que le visualiseur donne aux points : la
      // diagonale sur sept cents, convertie en pixels par la meme echelle.
      const diag = Math.hypot(mxX - mnX, mxY - mnY);
      const rayon = Math.max(0.6, (diag / 700) * echelle * 0.5);
      const r2 = rayon * rayon;
      for (let i = 0; i < m.points.length; i += 1) {
        const p = m.points[i];
        const sx = (pt(ax, p) - cx) * echelle + taille / 2;
        const sy = taille / 2 - (pt(ay, p) - cy) * echelle;
        const sz = pt(az, p);
        const [tr, tv, tb] = m.teintes[i];
        for (let y = Math.floor(sy - rayon); y <= Math.ceil(sy + rayon); y += 1) {
          if (y < 0 || y >= taille) continue;
          for (let x = Math.floor(sx - rayon); x <= Math.ceil(sx + rayon); x += 1) {
            if (x < 0 || x >= taille) continue;
            if ((x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2 > r2) continue;
            const k = y * taille + x;
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
    const ecran = m.sommets.map((p) => [
      (pt(ax, p) - cx) * echelle + taille / 2,
      taille / 2 - (pt(ay, p) - cy) * echelle,
      pt(az, p),
    ]);

    for (let t = 0; t < m.indices.length; t += 3) {
      const i0 = m.indices[t]; const i1 = m.indices[t + 1]; const i2 = m.indices[t + 2];
      const a = ecran[i0]; const b = ecran[i1]; const c = ecran[i2];
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
      const xMax = Math.min(taille - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const yMin = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const yMax = Math.min(taille - 1, Math.ceil(Math.max(a[1], b[1], c[1])));

      for (let y = yMin; y <= yMax; y += 1) {
        for (let x = xMin; x <= xMax; x += 1) {
          const px = x + 0.5; const py = y + 0.5;
          const l0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / aire;
          const l1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / aire;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;

          const z = l0 * a[2] + l1 * b[2] + l2 * c[2];
          const k = y * taille + x;
          if (z <= profondeur[k]) continue;
          profondeur[k] = z;

          let r = 200; let g = 200; let bl = 200;
          if (tex) {
            const u = l0 * m.uvs[i0][0] + l1 * m.uvs[i1][0] + l2 * m.uvs[i2][0];
            const v = l0 * m.uvs[i0][1] + l1 * m.uvs[i1][1] + l2 * m.uvs[i2][1];
            const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(u * tex.w)));
            const ty = Math.min(tex.h - 1, Math.max(0, Math.floor(v * tex.h)));
            const o = (ty * tex.w + tx) * tex.c;
            r = tex.data[o]; g = tex.data[o + 1]; bl = tex.data[o + 2];
          }
          couleurs[k * 3] = Math.min(255, r * lumiere);
          couleurs[k * 3 + 1] = Math.min(255, g * lumiere);
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
  const versX = (f) => Math.round((mnX + f * (mxX - mnX) - cx) * echelle + taille / 2);
  const versY = (f) => Math.round(taille / 2 - (mnY + f * (mxY - mnY) - cy) * echelle);
  const poser = (x, y, [r, v, b]) => {
    if (x < 0 || x >= taille || y < 0 || y >= taille) return;
    const k = (y * taille + x) * 3;
    couleurs[k] = r; couleurs[k + 1] = v; couleurs[k + 2] = b;
  };

  // L'EMPRISE PROPOSÉE, AVANT DE LA DÉCOUPER POUR DE BON.
  //
  // Choisir un recadrage coûtait une réingestion complète par essai — plusieurs
  // minutes pour apprendre qu'on s'était trompé de deux centièmes. Ici la même
  // décision se prend en quelques secondes : ce qui sortira de l'emprise est
  // assombri, le cadre retenu est tracé. On itère sur l'image, on n'ingère
  // qu'une fois, avec des nombres qu'on a vus.
  if (emprise) {
    const [x0, y0, x1, y1] = emprise;
    const gx0 = versX(x0); const gx1 = versX(x1);
    const gy0 = versY(y1); const gy1 = versY(y0);
    for (let y = 0; y < taille; y += 1) {
      for (let x = 0; x < taille; x += 1) {
        if (x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) continue;
        const k = (y * taille + x) * 3;
        couleurs[k] = (couleurs[k] * 0.28) | 0;
        couleurs[k + 1] = (couleurs[k + 1] * 0.28) | 0;
        couleurs[k + 2] = (couleurs[k + 2] * 0.34) | 0;
      }
    }
    for (let x = gx0; x <= gx1; x += 1) { poser(x, gy0, [80, 230, 140]); poser(x, gy1, [80, 230, 140]); }
    for (let y = gy0; y <= gy1; y += 1) { poser(gx0, y, [80, 230, 140]); poser(gx1, y, [80, 230, 140]); }
  }

  if (grille) {
    for (let i = 0; i <= 20; i += 1) {
      const f = i / 20;
      // Les dixièmes en clair, les vingtièmes en sombre : on compte les
      // graduations sans avoir à les mesurer.
      const teinte = i % 2 === 0 ? [255, 96, 64] : [120, 120, 140];
      const gx = versX(f);
      const gy = versY(f);
      for (let p = 0; p < taille; p += 1) {
        // Pointillé pour ne pas cacher ce qu'on est en train de juger.
        if (p % 6 < 3) { poser(gx, p, teinte); poser(p, gy, teinte); }
      }
      // Une encoche pleine au bord, pour retrouver les dixièmes du regard.
      if (i % 2 === 0) {
        for (let p = 0; p < 10; p += 1) {
          poser(gx, p, teinte); poser(gx, taille - 1 - p, teinte);
          poser(p, gy, teinte); poser(taille - 1 - p, gy, teinte);
        }
      }
    }
  }

  return sharp(Buffer.from(couleurs), { raw: { width: taille, height: taille, channels: 3 } });
}

/* ------------------------------------------------------------------ pilote */

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : defaut;
};
const taille = Number(option('taille', '560'));
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
const cibles = tous
  ? JSON.parse(fs.readFileSync('objets/catalogue.json', 'utf8')).map((e) => e.id)
  : args.filter((a) => !a.startsWith('--') && fs.existsSync(path.join('objets', a)));

if (cibles.length === 0) {
  console.error('Usage : node outils/apercu.mjs <objet> [--capture N] [--taille N]');
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
  const image = await rendre(morceaux, {
    azimut: forceAzimut !== null ? Number(forceAzimut) : (vue.azimut ?? 0),
    elevation: forceElevation !== null ? Number(forceElevation) : (vue.elevation ?? 0),
    marge: (vue.marge ?? 1) * 1.1,
    taille,
    sansCull,
    grille,
    emprise: empriseValide,
  });
  const suffixe = `${iCapture > 1 ? `-capture${iCapture}` : ''}${sansCull ? '-sans-cull' : ''}`
    + `${grille ? '-grille' : ''}${empriseValide ? '-emprise' : ''}`
    + `${forceElevation !== null ? `-el${forceElevation}` : ''}${forceAzimut !== null ? `-az${forceAzimut}` : ''}`;
  const sortie = path.join('apercus', `${id}${suffixe}.png`);
  await image.png().toFile(sortie);

  // La même image sert de vignette au catalogue. Celle-là est PUBLIÉE : la page
  // d’accueil la sert, donc elle vit à côté du modèle qu’elle montre et se
  // refait à chaque ingestion — aucun risque de présenter un objet d’avant.
  if (forceAzimut === null && forceElevation === null && iCapture === 1 && !sansCull && !grille && !empriseValide) {
    await image.clone()
      .resize(640, 640, { fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(dossier, 'vignette.jpg'));
  }

  console.log(`${sortie}  —  ${manifeste.nom}, ${session.label}, `
    + `vue azimut ${vue.azimut} élévation ${vue.elevation}`);
}
