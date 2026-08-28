// Transforme un export dür.air en un objet du catalogue.
//
//   node outils/ingerer.mjs "<dossier d'export>" --id cadre-1 --nom "Cadre 1"
//   node outils/ingerer.mjs "<export 1>" "<export 2>" --id cadre-2 --nom "Cadre 2"
//
// Plusieurs exports du même projet se réunissent en un seul objet : recalculer
// une capture dans dür.air produit un export entier de plus, et chacune de ces
// reconstructions devient une entrée du sélecteur, comparable aux autres.
//
// Ce que fait la commande :
//
//   1. repère les captures qui portent un modèle photogrammétrique, et chaque
//      reconstruction de chacune ;
//   2. choisit comme référence la capture la plus dense — elle donne son repère
//      à l'objet, et l'application peint et mesure dessus, donc sa finesse
//      plafonne celle de tout l'objet ;
//   3. amène les autres dans ce repère : matrice d'alignement de dür.air pour
//      l'amorce, ICP point-à-point pour dégrossir, point-à-plan pour finir ;
//   4. REDRESSE l'objet face à la caméra — Object Capture rend un modèle
//      recentré mais pas orienté, et un cadre photographié à plat sort couché ;
//   5. convertit l'OBJ, y rattache la carte de normales et l'occlusion que le
//      MTL n'évoque pas, cuit toutes les transformations dans les sommets, et
//      réencode les textures en WebP ;
//   6. écrit objet.json et _recalage.json.
//
// Ce que la commande NE PEUT PAS deviner, et qu'elle annonce en sortant :
// l'échelle réelle de l'objet, et s'il se regarde en portrait ou en paysage.

import fs from 'node:fs';
import path from 'node:path';
import obj2gltf from 'obj2gltf';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { clearNodeTransform, textureCompress, dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';

import { inverse, multiplier, appliquer, echelleDe, IDENTITE } from './lib/matrice.mjs';
import { lireNuageOBJ, boite, espacement } from './lib/nuage.mjs';
import { recaler, recalerSansAmorce } from './lib/icp.mjs';
import { recalerPlan, jugerRecalage } from './lib/icp-plan.mjs';
import { poseFaceCamera, caleAuSol } from './lib/redressement.mjs';
import { decouper } from './lib/decoupe.mjs';
import { lireNuagePLY } from './lib/ply.mjs';

/* ------------------------------------------------------------- arguments */

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : defaut;
};

// PLUSIEURS EXPORTS, UN SEUL OBJET.
//
// dür.air exporte un projet entier à chaque fois, et recalculer une capture
// produit un nouvel export où tout est là — l'ancien modèle comme le nouveau.
// Les reconstructions successives d'un même cadre arrivent donc dans des
// dossiers séparés qui se recouvrent largement. Les passer tous ensemble les
// réunit dans un seul objet ; les doublons sont reconnus et ignorés.
//
// La valeur d'une option n'est pas un export : « --nom "Cadre 2" » ne doit pas
// laisser « Cadre 2 » dans la liste des sources. D'où ce parcours, plutôt qu'un
// filtre sur les arguments qui ne commencent pas par deux tirets.
const OPTIONS_AVEC_VALEUR = new Set(['id', 'nom', 'reference', 'rotation-face', 'recadrer', 'exclure', 'maillage', 'voxel']);
const sources = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) {
    if (OPTIONS_AVEC_VALEUR.has(args[i].slice(2))) i += 1;
  } else {
    sources.push(args[i]);
  }
}
const id = option('id');
const nom = option('nom', id);
const reference = option('reference');
const rotationFace = Number(option('rotation-face', '0')) || 0;
const sansIcp = args.includes('--sans-icp');
const sansRedressement = args.includes('--sans-redressement');
const sansDecoupe = args.includes('--sans-decoupe');
// Un objet qui se regarde d'en haut plutôt que de face : un sol, une pièce
// posée sur une table. La géométrie est redressée pareil, mais sa normale monte
// au lieu de venir vers la caméra, et la vue d'ouverture prend de la hauteur.
const aPlat = args.includes('--a-plat');
// Captures à laisser de côté. Une capture peut être inutilisable sans être mal
// recalée — trop partielle, trop floue, prise d'un angle qui n'apprend rien —
// et c'est un jugement que seule une paire d'yeux porte.
// Recadrage manuel, en fractions de l'objet redressé : « 0.05,0.09,0.93,0.95 »
// garde de 5 % à 93 % en largeur et de 9 % à 95 % en hauteur, toute
// l'épaisseur. C'est le seul moyen honnête de retirer le scotch et les bouts
// de papier autour d'un cadre : rien dans la géométrie ne les distingue de
// l'objet — ils sont dans le même plan, à la même hauteur, et le maillage est
// trop fragmenté pour que les composantes connexes les isolent. Une paire
// d'yeux et quatre nombres font le travail que l'automatisme ne fait pas.
// La finesse d un nuage de points publie, en metres. Deux centimetres : c est
// la justesse d un LiDAR de telephone, donc en dessous on publie du bruit plus
// gros que la mesure. Ce n est pas un rognage — l etendue reste entiere.
const voxelNuage = Number(option('voxel', '0.02')) || 0.02;
const recadrage = (option('recadrer', null) ?? '').split(',').map(Number).filter((x) => Number.isFinite(x));
const exclues = args.reduce((liste, a, i) => (a === '--exclure' && args[i + 1] ? [...liste, args[i + 1]] : liste), []);
// UN MAILLAGE QUI NE VIENT PAS DE LA PHOTOGRAMMETRIE.
//
// « --maillage "LiDAR=chemin/vers.obj" », repetable. Le selecteur du
// visualiseur enumere des CAPTURES tant qu un objet n a ete releve que d une
// facon ; sur le specimen du museum il doit enumerer des PROCEDES —
// photogrammetrie, LiDAR, splatting — qui montrent le meme objet par des
// moyens differents et meritent d etre compares.
//
// Le fichier est attendu dans le repere du monde ARKit, en metres : c est ce
// que produisent la reconstruction de scene d ARKit et le splatting. La
// matrice d alignement de la capture de reference l y ramene sans ICP.
const maillages = args.reduce((liste, a, i) => {
  if (a !== '--maillage' || !args[i + 1]) return liste;
  const coupe = args[i + 1].indexOf('=');
  if (coupe < 1) return liste;
  return [...liste, { etiquette: args[i + 1].slice(0, coupe), chemin: args[i + 1].slice(coupe + 1) }];
}, []);

