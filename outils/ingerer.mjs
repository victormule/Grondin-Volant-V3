// Transforme un export dür.air en un objet du catalogue.
//
//   node outils/ingerer.mjs "<dossier d'export>" --id cadre-1 --nom "Cadre 1"
//
// Ce que fait la commande, capture par capture :
//
//   1. repère les captures qui portent un modèle photogrammétrique ;
//   2. amène chacune dans le repère de la première (matrice dür.air, puis ICP) ;
//   3. convertit l'OBJ en glTF binaire ;
//   4. y rattache la carte de normales et l'occlusion ambiante, que le MTL
//      n'évoque pas alors que les fichiers sont là — sans elles, la lumière
//      rasante n'a plus rien à révéler ;
//   5. cuit la transformation dans les sommets, pour que tous les .glb d'un
//      objet partagent un repère et que l'application n'ait rien à recaler ;
//   6. réencode les textures en WebP ;
//   7. écrit objet.json et _recalage.json.
//
// Ce que la commande NE PEUT PAS faire, et qu'il reste à renseigner à la main :
// l'échelle réelle de l'objet (mesurez une longueur), sa vue d'ouverture, et
// son aplomb s'il ne sort pas d'aplomb des fichiers.

import fs from 'node:fs';
import path from 'node:path';
import obj2gltf from 'obj2gltf';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { clearNodeTransform, textureCompress, dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';

import { inverse, multiplier, echelleDe, IDENTITE } from './lib/matrice.mjs';
import { lireSommetsOBJ, boite, espacement } from './lib/nuage.mjs';
import { recaler, recalerSansAmorce } from './lib/icp.mjs';

/* ------------------------------------------------------------- arguments */

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--'));
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : defaut;
};
const id = option('id');
const nom = option('nom', id);
const reference = option('reference');
const sansIcp = args.includes('--sans-icp');

if (!source || !id) {
  console.error('Usage : node outils/ingerer.mjs "<export>" --id <identifiant> --nom "<nom>"');
  console.error('        --reference <sessionId>   choisit la capture qui fixe le repère');
  console.error('        --sans-icp                matrices dür.air seules, sans raffinement');
  process.exit(2);
}

/* ------------------------------------------------- repérage des captures */

const dossierSessions = path.join(source, 'sessions');
if (!fs.existsSync(dossierSessions)) {
  console.error(`Aucun dossier sessions/ dans ${source}`);
  process.exit(2);
}

const captures = fs.readdirSync(dossierSessions).map((sid) => {
  const photo = path.join(dossierSessions, sid, 'photogrammetry');
  if (!fs.existsSync(photo)) return null;
  const fichiers = fs.readdirSync(photo);
  const obj = fichiers.find((f) => f.endsWith('.obj'));
  const meta = fichiers.find((f) => f.endsWith('_metadata.json'));
  if (!obj || !meta) return null;

  const dossierTextures = fichiers.find((f) => f.endsWith('_textures'));
  const textures = {};
  if (dossierTextures) {
    for (const f of fs.readdirSync(path.join(photo, dossierTextures))) {
      const complet = path.join(photo, dossierTextures, f);
      if (f.endsWith('_norm0.png')) textures.normale = complet;
      else if (f.endsWith('_ao0.png')) textures.occlusion = complet;
      else if (f.endsWith('_tex0.png')) textures.base = complet;
    }
  }

  const m = JSON.parse(fs.readFileSync(path.join(photo, meta), 'utf8'));
  const cheminSession = path.join(dossierSessions, sid, 'session_metadata.json');
  const s = fs.existsSync(cheminSession) ? JSON.parse(fs.readFileSync(cheminSession, 'utf8')) : {};

  return {
    sid,
    obj: path.join(photo, obj),
    textures,
    alignement: m.alignmentInfo ?? null,
    debut: s.start_date ?? s.startDate ?? m.createdAt ?? null,
    fin: s.end_date ?? s.endDate ?? null,
  };
}).filter(Boolean);

if (captures.length === 0) {
  console.error(`Aucune capture avec modèle photogrammétrique dans ${source}.`);
  console.error('Ré-exportez depuis dür.air avec photogrammetry.include_model = true.');
  process.exit(1);
}

for (const c of captures) c.sommets = lireSommetsOBJ(c.obj);

// LA RÉFÉRENCE EST LA CAPTURE LA PLUS DENSE, PAS LA PREMIÈRE.
//
// Elle donne son repère à toutes les autres, et l'application peint et mesure
// sur elle : « Painting and measuring target the first, the frame all the
// others were aligned onto ». C'est donc sa finesse qui plafonne celle de tout
// l'objet. Sur Cadre 1, prendre la première capture dans l'ordre du temps
// désignait celle de 6 876 sommets — arête moyenne de 50 mm au lieu de 12, et
// un résidu de recalage qui suivait. Les autres gardent l'ordre chronologique.
captures.sort((a, b) => String(a.debut ?? '').localeCompare(String(b.debut ?? '')));
const choisie = reference
  ? captures.findIndex((c) => c.sid.startsWith(reference))
  : captures.reduce((meilleure, c, i) => (c.sommets.length > captures[meilleure].sommets.length ? i : meilleure), 0);