if (sources.length === 0 || !id) {
  console.error('Usage : node outils/ingerer.mjs "<export>" ["<export>" …] --id <identifiant> --nom "<nom>"');
  console.error('        --reference <id de capture>  impose la capture qui fixe le repère');
  console.error('        --rotation-face <degrés>     tourne l’objet dans son propre plan');
  console.error('        --sans-icp                   matrices dür.air seules');
  console.error('        --sans-redressement          laisse la géométrie telle quelle');
  console.error('        --a-plat                     objet posé au sol, vu d’en haut');
  console.error('        --exclure <id de capture>    écarte une capture (répétable)');
  console.error('        --recadrer x0,y0,x1,y1       rogne, en fractions de l’objet redressé');
  console.error('        --sans-decoupe               garde le décor propre à chaque capture');
  console.error('        --maillage "Nom=fichier.obj" ajoute un maillage en repère ARKit');
  console.error('        --maillage "Nom=nuage.ply"  ajoute un nuage de points, non recadré');
  console.error('        --voxel <mètres>             finesse du nuage publié (0,02 par défaut)');
  process.exit(2);
}

/* ------------------------------------------------- repérage des captures */

// UNE CAPTURE PEUT AVOIR PLUSIEURS RECONSTRUCTIONS, ET ELLES NE SE VALENT PAS.
//
// La capture est la prise de vue ; la reconstruction est le calcul qu'on en
// fait. Relancer le calcul dans dür.air sur les mêmes photos donne un autre
// maillage — un autre nombre d'images retenues, une autre densité, une autre
// échelle. Sur Cadre 2 : 28 images pour 14 422 sommets, puis 18 pour 15 148.
// Ce sont des modèles différents du même objet, et les comparer est
// précisément ce qu'on veut pouvoir faire dans le visualiseur.
//
// On ne garde donc plus « le » modèle d'une capture : on garde chacun, sous une
// clé qui reste la capture tant qu'elle n'en a qu'un — pour ne pas renommer les
// objets déjà ingérés — et qui se suffixe du modèle dès qu'il y en a plusieurs.
const trouvees = new Map();
for (const source of sources) {
  const dossierSessions = path.join(source, 'sessions');
  if (!fs.existsSync(dossierSessions)) {
    console.error(`Aucun dossier sessions/ dans ${source}`);
    process.exit(2);
  }
  for (const sid of fs.readdirSync(dossierSessions)) {
    const photo = path.join(dossierSessions, sid, 'photogrammetry');
    if (!fs.existsSync(photo)) continue;
    const fichiers = fs.readdirSync(photo);
    const cheminSession = path.join(dossierSessions, sid, 'session_metadata.json');
    const s = fs.existsSync(cheminSession) ? JSON.parse(fs.readFileSync(cheminSession, 'utf8')) : {};

    for (const obj of fichiers.filter((f) => f.endsWith('.obj'))) {
      const base = obj.slice(0, -4);
      const meta = `${base}_metadata.json`;
      if (!fichiers.includes(meta)) continue;
      // Le même modèle revient dans chaque export du projet : on le compte une
      // fois. La capture et l'identifiant du modèle suffisent à le reconnaître.
      const modele = base.replace(/^model_/, '');
      const cle = `${sid}/${modele}`;
      if (trouvees.has(cle)) continue;

      const textures = {};
      const dossierTextures = `${base}_textures`;
      if (fichiers.includes(dossierTextures)) {
        for (const f of fs.readdirSync(path.join(photo, dossierTextures))) {
          const complet = path.join(photo, dossierTextures, f);
          if (f.endsWith('_norm0.png')) textures.normale = complet;
          else if (f.endsWith('_ao0.png')) textures.occlusion = complet;
          else if (f.endsWith('_tex0.png')) textures.base = complet;
        }
      }

      const m = JSON.parse(fs.readFileSync(path.join(photo, meta), 'utf8'));
      trouvees.set(cle, {
        sid,
        modele,
        source,
        obj: path.join(photo, obj),
        textures,
        alignement: m.alignmentInfo ?? null,
        debut: s.start_date ?? s.startDate ?? m.createdAt ?? null,
        fin: s.end_date ?? s.endDate ?? null,
        // Quand une capture porte plusieurs reconstructions, c'est LEUR date et
        // LEUR nombre d'images qui les distinguent, pas celle de la prise de vue.
        calcule: m.createdAt ?? null,
        images: m.frameCount ?? null,
        sommets: m.vertexCount ?? null,
      });
    }
  }
}

const captures = [...trouvees.values()].filter((c) => {
  // On écarte par capture — toutes ses reconstructions — ou par reconstruction.
  if (!exclues.some((e) => c.sid.startsWith(e) || c.modele.startsWith(e))) return true;
  console.log(`  ${c.sid.slice(0, 8)}/${c.modele} : écartée à la demande (--exclure)`);
  return false;
});

if (captures.length === 0) {
  console.error(`Aucune capture avec modèle photogrammétrique dans ${sources.join(', ')}.`);
  console.error('Ré-exportez depuis dür.air avec photogrammetry.include_model = true.');
  process.exit(1);
}

// La clé de sortie : la capture seule si elle est unique, sinon suffixée du
// modèle. Un objet dont chaque capture n'a qu'une reconstruction garde donc
// exactement les dossiers qu'il avait.
const parCapture = new Map();
for (const c of captures) parCapture.set(c.sid, (parCapture.get(c.sid) ?? 0) + 1);
for (const c of captures) c.cle = parCapture.get(c.sid) > 1 ? `${c.sid}-${c.modele}` : c.sid;

// Le nom court d'une entrée dans le journal. Les huit premiers caractères de la
// capture suffisaient tant qu'elle n'avait qu'un modèle ; il faut maintenant
// dire lequel, sans quoi trois lignes de recalage se ressemblent trait pour
// trait.
const etiqueter = (c) => {
  if (c.externe) return c.etiquette;
  return parCapture.get(c.sid) > 1 ? `${c.sid.slice(0, 8)}/${c.modele}` : c.sid.slice(0, 8);
};

for (const c of captures) c.nuage = lireNuageOBJ(c.obj);

// LA RÉFÉRENCE EST LA CAPTURE LA PLUS DENSE, PAS LA PREMIÈRE.
//
// Elle donne son repère à toutes les autres, et l'application peint et mesure
// sur elle : « Painting and measuring target the first, the frame all the
// others were aligned onto ». C'est donc sa finesse qui plafonne celle de tout
// l'objet. Sur Cadre 1, prendre la première capture dans l'ordre du temps
// désignait celle de 6 876 sommets — arête moyenne de 50 mm au lieu de 15, et
// un résidu de recalage qui suivait. Les autres gardent l'ordre chronologique.
captures.sort((a, b) => String(a.debut ?? '').localeCompare(String(b.debut ?? ''))
  || String(a.calcule ?? '').localeCompare(String(b.calcule ?? '')));
const choisie = reference
  ? captures.findIndex((c) => c.sid.startsWith(reference) || c.modele.startsWith(reference))
  : captures.reduce(
    (meilleure, c, i) => (c.nuage.positions.length > captures[meilleure].nuage.positions.length ? i : meilleure),
    0,
  );
if (choisie > 0) captures.unshift(...captures.splice(choisie, 1));

const ref = captures[0];
const pasRef = espacement(ref.nuage.positions);
const recalages = {};
const ecartes = [];

console.log(`${captures.length} capture(s) — repère fixé par ${etiqueter(ref)} `
  + `(${ref.nuage.positions.length} sommets, arête ${(pasRef * 1000).toFixed(1)} mm)`);
console.log('');

/* ------------------------------------------------------------- recalage */

// Au-delà de quoi un alignement n'en est plus un. Quatre arêtes du maillage de
// référence : à cette distance une annotation posée sur une capture désigne,
// sur l'autre, une zone qui n'a plus rien à voir avec celle qu'on visait.
const SEUIL_REFUS = pasRef * 4;

ref.M = IDENTITE;
for (let i = 1; i < captures.length; i += 1) {
  const c = captures[i];
  const t0 = Date.now();
  let depart;
  let voie;

  if (c.alignement && ref.alignement) {
    depart = multiplier(
      inverse(ref.alignement.transformMatrix.map(Number)),
      c.alignement.transformMatrix.map(Number),
    );
    voie = 'matrice dür.air';
  } else {
    // Sans matrice, on cherche l'orientation nous-mêmes : les modèles Object
    // Capture sortent recentrés et posés sur min.y = 0, ce qui ne laisse que
    // cinq degrés de liberté — une rotation autour de la verticale, une
    // échelle, un décalage dans le plan.
    const balayage = recalerSansAmorce(c.nuage.positions, ref.nuage.positions);
    depart = balayage.M;
    voie = `balayage ${balayage.essais} angles (${balayage.angleRetenu}°)`;
  }

  if (sansIcp) {
    c.M = depart;
    console.log(`  ${etiqueter(c)} : ${voie}, sans raffinement`);
    continue;
  }

  // Point-à-point d'abord, point-à-plan ensuite. Le premier est robuste et
  // grossier, le second suppose déjà un alignement à peu près juste.
  const grossier = recaler(c.nuage.positions, ref.nuage.positions, depart);
  const fin = recalerPlan(c.nuage, ref.nuage, grossier.M);
  const juge = jugerRecalage(c.nuage, ref.nuage, fin.M);

  const duree = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const resume = `RMSE ${(juge.rmse * 1000).toFixed(1)} mm sur ${(juge.partRecouvrement * 100).toFixed(0)} % `
    + `de recouvrement, échelle x${echelleDe(fin.M).toFixed(3)}`;

  if (!(juge.rmse < SEUIL_REFUS)) {
    // Une capture qu'on ne sait pas recaler n'est pas publiée. Le visualiseur
    // suppose que toutes les captures d'un objet partagent un repère — en
    // glisser une qui ne le partage pas ne se voit qu'en changeant d'onglet,
    // et se voit alors comme un bug du site.
    console.log(`  ${etiqueter(c)} : ÉCARTÉE — ${resume} (${voie}, ${duree})`);
    console.log(`               au-delà du seuil de ${(SEUIL_REFUS * 1000).toFixed(0)} mm ; `
      + 'relancez avec --reference sur une autre capture, ou ingérez-la comme objet distinct.');
    ecartes.push({ nom: etiqueter(c), rmse: juge.rmse, voie });
    c.ecartee = true;
    continue;
  }

  c.M = fin.M;
  recalages[c.cle] = {
    rmse: juge.rmse,
    recouvrement: juge.partRecouvrement,
    mediane: juge.mediane,
    p90: juge.p90,
    echelle: echelleDe(fin.M),
    voie: `${voie} + ICP point-à-plan`,
  };
  console.log(`  ${etiqueter(c)} : ${resume} (${voie} + ICP, ${duree})`);
}

const publiees = captures.filter((c) => !c.ecartee);

/* ---------------------------------------------------------- redressement */