if (choisie > 0) captures.unshift(...captures.splice(choisie, 1));

const nuages = captures.map((c) => c.sommets);
const boiteRef = boite(nuages[0]);
const pasRef = espacement(nuages[0]);
const recalages = {};
const ecartes = [];

console.log(`${captures.length} capture(s) — repère fixé par ${captures[0].sid.slice(0, 8)} `
  + `(${captures[0].sommets.length} sommets, arête ${(pasRef * 1000).toFixed(1)} mm)`);
console.log('');

/* ------------------------------------------------------------- recalage */

// Au-delà de quoi un alignement n'en est plus un. Quatre arêtes du maillage de
// référence : à cette distance une annotation posée sur une capture désigne,
// sur l'autre, une zone qui n'a plus rien à voir avec celle qu'on visait.
const SEUIL_REFUS = pasRef * 4;

captures[0].M = IDENTITE;
for (let i = 1; i < captures.length; i += 1) {
  const c = captures[i];
  const t0 = Date.now();
  let r;
  let voie;

  if (c.alignement && captures[0].alignement) {
    const grossier = multiplier(
      inverse(captures[0].alignement.transformMatrix.map(Number)),
      c.alignement.transformMatrix.map(Number),
    );
    if (sansIcp) {
      c.M = grossier;
      console.log(`  ${c.sid.slice(0, 8)} : matrice dür.air seule, sans raffinement`);
      continue;
    }
    r = recaler(nuages[i], nuages[0], grossier);
    voie = 'matrice + ICP';
  } else {
    // Sans matrice, on cherche l'orientation nous-mêmes. Coûteux, mais c'est
    // cela ou publier une capture posée à côté de l'objet.
    r = recalerSansAmorce(nuages[i], nuages[0]);
    voie = `balayage ${r.essais} angles (${r.angleRetenu}°) + ICP`;
  }

  const duree = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const resume = `RMSE ${(r.rmse * 1000).toFixed(1)} mm sur ${(r.partRecouvrement * 100).toFixed(0)} % `
    + `de recouvrement, échelle x${echelleDe(r.M).toFixed(3)}`;

  if (!(r.rmse < SEUIL_REFUS)) {
    // Une capture qu'on ne sait pas recaler n'est pas publiée. Le visualiseur
    // suppose que toutes les captures d'un objet partagent un repère — en
    // glisser une qui ne le partage pas ne se voit qu'en changeant d'onglet,
    // et se voit alors comme un bug du site.
    console.log(`  ${c.sid.slice(0, 8)} : ÉCARTÉE — ${resume} (${voie}, ${duree})`);
    console.log(`               au-delà du seuil de ${(SEUIL_REFUS * 1000).toFixed(0)} mm ; `
      + 'relancez avec --reference sur une autre capture, ou ingérez-la comme objet distinct.');
    ecartes.push({ sid: c.sid, rmse: r.rmse, voie });
    c.ecartee = true;
    continue;
  }

  c.M = r.M;
  recalages[c.sid] = {
    rmse: r.rmse,
    recouvrement: r.partRecouvrement,
    mediane: r.mediane,
    p90: r.p90,
    echelle: echelleDe(r.M),
    voie,
  };
  console.log(`  ${c.sid.slice(0, 8)} : ${resume} (${voie}, ${duree})`);
}

const publiees = captures.filter((c) => !c.ecartee);

/* ------------------------------------------------------------ conversion */

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const cible = path.join('objets', id);
fs.mkdirSync(path.join(cible, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(cible, 'annotations'), { recursive: true });

console.log('');
for (let i = 0; i < publiees.length; i += 1) {
  const c = publiees[i];
  const sortie = path.join(cible, 'sessions', c.sid);
  fs.mkdirSync(sortie, { recursive: true });

  const glb = await obj2gltf(c.obj, { binary: true });
  const doc = await io.readBinary(new Uint8Array(glb));

  // La carte de normales et l'occlusion : le MTL exporté depuis l'USDZ ne
  // déclare que map_Kd, alors que les trois PNG sont côte à côte et partagent
  // le même jeu d'UV. Les laisser de côté reviendrait à jeter le relief — et
  // c'est le relief que la lumière rasante est faite de révéler.
  for (const [role, chemin] of Object.entries(c.textures)) {
    if (role === 'base' || !fs.existsSync(chemin)) continue;
    const tex = doc.createTexture(role)
      .setImage(new Uint8Array(fs.readFileSync(chemin)))
      .setMimeType('image/png');
    for (const mat of doc.getRoot().listMaterials()) {
      if (role === 'normale') mat.setNormalTexture(tex);
      if (role === 'occlusion') mat.setOcclusionTexture(tex);
    }
  }

  // La transformation est cuite dans les sommets plutôt que posée sur un nœud :
  // toutes les captures d'un objet arrivent ainsi dans le même repère avec des
  // nœuds à l'identité, et rien en aval n'a à s'en soucier.
  if (c.M !== IDENTITE) {
    for (const noeud of doc.getRoot().getDefaultScene().listChildren()) {
      noeud.setMatrix(multiplier(c.M, noeud.getMatrix()));
      clearNodeTransform(noeud);
    }
  }

  doc.createExtension(EXTTextureWebP).setRequired(false);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }),
  );

  await io.write(path.join(sortie, 'model.glb'), doc);

  const poids = (f) => `${(fs.statSync(f).size / 1048576).toFixed(1)} Mo`;
  console.log(`  ${c.sid.slice(0, 8)}  model.glb ${poids(path.join(sortie, 'model.glb'))}`);
}