// Le redressement se calcule sur la RÉFÉRENCE seule et s'applique à toutes :
// les captures sont déjà dans son repère, et leur faire subir la même rotation
// les y laisse. Le calculer capture par capture les désalignerait aussitôt.
let pose = { M: IDENTITE, inclinaison: 0 };
if (!sansRedressement) {
  const p = poseFaceCamera(ref.nuage.positions, {
    rotationFace,
    aPlat,
    // Les normales du maillage disent de quel côté la surface regarde. Sans
    // elles, on suppose que la face est celle du dessus — et on se trompe dès
    // qu'une capture a été prise de l'autre côté.
    normales: ref.nuage.normales,
  });
  if (p.M) {
    pose = p;
    console.log('');
    console.log(`redressement : ${p.methode}, ${(p.partPlan * 100).toFixed(0)} % des points, `
      + `inclinaison corrigée ${p.inclinaison.toFixed(1)}°`);
  } else {
    console.log('');
    console.log(`redressement : impossible (${p.raison}) — géométrie laissée telle quelle`);
  }
}
for (const c of publiees) c.Mfinal = multiplier(pose.M, c.M);

// La référence dans le repère où l'objet sera publié : verticale en +Y, sol à
// zéro. C'est là que se comparent les hauteurs d'une couche à l'autre.
const refFinal = ref.nuage.positions.map((p) => appliquer(pose.M, p));

/* --------------------------------------------- les maillages d'un autre procédé */

// LE MONDE ARKit EST LE TERRAIN D'ENTENTE.
//
// La photogrammétrie sort dans ses propres unités, sans échelle ni orientation
// absolues ; le LiDAR et le splatting sortent en mètres, dans le repère de la
// session AR. Ce qui relie les deux est déjà dans l'export : la matrice
// d'alignement que dür.air attache au modèle photogrammétrique, et qui l'envoie
// dans ce monde ARKit. Son inverse ramène donc n'importe quel maillage ARKit
// dans le repère de la référence — sans ICP, sans recalage à estimer.
//
// Mesuré sur le spécimen du muséum : la reconstruction LiDAR tombe à 35 mm de
// la photogrammétrie en médiane, 64 mm au neuvième décile, sur la totalité du
// modèle. C'est la justesse propre du LiDAR d'un téléphone. Assez pour
// superposer et comparer ; pas assez pour qu'une annotation posée sur l'un
// désigne le même millimètre sur l'autre.
for (const m of maillages) {
  if (!fs.existsSync(m.chemin)) {
    console.error(`Maillage introuvable : ${m.chemin}`);
    process.exit(2);
  }
  if (!ref.alignement) {
    console.error(`La capture de référence ne porte pas d’alignmentInfo : impossible de placer «${' '}${m.etiquette} ».`);
    console.error('Ré-exportez depuis dür.air, ou ingérez ce maillage comme objet distinct.');
    process.exit(1);
  }
  const cle = m.etiquette.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const versRef = inverse(ref.alignement.transformMatrix.map(Number));
  console.log('');

  const estNuage = m.chemin.toLowerCase().endsWith('.ply');
  const donnees = estNuage
    ? await lireNuagePLY(m.chemin, { voxel: voxelNuage })
    : lireNuageOBJ(m.chemin);

  // LA MATRICE D'ARKit PLACE ; ELLE N'AJUSTE PAS.
  //
  // Elle vient de la carte du monde : elle sait où la photogrammétrie se tient
  // dans la session AR, à la justesse de cette carte près — huit centimètres
  // d'erreur moyenne annoncés dans le fichier. D'où le léger décalage visible
  // en passant d'un procédé à l'autre : deux relevés du même objet qui ne se
  // superposent pas tout à fait.
  //
  // On la raffine donc par ICP, comme on le fait déjà entre deux captures. Deux
  // précautions : le recalage ne se calcule QUE sur la zone commune — le LiDAR
  // voit dix mètres de salle là où la photogrammétrie en couvre deux et demi,
  // et les points qui ne regardent rien tireraient l'ajustement n'importe où —
  // et il n'est retenu que s'il améliore réellement le résidu. Un raffinement
  // qui dégrade est un raffinement qu'on jette.
  // Les residus se lisent mieux en millimetres reels qu en unites de modele.
  const echelleReelle = ref.alignement.scale ?? 1;
  const bref = boite(ref.nuage.positions);
  const marge = bref.diagonale * 0.08;
  const dansRef = [];
  const source = estNuage ? donnees.positions : null;
  const nbPoints = estNuage ? donnees.gardes : donnees.positions.length;
  for (let i = 0; i < nbPoints; i += 1) {
    const brut = estNuage
      ? [source[i * 3], source[i * 3 + 1], source[i * 3 + 2]]
      : donnees.positions[i];
    const p = appliquer(versRef, brut);
    if (p[0] < bref.mn[0] - marge || p[0] > bref.mx[0] + marge) continue;
    if (p[1] < bref.mn[1] - marge || p[1] > bref.mx[1] + marge) continue;
    if (p[2] < bref.mn[2] - marge || p[2] > bref.mx[2] + marge) continue;
    dansRef.push(p);
  }

  let correction = IDENTITE;
  if (dansRef.length < 500) {
    console.log(`« ${m.etiquette} » : ${dansRef.length} points dans l’emprise de la référence — `
      + 'trop peu pour raffiner, matrice ARKit conservée');
  } else {
    const avant = jugerRecalage({ positions: dansRef }, ref.nuage, IDENTITE);
    // Rigide : les deux relevés sont déjà à la même échelle (la matrice ARKit
    // s en est chargée), il ne reste qu une rotation et une translation à
    // corriger. Laisser l échelle libre revenait à comprimer le LiDAR de 8,5 %
    // pour gagner huit millimètres — un mensonge métrique payé d un chiffre.
    const essai = recaler(dansRef, ref.nuage.positions, IDENTITE, { rigide: true });
    const apres = jugerRecalage({ positions: dansRef }, ref.nuage, essai.M);
    const mieux = apres.rmse < avant.rmse;
    if (mieux) correction = essai.M;
    const mm = (x) => (x * 1000 * echelleReelle).toFixed(0);
    console.log(`« ${m.etiquette} » : recalage sur ${dansRef.length} points de la zone commune`);
    console.log(`  écart à la photogrammétrie : ${mm(avant.rmse)} mm → ${mm(apres.rmse)} mm`
      + `  (médiane ${mm(avant.mediane)} → ${mm(apres.mediane)}, échelle ×${echelleDe(essai.M).toFixed(4)})`);
    if (!mieux) console.log('  le raffinement n’améliore rien : matrice ARKit conservée');
  }
  let versObjet = multiplier(pose.M, multiplier(correction, versRef));

  // LE SOL EST LE MÊME SOL.
  //
  // Après l'ICP, le relevé LiDAR du muséum flottait encore d'un centimètre
  // au-dessus de la photogrammétrie — assez peu pour que le résidu ne s'en
  // émeuve pas, assez pour qu'on le voie à la ligne de contact. Les deux
  // couches ont mesuré le même sol : c'est lui qui tranche.
  const pointsFinals = [];
  for (let i = 0; i < nbPoints; i += 1) {
    const brut = estNuage
      ? [source[i * 3], source[i * 3 + 1], source[i * 3 + 2]]
      : donnees.positions[i];
    pointsFinals.push(appliquer(versObjet, brut));
  }
  const cale = caleAuSol(pointsFinals, refFinal, {
    pas: bref.diagonale / 120,
    bande: bref.diagonale / 40,
  });
  if (cale) {
    versObjet = multiplier([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -cale.ecart, 0, 1], versObjet);
    const cm = (x) => (x * 100 * echelleReelle).toFixed(1);
    const sens = cale.ecart >= 0 ? 'au-dessus' : 'en dessous';
    console.log(`« ${m.etiquette} » : son sol tombait ${cm(Math.abs(cale.ecart))} cm ${sens} de celui de `
      + `la photogrammétrie, sur ${cale.cellules} cellules communes `
      + `(quartiles ${cm(cale.q25)} et ${cm(cale.q75)} cm) — couche translatée d’autant`);
  } else {
    console.log(`« ${m.etiquette} » : pas assez de sol commun pour caler la hauteur — laissée telle quelle`);
  }

  if (estNuage) {
    const nuage = donnees;
    // UN LIDAR SE MONTRE EN POINTS. (lecture faite plus haut)
    //
    // ARKit livre aussi une surface reconstruite, et elle est trompeuse : elle
    // lisse, elle bouche, elle donne à voir du plein là où l'appareil n'a mesuré
    // que des points espacés. Le nuage dit la vérité de la mesure, densité
    // comprise — on voit où l'appareil est passé et où il n'a rien vu.
    //
    // Et on ne le recadre pas : le sol est une donnée. Sur un maillage de
    // comparaison, découper au gabarit de la photogrammétrie a du sens ; ici la
    // salle entière est ce que le relevé a relevé.
    publiees.push({
      externe: true,
      nuagePoints: nuage,
      etiquette: m.etiquette,
      cle,
      sommets: nuage.gardes,
      debut: ref.debut,
      Mfinal: versObjet,
    });
    console.log(`nuage « ${m.etiquette} » : ${nuage.lus} points lus, ${nuage.gardes} gardés `
      + `(un par voxel de ${(nuage.voxel * 100).toFixed(0)} cm), sans recadrage`);
    console.log('  placé par la matrice d’alignement ARKit de la référence');
    continue;
  }

  publiees.push({
    externe: true,
    etiquette: m.etiquette,
    cle,
    obj: m.chemin,
    textures: {},
    sommets: donnees.positions.length,
    debut: ref.debut,
    Mfinal: versObjet,
  });
  console.log(`maillage « ${m.etiquette} » : ${donnees.positions.length} sommets, `
    + 'placé par la matrice d’alignement ARKit de la référence');
}

const boiteFinale = boite(refFinal);

// L'emprise demandée à la main, si elle l'a été.
let boiteRecadree = boiteFinale;
if (recadrage.length === 4) {
  const [x0, y0, x1, y1] = recadrage;
  const mn = [
    boiteFinale.mn[0] + boiteFinale.taille[0] * x0,
    boiteFinale.mn[1] + boiteFinale.taille[1] * y0,
    boiteFinale.mn[2],
  ];
  const mx = [
    boiteFinale.mn[0] + boiteFinale.taille[0] * x1,
    boiteFinale.mn[1] + boiteFinale.taille[1] * y1,
    boiteFinale.mx[2],
  ];
  boiteRecadree = { mn, mx, taille: mx.map((v, i) => v - mn[i]), centre: mx.map((v, i) => (v + mn[i]) / 2) };
  console.log(`recadrage    : ${(x0 * 100).toFixed(0)}–${(x1 * 100).toFixed(0)} % en largeur, `
    + `${(y0 * 100).toFixed(0)}–${(y1 * 100).toFixed(0)} % en hauteur`);
}

/* ------------------------------------------------------------ conversion */

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const cible = path.join('objets', id);
fs.mkdirSync(path.join(cible, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(cible, 'annotations'), { recursive: true });

console.log('');
for (const c of publiees) {
  const sortie = path.join(cible, 'sessions', c.cle);
  fs.mkdirSync(sortie, { recursive: true });

  // Un nuage de points ne passe par aucune des étapes qui suivent : pas d'OBJ à
  // convertir, pas de texture à rattacher, pas de découpe. On écrit une
  // primitive en mode POINTS, coordonnées déjà cuites, couleurs par sommet.
  if (c.nuagePoints) {
    const { positions, couleurs } = c.nuagePoints;
    const places = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const p = appliquer(c.Mfinal, [positions[i], positions[i + 1], positions[i + 2]]);
      places[i] = p[0]; places[i + 1] = p[1]; places[i + 2] = p[2];
    }
    // COLOR_0 en quatre octets normalisés plutôt qu'en trois : glTF veut des
    // attributs alignés sur quatre octets, et un VEC3 d'octets ne l'est pas.
    const rvba = new Uint8Array((couleurs.length / 3) * 4);
    for (let i = 0, j = 0; i < couleurs.length; i += 3, j += 4) {
      rvba[j] = couleurs[i]; rvba[j + 1] = couleurs[i + 1];
      rvba[j + 2] = couleurs[i + 2]; rvba[j + 3] = 255;
    }
    const nuageDoc = new Document();
    const tampon = nuageDoc.createBuffer();
    const prim = nuageDoc.createPrimitive()
      .setMode(0) // POINTS
      .setAttribute('POSITION', nuageDoc.createAccessor().setType('VEC3').setArray(places).setBuffer(tampon))
      .setAttribute('COLOR_0', nuageDoc.createAccessor()
        .setType('VEC4').setArray(rvba).setNormalized(true).setBuffer(tampon))
      .setMaterial(nuageDoc.createMaterial(c.etiquette).setBaseColorFactor([1, 1, 1, 1]));
    const scene = nuageDoc.createScene().addChild(
      nuageDoc.createNode(c.etiquette).setMesh(nuageDoc.createMesh(c.etiquette).addPrimitive(prim)),
    );
    // Sans scène par défaut, le glTF ne porte pas de champ « scene » : les
    // lecteurs tolérants prennent la première, les autres ne trouvent rien.
    nuageDoc.getRoot().setDefaultScene(scene);
    await io.write(path.join(sortie, 'model.glb'), nuageDoc);
    const poidsNuage = (fs.statSync(path.join(sortie, 'model.glb')).size / 1048576).toFixed(1);
    console.log(`  ${etiqueter(c)}  model.glb ${poidsNuage} Mo  — ${c.sommets} points`);
    continue;
  }

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

  // Recalage et redressement sont cuits dans les sommets plutôt que posés sur
  // un nœud : toutes les captures d'un objet arrivent ainsi dans le même
  // repère, debout, avec des nœuds à l'identité, et rien en aval n'a à s'en
  // soucier — ni l'ombre, ni l'axe de rotation, ni le cadrage.
  for (const noeud of doc.getRoot().getDefaultScene().listChildren()) {
    noeud.setMatrix(multiplier(c.Mfinal, noeud.getMatrix()));
    clearNodeTransform(noeud);
  }

  // Toutes les captures sont ramenées à l'emprise de la référence : sans quoi
  // chacune montre une portion différente de sol, et changer d'onglet recadre
  // la vue comme si l'objet avait sauté.
  const emprise = recadrage.length === 4 ? boiteRecadree : boiteFinale;
  if (!sansDecoupe && (c !== ref || emprise !== boiteFinale)) {
    const { trianglesAvant, trianglesApres } = decouper(doc, emprise, 0);
    if (trianglesApres < trianglesAvant) {
      c.decoupe = `${Math.round((1 - trianglesApres / trianglesAvant) * 100)} % de triangles hors emprise retirés`;
    }
  }

  doc.createExtension(EXTTextureWebP).setRequired(false);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }),
  );

  await io.write(path.join(sortie, 'model.glb'), doc);
  const poids = (fs.statSync(path.join(sortie, 'model.glb')).size / 1048576).toFixed(1);
  console.log(`  ${etiqueter(c)}  model.glb ${poids} Mo${c.decoupe ? `  — ${c.decoupe}` : ''}`);
}