/* --------------------------------------------------------- le manifeste */

const dateFr = (iso) => (iso
  ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  : '');
const heureFr = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  : '');

// Des distances de caméra tirées de la taille du modèle : un cadre de deux
// mètres et un poisson de vingt centimètres ne se regardent pas de la même
// distance, et les bornes du poisson interdiraient de reculer devant le cadre.
const { diagonale } = boiteRef;

const manifeste = {
  nom,
  // Le repère est daté de l'ingestion : relancer cette commande produit une
  // géométrie qui n'est pas exactement la même — l'ICP repart des mêmes
  // matrices mais pas forcément vers le même point — et les annotations posées
  // sur la précédente ne désigneraient plus tout à fait le même endroit.
  repere: `${id}/oc-${new Date().toISOString().slice(0, 7)}`,
  recalage: 'sessions/_recalage.json',
  sessions: publiees.map((c, i) => ({
    id: c.sid,
    label: `Capture ${i + 1}`,
    date: dateFr(c.debut),
    time: c.debut && c.fin ? `${heureFr(c.debut)} – ${heureFr(c.fin)}` : heureFr(c.debut),
    glb: `sessions/${c.sid}/model.glb`,
  })),
  reglages: {
    camera: {
      distanceMin: Number((diagonale / 12).toPrecision(2)),
      distanceMax: Number((diagonale * 4).toPrecision(2)),
    },
    peinture: {
      taille: Math.min(80, Math.max(1, Math.round(diagonale * 1000 * 0.015))),
      tailleGomme: Math.min(80, Math.max(1, Math.round(diagonale * 1000 * 0.018))),
    },
    affichage: {
      vueInitiale: { azimut: 0, elevation: 20, marge: 1 },
      aplomb: null,
      axeRotation: { point: [0, boiteRef.mn[1], 0], direction: [0, 1, 0] },
    },
    // mesure : À COMPLÉTER. Mesurez une longueur réelle sur l'objet, lisez la
    // même dans le modèle, et ajoutez ici :
    //   "mesure": { "longueurModeleReference": …, "longueurReelleReference": … }
    // Tant que ces deux nombres manquent, la fiche du projet affiche
    // « non calibrée » plutôt que des chiffres en unités de modèle.
  },
};

fs.writeFileSync(path.join(cible, 'objet.json'), `${JSON.stringify(manifeste, null, 2)}\n`);

fs.writeFileSync(path.join(cible, 'sessions', '_recalage.json'), `${JSON.stringify({
  reference: publiees[0].sid,
  note: 'Résidu du recalage de chaque capture sur la capture de référence. Le RMSE est '
    + 'mesuré sur le recouvrement géométrique : les points dont le plus proche voisin '
    + 'dépasse trois espacements de maillage regardent une surface que l’autre capture '
    + 'n’a pas vue et n’ont rien à dire sur l’alignement. « recouvrement » est la part '
    + 'de points retenus. Unités du modèle.',
  espacementMaillage: pasRef,
  ...recalages,
}, null, 2)}\n`);

// Un document publié vide, dans le repère de l'objet : sans lui l'application
// charge un document sans repère, que frameCompatible refuserait dès la
// première annotation posée.
const cheminDoc = path.join(cible, 'annotations', 'annotations.json');
if (!fs.existsSync(cheminDoc)) {
  fs.writeFileSync(cheminDoc, `${JSON.stringify({
    version: 3,
    repere: manifeste.repere,
    sessionReference: publiees[0].sid,
    racine: { id: 'racine', type: 'groupe', enfants: [] },
    medias: [],
  }, null, 2)}\n`);
}

console.log('');
console.log(`objets/${id}/ écrit — ${publiees.length} capture(s) publiée(s).`);
console.log(`  diagonale du modèle : ${diagonale.toFixed(3)} unités`);
console.log(`  arête moyenne       : ${(pasRef * 1000).toFixed(1)} mm (unités du modèle)`);
for (const e of ecartes) {
  console.log(`  ÉCARTÉE ${e.sid.slice(0, 8)} : recalage à ${(e.rmse * 1000).toFixed(0)} mm, hors de portée du seuil`);
}
console.log('');
console.log('À FAIRE :');
console.log(`  1. ajouter { "id": "${id}", "nom": "${nom}" } à objets/catalogue.json`);
console.log(`  2. ouvrir ?objet=${id}, placer la vue à la main, puis DURAIR.vueActuelle()`);
console.log('     et recopier les trois nombres dans reglages.affichage.vueInitiale');
console.log('  3. mesurer une longueur réelle sur l’objet et renseigner reglages.mesure');