/* --------------------------------------------------------- le manifeste */

const dateFr = (iso) => (iso
  ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  : '');
const heureFr = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  : '');

const { diagonale } = boiteFinale;

const manifeste = {
  nom,
  // Le repère est daté de l'ingestion : relancer cette commande produit une
  // géométrie qui n'est pas exactement la même — l'ICP repart des mêmes
  // matrices mais pas forcément vers le même point, et le redressement dépend
  // d'un RANSAC — et les annotations posées sur la précédente ne désigneraient
  // plus tout à fait le même endroit.
  repere: `${id}/oc-redresse-${new Date().toISOString().slice(0, 7)}`,
  recalage: 'sessions/_recalage.json',
  // Combien l'objet a été tourné dans son propre plan. Rien dans la géométrie
  // ne dit si un cadre se regarde en portrait ou en paysage : par défaut le
  // grand côté est posé à l'horizontale. Réingérez avec --rotation-face 90
  // (ou 180, ou 270) pour en décider autrement.
  redressement: { rotationFace, aPlat, ...(recadrage.length === 4 ? { recadrage } : {}) },
  // De quoi refaire exactement cet objet. Le repère change à chaque ingestion,
  // donc réingérer périme les annotations : autant que la commande qui a produit
  // ce dossier soit écrite dedans plutôt que retrouvée de mémoire.
  provenance: {
    export: sources.length === 1 ? sources[0] : sources,
    commande: process.argv.slice(1).map((a2) => (a2.includes(" ") ? JSON.stringify(a2) : a2)).join(" "),
    ingere: new Date().toISOString(),
  },
  // CE QUE LE SÉLECTEUR DOIT DIRE.
  //
  // Il affiche « label » puis « date · time ». Numéroter simplement les entrées
  // marchait tant qu'une entrée était une prise de vue ; trois reconstructions
  // d'une même capture donneraient trois boutons portant la même date à la
  // minute près, et l'on ne saurait pas lequel on regarde.
  //
  // Alors on numérote les CAPTURES, on distingue leurs reconstructions par un
  // « calcul N », et on remplace l'horaire de la prise de vue — identique par
  // construction — par la date du calcul et le nombre d'images qu'il a retenues.
  // C'est exactement ce qui change de l'une à l'autre.
  // UNE SESSION, ET CE QU'ELLE CONTIENT.
  //
  // Une session est une SÉANCE DEVANT L'OBJET. Ce qu'elle produit n'est pas
  // forcément un seul modèle : dür.air peut recalculer une même prise avec un
  // autre lot d'images, et le même passage peut avoir enregistré un nuage LiDAR
  // en plus des photos. Ranger tout cela à plat, comme autant de « captures »,
  // faisait passer trois calculs d'une seule séance pour trois séances — et
  // laissait croire que la photogrammétrie et le LiDAR du muséum venaient de
  // deux visites.
  //
  // Le tableau reste plat — les annotations désignent une entrée par son id, et
  // le composite les empile toutes — mais chaque entrée dit à quelle session
  // elle appartient. Le champ « groupe » porte le nom de la session ; les
  // entrées qui le partagent sont ses ITÉRATIONS, et l'interface les présente
  // sous elle. Sans « groupe », l'entrée est une session à elle seule : c'est
  // le cas d'un objet dont chaque séance n'a produit qu'un modèle.
  sessions: (() => {
    const photogrammetriques = publiees.filter((p) => !p.externe);
    const rangDe = (sid) => [...new Set(photogrammetriques.map((p) => p.sid))].indexOf(sid) + 1;
    // La session de rattachement d'un procédé annexe est celle de la référence :
    // le LiDAR a été relevé pendant la même séance, c'est même de là que vient
    // la matrice qui le place.
    const sessionDeReference = `Session ${rangDe(ref.sid)}`;
    const externes = publiees.filter((p) => p.externe);

    return publiees.map((c) => {
      if (c.externe) {
        return {
          id: c.cle,
          label: c.etiquette,
          groupe: sessionDeReference,
          date: dateFr(c.debut),
          time: `${Math.round(c.sommets / 1000)} k sommets`,
          glb: `sessions/${c.cle}/model.glb`,
        };
      }
      const plusieurs = parCapture.get(c.sid) > 1;
      const rangCapture = rangDe(c.sid);
      const rangCalcul = photogrammetriques.filter((p) => p.sid === c.sid).indexOf(c) + 1;
      // Une entrée est rangée sous sa session dès qu'elle y a de la compagnie :
      // plusieurs calculs de la même prise, ou un procédé annexe relevé avec
      // elle. Seule, elle EST la session et n'a pas de sous-partie.
      const accompagnee = plusieurs || (externes.length > 0 && c.sid === ref.sid);
      const entree = {
        id: c.cle,
        label: plusieurs ? `Itération ${rangCalcul}`
          : (accompagnee ? 'Photogrammétrie' : `Capture ${rangCapture}`),
        date: dateFr(plusieurs ? (c.calcule ?? c.debut) : c.debut),
        time: plusieurs
          ? `${c.images ?? '?'} images`
          : (c.debut && c.fin ? `${heureFr(c.debut)} – ${heureFr(c.fin)}` : heureFr(c.debut)),
        glb: `sessions/${c.cle}/model.glb`,
      };
      if (accompagnee) entree.groupe = `Session ${rangCapture}`;
      // L'ordre des clés compte pour la lecture du fichier : le groupe juste
      // après l'étiquette qu'il rassemble.
      return accompagnee
        ? { id: entree.id, label: entree.label, groupe: entree.groupe, date: entree.date, time: entree.time, glb: entree.glb }
        : entree;
    });
  })(),
  reglages: {
    // Des distances tirées de la taille du modèle : un cadre de deux mètres et
    // un poisson de vingt centimètres ne se regardent pas de la même distance,
    // et les bornes de l'un interdiraient de reculer devant l'autre.
    camera: {
      distanceMin: Number((diagonale / 12).toPrecision(2)),
      distanceMax: Number((diagonale * 4).toPrecision(2)),
    },
    peinture: {
      taille: Math.min(80, Math.max(1, Math.round(diagonale * 1000 * 0.015))),
      tailleGomme: Math.min(80, Math.max(1, Math.round(diagonale * 1000 * 0.018))),
    },
    affichage: {
      // De face, puisque la géométrie vient d'être redressée pour cela.
      // L'élévation reste nulle : c'est la face qu'on veut voir, pas les trois
      // quarts. Placez la vue à la main et tapez DURAIR.vueActuelle() dans la
      // console pour en choisir une autre.
      // À plat, la vue prend de la hauteur sans aller jusqu'à la verticale :
      // à 90° la caméra regarderait le long de sa propre verticale et le
      // cadrage n'aurait plus de « haut ». 62° montre la face largement, et
      // laisse voir que l'objet est posé.
      vueInitiale: aPlat
        ? { azimut: 0, elevation: 62, marge: 1.05 }
        : { azimut: 0, elevation: 0, marge: 1.02 },
      aplomb: null,
      axeRotation: { point: [0, 0, 0], direction: [0, 1, 0] },
    },
    // mesure : À COMPLÉTER, et REPRISE DE L'INGESTION PRÉCÉDENTE si elle
    // existe — voir juste en dessous. Mesurez une longueur réelle sur l'objet,
    // lisez la même dans le modèle, et écrivez dans objet.json :
    //   "mesure": { "longueurModeleReference": …, "longueurReelleReference": … }
    // Tant que ces deux nombres manquent, la fiche du projet affiche
    // « non calibrée » plutôt que des chiffres en unités de modèle.
  },
};

// LA CALIBRATION SURVIT À LA RÉINGESTION.
//
// Réingérer réécrit tout le manifeste. Les réglages perdus se retrouvent d'un
// coup d'œil ; l'échelle réelle, non — elle vient d'un mètre ruban posé sur
// l'objet, pas d'un calcul, et rien dans les fichiers ne permet de la
// retrouver. La perdre en silence, c'est renvoyer quelqu'un mesurer un tableau
// de trois mètres.
//
// Le redressement et le recalage ne changent pas les unités du modèle : elles
// sont celles de la capture de référence, et la référence est restée la même
// tant qu'on ne la change pas à la main. La reprise est donc valide — sauf si
// --reference désigne une autre capture, auquel cas la commande le dit.
const cheminManifeste = path.join(cible, 'objet.json');
if (fs.existsSync(cheminManifeste)) {
  const precedent = JSON.parse(fs.readFileSync(cheminManifeste, 'utf8'));

  // LES ÉTIQUETTES RENOMMÉES À LA MAIN SURVIVENT AUSSI.
  //
  // « Capture 1 », « Capture 1 · calcul 2 » : ce que cette commande sait dire.
  // Mais le sélecteur n'énumère pas toujours des prises de vue — sur le
  // spécimen du muséum il énumère des PROCÉDÉS : photogrammétrie, LiDAR,
  // splatting, superposition. Ce nom-là vient de quelqu'un qui sait ce qu'il
  // regarde, pas d'un compteur, et le réécrire à chaque réingestion serait une
  // façon sûre de le perdre.
  //
  // On ne garde que ce qui a été VOLONTAIREMENT changé : une étiquette encore
  // identique à celle que la commande produirait se régénère normalement, et
  // suit donc la numérotation si les entrées bougent.
  const anciennes = new Map((precedent.sessions ?? []).map((s2) => [s2.id, s2.label]));
  const renommees = [];
  for (const s2 of manifeste.sessions) {
    const ancienne = anciennes.get(s2.id);
    if (ancienne && ancienne !== s2.label) {
      renommees.push(`${s2.label} → ${ancienne}`);
      s2.label = ancienne;
    }
  }
  if (renommees.length > 0) {
    console.log('');
    console.log(`étiquettes reprises : ${renommees.join(', ')}`);
  }

  // LA VUE D'OUVERTURE POSÉE À LA MAIN AUSSI.
  //
  // La commande en propose une par défaut — de face pour un objet dressé, à 62°
  // au-dessus pour un objet posé. Sur Cadre 1 elle a été remplacée par un angle
  // choisi d'après une capture d'écran, azimut 180 et élévation 34 : ça ne se
  // recalcule pas, ça se retrouve à l'œil. Réingérer pour corriger le sol ne
  // doit pas coûter ce réglage-là.
  const vueAvant = precedent.reglages?.affichage?.vueInitiale;
  const vueApres = manifeste.reglages.affichage.vueInitiale;
  if (vueAvant && JSON.stringify(vueAvant) !== JSON.stringify(vueApres)) {
    manifeste.reglages.affichage.vueInitiale = vueAvant;
    console.log('');
    console.log(`vue d’ouverture reprise : azimut ${vueAvant.azimut}, élévation ${vueAvant.elevation}, `
      + `marge ${vueAvant.marge}`);
    console.log('  (le redressement a pu bouger de quelques degrés : vérifiez l’aperçu)');
  }

  const mesure = precedent.reglages?.mesure;
  if (mesure?.longueurModeleReference && mesure?.longueurReelleReference) {
    manifeste.reglages.mesure = mesure;
    const memeReference = precedent.sessions?.[0]?.id === manifeste.sessions[0]?.id;
    console.log('');
    console.log(`calibration reprise : ${mesure.longueurModeleReference} unité(s) du modèle `
      + `pour ${mesure.longueurReelleReference} m réels`);
    if (!memeReference) {
      console.log('  ATTENTION : la capture de référence a changé, donc les unités du modèle');
      console.log('  aussi. Cette calibration ne vaut plus — remesurez, ou retirez « mesure »');
      console.log('  de objet.json pour revenir à « non calibrée ».');
    }
  }
}

fs.writeFileSync(path.join(cible, 'objet.json'), `${JSON.stringify(manifeste, null, 2)}\n`);

// LES SESSIONS D'AVANT NE S'EN VONT PAS TOUTES SEULES.
//
// Réingérer écrit les dossiers de cette fois-ci et laisse ceux d'avant. Tant
// que les clés ne bougeaient pas, ils étaient écrasés et personne ne le
// remarquait ; du jour où une capture porte plusieurs reconstructions, la clé
// se suffixe et l'ancien dossier devient un orphelin — deux mégaoctets de
// maillage que rien ne référence, poussés dans le dépôt et servis à personne.
// Le manifeste qu'on vient d'écrire dit exactement ce qui est vivant.
const vivants = new Set(manifeste.sessions.map((s2) => s2.id));
for (const d of fs.readdirSync(path.join(cible, 'sessions'))) {
  if (d.startsWith('_') || vivants.has(d)) continue;
  fs.rmSync(path.join(cible, 'sessions', d), { recursive: true, force: true });
  console.log(`  session obsolète retirée : ${d}`);
}

fs.writeFileSync(path.join(cible, 'sessions', '_recalage.json'), `${JSON.stringify({
  reference: ref.cle,
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
const docExistant = fs.existsSync(cheminDoc) ? JSON.parse(fs.readFileSync(cheminDoc, 'utf8')) : null;
const calquesExistants = docExistant?.racine?.enfants?.length ?? 0;
if (calquesExistants === 0) {
  fs.writeFileSync(cheminDoc, `${JSON.stringify({
    version: 3,
    repere: manifeste.repere,
    sessionReference: ref.cle,
    racine: { id: 'racine', type: 'groupe', enfants: [] },
    medias: [],
  }, null, 2)}\n`);
} else {
  // Réingérer déplace la géométrie ; les annotations posées sur la précédente
  // ne désignent plus le même endroit. Elles seront refusées au chargement —
  // autant le dire ici plutôt que de laisser découvrir un panneau vide.
  console.log('');
  console.log(`  ATTENTION : ${cheminDoc} porte ${calquesExistants} calque(s) dans le repère`);
  console.log(`  « ${docExistant.repere} », et la géométrie vient de changer. Le nouveau repère`);
  console.log(`  est « ${manifeste.repere} » : ces calques seront refusés au chargement.`);
  console.log('  Le fichier n’a pas été touché.');
}

console.log('');
console.log(`objets/${id}/ écrit — ${publiees.length} capture(s) publiée(s).`);
console.log(`  taille debout : ${boiteFinale.taille.map((x) => x.toFixed(2)).join(' x ')} (large x haut x épais)`);
console.log(`  arête moyenne : ${(pasRef * 1000).toFixed(1)} mm (unités du modèle)`);
for (const e of ecartes) {
  console.log(`  ÉCARTÉE ${e.nom} : recalage à ${(e.rmse * 1000).toFixed(0)} mm, hors de portée du seuil`);
}
console.log('');
console.log('À FAIRE :');
console.log(`  1. ajouter { "id": "${id}", "nom": "${nom}" } à objets/catalogue.json`);
console.log(`  2. ouvrir ?objet=${id} — si l’objet est couché ou tête-bêche, réingérer`);
console.log('     avec --rotation-face 90 (ou 180, ou 270)');
console.log('  3. mesurer une longueur réelle sur l’objet et renseigner reglages.mesure');
