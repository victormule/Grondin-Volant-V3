// Wiring: reads the settings, builds the scene, binds the left panel.

import * as THREE from 'three';
import { config } from './reglages.js';
import { Scene3D } from './viewer/scene3d.js';
import { Eclairage } from './viewer/eclairage.js';
import { OmbreContact } from './viewer/ombre.js';
import { chargerModele, appliquerMatiere } from './viewer/modeles.js';
import { configurerAR } from './viewer/ar.js';
import { installerPanneau, exclusiviteMobile } from './ui/panneaux.js';
import { DocumentAnnotation, creerCalque, creerEpingle } from './document/modele.js';
import { PileCommandes } from './document/commandes.js';
import { chargerBrouillon, chargerPublie, supprimerBrouillon, SauvegardeDifferee } from './document/stockage.js';
import { PanneauDroit } from './ui/panneau-droit.js';
import { BarreOutils } from './ui/barre-outils.js';
import { Pointeur } from './viewer/pointage.js';
import { CoucheEpingles } from './annotations/epingles.js';
import { BibliothequeMedias } from './annotations/medias.js';
import { Pinceau } from './annotations/pinceau.js';
import { AtlasPeinture } from './peinture/atlas.js';
import { GestionnaireRegions } from './peinture/regions.js';
import { OutilSelection } from './annotations/outil-selection.js';
import { CoucheContours } from './annotations/contours.js';
import { CoucheMesures } from './annotations/mesures.js';
import { OutilMesure } from './annotations/outil-mesure.js';
import {
  Metrologie, formaterAire, formaterLongueur, formaterVolume,
  formaterAireIncertaine, formaterPourcentage,
} from './mesure/metriques.js';
import { Atelier } from './ui/atelier.js';
import { creerPalette } from './ui/palette.js';
import { creerDisqueLumiere } from './ui/disque-lumiere.js';

const $ = (selecteur) => document.querySelector(selecteur);

const elements = {
  scene: $('#scene'),
  panneau: $('#panel'),
  bouton: $('#panelToggle'),
  icone: $('#panelToggleIcon'),
  etiquette: $('#panelToggleLabel'),
  rotation: $('#rotationButton'),
  recentrer: $('#resetButton'),
  pleinEcran: $('#fullscreenButton'),
  indice: $('#hint'),
  listeSessions: $('#sessionList'),
  statut: $('#viewerStatus'),
  sousTitre: $('#projectSubtitle'),
  pastilles: $('#bgSwatches'),
  fondPerso: $('#bgCustom'),
  intensite: $('#intensityRange'),
  intensiteValeur: $('#intensityValue'),
  reflet: $('#glossRange'),
  refletValeur: $('#glossValue'),
  opaciteModele: $('#modelOpacityRange'),
  opaciteModeleValeur: $('#modelOpacityValue'),
  lumiereFixe: $('#lightFixedButton'),
  lumiereSouris: $('#lightCursorButton'),
  reglagesLumiere: $('#reglagesLumiere'),
  disqueLumiere: $('#disqueLumiere'),
  lumiereForce: $('#lightKeyRange'),
  lumiereForceValeur: $('#lightKeyValue'),
  lumiereAmbiance: $('#lightFillRange'),
  lumiereAmbianceValeur: $('#lightFillValue'),
  ar: $('#arButton'),
};

const elementsCalques = {
  panneau: $('#panneauCalques'),
  bouton: $('#calquesToggle'),
  icone: $('#calquesToggleIcon'),
  etiquette: $('#calquesToggleLabel'),
  liste: $('#calquesListe'),
  inspecteur: $('#inspecteur'),
  barreInspecteur: $('#barreInspecteur'),
  poigneeInspecteur: $('#poigneeInspecteur'),
  inspecteurBascule: $('#inspecteurBascule'),
  inspecteurBasculeTexte: $('#inspecteurBasculeTexte'),
  fiche: $('#fiche'),
  bandeau: $('#bandeauBrouillon'),
  menu: $('#menuTypes'),
  nouveauCalque: $('#nouveauCalque'),
  nouveauGroupe: $('#nouveauGroupe'),
  dupliquer: $('#dupliquerCalque'),
  fusionner: $('#fusionnerCalque'),
  supprimer: $('#supprimerCalque'),
  annuler: $('#annulerBouton'),
  retablir: $('#retablirBouton'),
  exporter: $('#exporterAnnotations'),
  importer: $('#importerAnnotations'),
  fichierImport: $('#fichierImport'),
};

const scene3d = new Scene3D(elements.scene, config);
const eclairage = new Eclairage(scene3d.renderer, scene3d.scene, config, scene3d.camera);
const ombre = new OmbreContact(scene3d.renderer, scene3d.scene, config);
eclairage.surChangement = () => scene3d.demanderRendu();
// The key light is aimed relative to the camera, so it is re-aimed on every
// frame the view actually changes — which costs three vector operations, not a
// rebuilt environment map.
scene3d.avantRendu = () => eclairage.orienter();
ombre.surChangement = () => scene3d.demanderRendu();
const definirSourcesAR = configurerAR(elements.ar, document.title);

const anisotropie = scene3d.renderer.capabilities.getMaxAnisotropy();
const modelesCharges = [];
const chargementsModeles = new Map();
let cadre = false;

/* -------------------------------------------------------------- panneaux */

const panneaux = {};
const surBascule = exclusiviteMobile(panneaux);

panneaux.gauche = installerPanneau(elements, {
  cote: 'gauche',
  ouvertParDefaut: config.affichage.panneauOuvert !== false,
  surBascule,
});

panneaux.droite = installerPanneau(elementsCalques, {
  cote: 'droite',
  ouvertParDefaut: config.affichage.panneauCalquesOuvert !== false,
  surBascule,
});

/* ----------------------------------------------------------------- vue */

scene3d.controls.addEventListener('start', () => {
  elements.indice.style.opacity = '0';
});

// The specimen's own vertical, before anything is framed: `cadrer` builds the
// opening view from it, and it runs on the first capture to arrive.
scene3d.definirAplomb(config.affichage.aplomb);
scene3d.definirAxeRotation(config.affichage.axeRotation);

elements.rotation.addEventListener('click', () => {
  scene3d.rotationAuto = !scene3d.rotationAuto;
  elements.rotation.setAttribute('aria-pressed', String(scene3d.rotationAuto));
  elements.rotation.textContent = scene3d.rotationAuto ? 'Arrêter' : 'Rotation auto';
});

elements.recentrer.addEventListener('click', () => scene3d.recentrer());

elements.pleinEcran.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (erreur) {
    console.error('Le plein écran est indisponible.', erreur);
  }
});

document.addEventListener('fullscreenchange', () => {
  elements.pleinEcran.textContent = document.fullscreenElement ? 'Quitter' : 'Plein écran';
});

/* ----------------------------------------------------------------- fond */

function definirFond(couleur) {
  document.documentElement.style.setProperty('--background', couleur);
  elements.fondPerso.value = couleur;
}

for (const couleur of config.fond.palette) {
  const pastille = document.createElement('button');
  pastille.type = 'button';
  pastille.className = 'swatch';
  pastille.style.background = couleur;
  pastille.title = couleur;
  pastille.addEventListener('click', () => definirFond(couleur));
  elements.pastilles.insertBefore(pastille, elements.fondPerso.parentElement);
}

elements.fondPerso.addEventListener('input', () => definirFond(elements.fondPerso.value));
definirFond(config.fond.couleur);

/* -------------------------------------------------------------- lumière */

elements.intensite.min = config.light.intensityMin;
elements.intensite.max = config.light.intensityMax;
elements.intensite.value = config.light.intensity;

function appliquerIntensite() {
  const valeur = Number(elements.intensite.value);
  scene3d.exposition = valeur;
  elements.intensiteValeur.textContent = valeur.toFixed(2);
}

elements.intensite.addEventListener('input', appliquerIntensite);
appliquerIntensite();

// The disc is the whole control: a dot you drag, that stays where you drop it.
const disqueLumiere = creerDisqueLumiere({
  x: eclairage.x,
  y: eclairage.y,
  angleMax: eclairage.angleMax,
  surChangement: (x, y) => eclairage.definirDirection(x, y),
});
elements.disqueLumiere.appendChild(disqueLumiere.element);

function definirModeLumiere(mode) {
  eclairage.setMode(mode);
  const dirige = eclairage.mode === 'dirigee';
  elements.lumiereFixe.setAttribute('aria-pressed', String(!dirige));
  elements.lumiereSouris.setAttribute('aria-pressed', String(dirige));
  elements.reglagesLumiere.hidden = !dirige;
}

elements.lumiereFixe.addEventListener('click', () => definirModeLumiere('fixe'));
elements.lumiereSouris.addEventListener('click', () => definirModeLumiere('dirigee'));

elements.lumiereForce.value = eclairage.cle.intensity;
elements.lumiereForceValeur.textContent = Number(eclairage.cle.intensity).toFixed(2);
elements.lumiereForce.addEventListener('input', () => {
  const valeur = Number(elements.lumiereForce.value);
  elements.lumiereForceValeur.textContent = valeur.toFixed(2);
  eclairage.definirIntensite(valeur);
});

elements.lumiereAmbiance.value = eclairage.ambiance;
elements.lumiereAmbianceValeur.textContent = `${Math.round(eclairage.ambiance * 100)} %`;
elements.lumiereAmbiance.addEventListener('input', () => {
  const valeur = Number(elements.lumiereAmbiance.value);
  elements.lumiereAmbianceValeur.textContent = `${Math.round(valeur * 100)} %`;
  eclairage.definirAmbiance(valeur);
});

definirModeLumiere(config.light.mode === 'souris' ? 'dirigee' : config.light.mode);

ombre.intensite = config.ombre.intensite;

/* -------------------------------------------------------------- matière */

elements.reflet.value = config.matiere.rugosite;
elements.refletValeur.textContent = Number(config.matiere.rugosite).toFixed(2);
elements.opaciteModele.value = config.matiere.opacite;

function appliquerMatiereGlobale() {
  const opacite = Number(elements.opaciteModele.value);
  elements.opaciteModeleValeur.textContent = `${Math.round(opacite * 100)} %`;
  for (const racine of modelesCharges) {
    appliquerMatiere(racine, {
      rugosite: Number(elements.reflet.value),
      metal: config.matiere.metal,
      opacite,
      anisotropie,
    });
  }
  scene3d.demanderRendu();
}

elements.reflet.addEventListener('input', () => {
  elements.refletValeur.textContent = Number(elements.reflet.value).toFixed(2);
  appliquerMatiereGlobale();
});
elements.opaciteModele.addEventListener('input', appliquerMatiereGlobale);
appliquerMatiereGlobale();

/* ----------------------------------------------------------- annotations */

// Keyed by path so two deployments on the same domain keep separate drafts.
const ID_PROJET = `durair:${location.pathname}`;

const documentAnnotation = DocumentAnnotation.vide(null);
const pile = new PileCommandes();
const sauvegarde = new SauvegardeDifferee(ID_PROJET);
const bibliotheque = new BibliothequeMedias();
const pointeur = new Pointeur(scene3d);

const panneauDroit = new PanneauDroit(elementsCalques, {
  document: documentAnnotation,
  pile,
  sauvegarde,
  sessions: [],
  medias: bibliotheque,
  couleurs: config.couleurs,
});

const coucheEpingles = new CoucheEpingles($('#epingles'), scene3d, pointeur, {
  document: documentAnnotation,
  surSelection: (idEpingle, idCalque) => {
    panneauDroit.ouvrirFiche(idEpingle, idCalque);
  },
});
panneauDroit.surSelectionElement = (idEpingle) => coucheEpingles.selectionner(idEpingle);
panneauDroit.surDemandeOuverture = () => panneaux.droite.definirOuvert(true);

// The markers and the measurement figures are DOM, so they are repositioned
// after every frame that the on-demand renderer actually draws.
scene3d.apresRendu = (cameraChangee) => {
  const epinglesAContinuer = coucheEpingles.majPositions(cameraChangee);
  const mesuresAContinuer = coucheMesures.majPositions(cameraChangee);
  return epinglesAContinuer || mesuresAContinuer;
};

// Separate fingerprints keep visual changes away from geometry caches. Paint
// opacity changes what the atlas looks like, never the measured area, region
// topology or surface paths; invalidating all four used to turn one slider
// movement into several unrelated GPU/CPU calculations.
//
// The five fingerprints overlap heavily — four of them are built around the
// same per-layer element list. That list is serialised once per layer and the
// resulting string is shared, rather than handing the same nested arrays to
// JSON.stringify three times over. This runs on every single refresh, so on a
// document carrying a few thousand dabs it was re-serialising hundreds of
// kilobytes of unchanged data on each stroke, each rename, each slider step.
function signaturesRenduDocument(doc) {
  const rendu = [];
  const atlas = [];
  const metriques = [];
  const geometrieRegions = [];
  const trajetsMesures = [];
  const visiter = (parent, parentVisible = true, opaciteParente = 1, portees = []) => {
    for (const calque of parent.enfants ?? []) {
      const visible = parentVisible && calque.visible !== false;
      const propre = Number(calque.opacite);
      const opacite = opaciteParente
        * (Number.isFinite(propre) ? Math.max(0, Math.min(1, propre)) : 1);
      const portee = [...portees, calque.portee ?? 'toutes'];
      if (calque.type === 'peinture' || calque.type === 'region' || calque.type === 'mesure') {
        const elements = (calque.donnees?.elements ?? []).map((element) => {
          const donnees = element.empreintes ?? element.faces ?? element.points ?? [];
          return [element.id, donnees.length, donnees[0], donnees[Math.floor(donnees.length / 2)],
            donnees.at(-1), element.mode,
            element.efface, element.durete, element.seuilNormale];
        });
        const contenu = JSON.stringify(elements);
        const ligneRendu = JSON.stringify([calque.id, calque.type, visible, calque.couleur,
          opacite, calque.fusion, calque.contour, portee]) + contenu;
        rendu.push(ligneRendu);
        if (calque.type === 'peinture' || calque.type === 'region') {
          atlas.push(ligneRendu);
          metriques.push(`${calque.id}|${calque.type}|${contenu}`);
        }
        if (calque.type === 'region') geometrieRegions.push(`${calque.id}|${contenu}`);
        if (calque.type === 'mesure') trajetsMesures.push(`${calque.id}|${contenu}`);
      }
      if (calque.enfants) visiter(calque, visible, opacite, portee);
    }
  };
  visiter(doc.racine);
  return {
    rendu: rendu.join('\n'),
    atlas: atlas.join('\n'),
    metriques: metriques.join('\n'),
    regions: geometrieRegions.join('\n'),
    trajets: trajetsMesures.join('\n'),
  };
}

let derniereSignatureRendu = null;
let derniereSignatureAtlas = null;
let derniereSignatureMetriques = null;
let derniereSignatureRegions = null;
let derniereSignatureTrajets = null;
let revisionAtlas = 0;

panneauDroit.surChangementDocument = (idSelection) => {
  coucheEpingles.definirDocument(panneauDroit.doc);
  coucheEpingles.selectionner(idSelection);
  scene3d.demanderRendu();
  const signatures = signaturesRenduDocument(panneauDroit.doc);
  const renduModifie = signatures.rendu !== derniereSignatureRendu;
  const atlasModifie = signatures.atlas !== derniereSignatureAtlas;
  const metriquesModifiees = signatures.metriques !== derniereSignatureMetriques;
  const regionsModifiees = signatures.regions !== derniereSignatureRegions;
  const trajetsModifies = signatures.trajets !== derniereSignatureTrajets;
  derniereSignatureRendu = signatures.rendu;
  derniereSignatureAtlas = signatures.atlas;
  derniereSignatureMetriques = signatures.metriques;
  derniereSignatureRegions = signatures.regions;
  derniereSignatureTrajets = signatures.trajets;

  if (atlasModifie) revisionAtlas += 1;
  if (regionsModifiees) regions.invalider();
  if (metriquesModifiees) metrologie.invalider();
  if (trajetsModifies) coucheMesures.invalider();
  if (!atlas.enTrait && renduModifie) {
    recomposerPeinture();
  }
  majCibles();
};

/* ----------------------------------------------------------- peinture */

const atlas = new AtlasPeinture(scene3d.renderer, config);
const pinceau = new Pinceau(pointeur, atlas, config);
const regions = new GestionnaireRegions(config);
const contours = new CoucheContours(scene3d.scene, scene3d.renderer, config);
const outilSelection = new OutilSelection(pointeur, regions, config);
const metrologie = new Metrologie(scene3d.renderer, config, { atlas, regions });
const coucheMesures = new CoucheMesures($('#mesures'), scene3d, pointeur, config);
const outilMesure = new OutilMesure(pointeur, config);

atlas.fournirRegion = (calque, cle) => regions.geometrieUV(calque, cle);

// During an opacity drag, update only the selected paint/region layer. The
// definitive change still goes through the normal undoable document mutation
// and recomposes every required capture once.
panneauDroit.surApercuDocument = (detail) => {
  const calque = detail?.idCalque ? panneauDroit.doc.trouver(detail.idCalque) : null;
  if (detail?.type === 'opacite' && calque
    && (calque.type === 'peinture' || calque.type === 'region')
    && atlas.previsualiserOpacite(panneauDroit.doc, calque.id)) {
    if (calque.type === 'region') contours.rafraichir(panneauDroit.doc, regions, captureCourante);
    scene3d.demanderRendu();
    return;
  }

  // Annotation and measurement opacity is already cheap. Group opacity is
  // reflected in these lightweight layers while its flattened paint atlas is
  // committed once when the slider is released.
  coucheEpingles.definirDocument(panneauDroit.doc);
  contours.rafraichir(panneauDroit.doc, regions, captureCourante);
  coucheMesures.rafraichir(panneauDroit.doc, captureCourante,
    regions.capture(captureCourante?.cle));
  scene3d.demanderRendu();
};

// The capture the tools work on: the one on screen, or the reference capture
// when all of them are.
let captureCourante = null;

function recomposerPeinture() {
  atlas.recomposer(panneauDroit.doc, revisionAtlas);
  contours.rafraichir(panneauDroit.doc, regions, captureCourante);
  coucheMesures.echelle = echelle();
  coucheMesures.rafraichir(panneauDroit.doc, captureCourante,
    regions.capture(captureCourante?.cle));
  scene3d.demanderRendu();
}

/* ------------------------------------------------------------- outils */

// Brush and eraser each keep their own size and hardness — an eraser is
// usually wanted a bit larger than the brush that made the mark.
const reglagesTrace = {
  pinceau: { taille: config.peinture.taille, durete: config.peinture.durete },
  gomme: { taille: config.peinture.tailleGomme, durete: config.peinture.durete },
};

function brancherTrace(nom, prefixe) {
  const elements = {
    panneau: $(`#reglages${prefixe}`),
    taille: $(`#${nom}Taille`),
    tailleValeur: $(`#${nom}TailleValeur`),
    durete: $(`#${nom}Durete`),
    dureteValeur: $(`#${nom}DureteValeur`),
    cible: $(`#${nom}Cible`),
  };

  elements.taille.min = config.peinture.tailleMin;
  elements.taille.max = config.peinture.tailleMax;
  elements.taille.value = reglagesTrace[nom].taille;
  elements.durete.value = reglagesTrace[nom].durete;
  elements.tailleValeur.textContent = `${reglagesTrace[nom].taille} mm`;
  elements.dureteValeur.textContent = reglagesTrace[nom].durete.toFixed(2);

  elements.taille.addEventListener('input', () => {
    const mm = Number(elements.taille.value);
    reglagesTrace[nom].taille = mm;
    elements.tailleValeur.textContent = `${mm} mm`;
    if (barreOutils.actif === nom) pinceau.rayon = mm / 2000; // le réglage est un diamètre
  });

  elements.durete.addEventListener('input', () => {
    const valeur = Number(elements.durete.value);
    reglagesTrace[nom].durete = valeur;
    elements.dureteValeur.textContent = valeur.toFixed(2);
    if (barreOutils.actif === nom) pinceau.durete = valeur;
  });

  return elements;
}

const elementsPinceau = brancherTrace('pinceau', 'Pinceau');
const elementsGomme = brancherTrace('gomme', 'Gomme');
const elementsEpingle = { panneau: $('#reglagesEpingle'), cible: $('#epingleCible') };

/* -------------------------------------------------------------- mesure */

const elementsMesure = {
  panneau: $('#reglagesMesure'),
  cible: $('#mesureCible'),
  modes: $('#mesureModes'),
  etat: $('#mesureEtat'),
  retirer: $('#mesureRetirer'),
  terminer: $('#mesureTerminer'),
  specimen: $('#mesureSpecimen'),
};

// Automatic metres-per-model-unit conversion. The known reference is 59 cm
// in the model for 19 cm in reality. The formatting boundary applies this
// factor once to lengths, twice to areas and three times to volumes.
const referenceModele = Number(config.mesure.longueurModeleReference);
const referenceReelle = Number(config.mesure.longueurReelleReference);
const ECHELLE_MESURE = Number.isFinite(referenceModele) && referenceModele > 0
  && Number.isFinite(referenceReelle) && referenceReelle > 0
  ? referenceReelle / referenceModele
  : 1;
const echelle = () => ECHELLE_MESURE;

for (const bouton of elementsMesure.modes.querySelectorAll('button')) {
  bouton.setAttribute('aria-pressed', String(bouton.dataset.mode === outilMesure.mode));
  bouton.addEventListener('click', () => {
    outilMesure.definirMode(bouton.dataset.mode);
    for (const autre of elementsMesure.modes.querySelectorAll('button')) {
      autre.setAttribute('aria-pressed', String(autre === bouton));
    }
  });
}

elementsMesure.retirer.addEventListener('click', () => outilMesure.retirerDernier());
elementsMesure.terminer.addEventListener('click', () => terminerMesure());

// Live read-out while the measurement is being taken, plus the rubber band.
// Placed surface paths stay cached while only the free end follows the pointer.
let apercuMesure = null;

outilMesure.surChangement = () => {
  const entree = regions.capture(captureCourante?.cle);
  apercuMesure = coucheMesures.montrerApercu(outilMesure.points, outilMesure.libre,
    entree, outilMesure.mode, outilMesure.revision);
  scene3d.demanderRendu();

  const poses = outilMesure.points.length;
  elementsMesure.etat.textContent = poses === 0
    ? 'Cliquez un premier point sur le spécimen.'
    : (apercuMesure
      ? `${formaterLongueur(apercuMesure.longueur, echelle())}${apercuMesure.provisoire ? '…' : ''}`
        + ` · ${poses} point${poses > 1 ? 's' : ''} posé${poses > 1 ? 's' : ''}`
      : 'Cliquez un deuxième point.');

  elementsMesure.retirer.disabled = !outilMesure.enCours;
  elementsMesure.terminer.disabled = poses < 2;
};

// Each measurement is one entry in the layer, one entry in the undo stack.
function terminerMesure() {
  if (outilMesure.points.length < 2) { outilMesure.annuler(); return; }
  const idCalque = atelier.calqueCourant();
  if (!idCalque) { outilMesure.annuler(); return; }
  const mesure = outilMesure.terminer(sessionCourante?.id ?? null);
  if (!mesure) return;

  panneauDroit.muter('Ajouter une mesure', () => {
    const calque = panneauDroit.doc.trouver(idCalque);
    if (calque?.donnees) calque.donnees.elements.push(mesure);
  });
  majCibles();
}

// The palettes edit the colour of the layer the tool is aimed at, so colour is
// chosen where the work happens rather than only in the inspector.
function brancherPalette(hote, nom) {
  const palette = creerPalette(config.couleurs, (couleur) => {
    const id = atelier.calqueCourant();
    if (!id) return;
    panneauDroit.muter('Couleur du calque', () => {
      const calque = panneauDroit.doc.trouver(id);
      if (calque) calque.couleur = couleur;
    });
    majCibles();
  });
  hote.appendChild(palette);
  palettes[nom] = palette;
}

/* ---------------------------------------------------------- sélection */

const elementsSelection = {
  panneau: $('#reglagesSelection'),
  angle: $('#selAngle'),
  angleValeur: $('#selAngleValeur'),
  tolerance: $('#selTolerance'),
  toleranceValeur: $('#selToleranceValeur'),
  champAngle: $('#champAngle'),
  champTolerance: $('#champTolerance'),
  titre: $('#selTitre'),
  cible: $('#selCible'),
  modes: $('#selModes'),
  etat: $('#selEtat'),
  elargir: $('#selElargir'),
  retrecir: $('#selRetrecir'),
  lisser: $('#selLisser'),
  vider: $('#selVider'),
  creer: $('#selCreerRegion'),
  trace: $('#traceLasso'),
  ligne: $('#traceLassoLigne'),
};

elementsSelection.angle.value = config.selection.angleMax;
elementsSelection.tolerance.value = config.selection.tolerance;
elementsSelection.angleValeur.textContent = `${config.selection.angleMax}°`;
elementsSelection.toleranceValeur.textContent = String(config.selection.tolerance);

elementsSelection.angle.addEventListener('input', () => {
  outilSelection.angleMax = Number(elementsSelection.angle.value);
  elementsSelection.angleValeur.textContent = `${elementsSelection.angle.value}°`;
});
elementsSelection.tolerance.addEventListener('input', () => {
  outilSelection.tolerance = Number(elementsSelection.tolerance.value);
  elementsSelection.toleranceValeur.textContent = elementsSelection.tolerance.value;
});

elementsSelection.elargir.addEventListener('click', () => outilSelection.elargir(1));
elementsSelection.retrecir.addEventListener('click', () => outilSelection.elargir(-1));
elementsSelection.lisser.addEventListener('click', () => outilSelection.lisser());
elementsSelection.vider.addEventListener('click', () => outilSelection.vider());
elementsSelection.creer.addEventListener('click', () => creerRegion());

for (const bouton of elementsSelection.modes.querySelectorAll('button')) {
  bouton.addEventListener('click', () => {
    outilSelection.definirMode(bouton.dataset.mode);
    for (const autre of elementsSelection.modes.querySelectorAll('button')) {
      autre.setAttribute('aria-pressed', String(autre === bouton));
    }
  });
}

outilSelection.surChangement = (selection) => {
  elementsSelection.etat.textContent = selection.size === 0
    ? 'Aucune sélection.'
    : `${selection.size.toLocaleString('fr-FR')} faces sélectionnées.`;
  elementsSelection.creer.disabled = selection.size === 0;
  contours.montrerApercu(outilSelection.geometrie(), outilSelection.segments());
  scene3d.demanderRendu();

  // Said on the view, not only in the panel. A selection is made by looking at
  // the specimen, and until it is turned into a layer it is worth nothing —
  // yet the one key that does it was written down nowhere the eye was.
  // Highlighted faces with no visible way forward read as a dead end.
  afficherStatut(selection.size === 0
    ? ''
    : `${selection.size.toLocaleString('fr-FR')} faces sélectionnées · `
      + 'Entrée pour en faire une région · Échap pour annuler');
};

// Every tool panel says where its work will land, and the palettes show that
// layer's colour.
function majCibles() {
  const etiquette = atelier.etiquetteCible();
  for (const elements of [elementsPinceau, elementsGomme, elementsEpingle, elementsMesure]) {
    if (elements.cible) elements.cible.textContent = etiquette;
  }
  elementsSelection.cible.textContent = etiquette;
  elementsSelection.titre.textContent = barreOutils.actif === 'lasso' ? 'Lasso' : 'Baguette magique';

  const type = atelier.typeDeLOutil();
  const calque = type ? atelier.calqueUtilisable(type) : null;
  for (const palette of Object.values(palettes)) palette.marquer(calque?.couleur ?? '');
}

/* ------------------------------------------------------------ métriques */

// Where an area's ± comes from — three different claims, and the read-out is
// not allowed to pass off the weakest as the strongest.
const AIDE_INCERTITUDE = {
  exacte: 'Incertitude = écart entre la somme exacte sur les triangles et l’intégration '
    + 'de la couverture dans l’atlas. Deux méthodes indépendantes, rien de supposé.',
  mesuree: 'Incertitude reprise de l’écart entre les deux méthodes, mesuré sur une région '
    + 'de ce document — la peinture n’a pas de contrepartie exacte à laquelle se comparer.',
  calibration: 'Incertitude issue de la calibration inscrite dans les réglages : ce document '
    + 'ne contient aucune région, donc rien ici n’a pu être vérifié en direct. Convertissez '
    + 'une peinture en région pour obtenir une incertitude mesurée sur ce spécimen.',
};

// What a layer measures, formatted for the inspector. Every caveat travels
// with its figure: a number printed without the condition under which it is
// valid is worse than no number.
panneauDroit.mesures = (calque) => {
  if (calque.type === 'mesure') return relevesMesure(calque);
  if (calque.type !== 'peinture' && calque.type !== 'region') return null;

  const releve = metrologie.mesurer(calque, captureCourante);
  if (!releve) return null;

  const k = echelle();
  const lignes = [
    {
      etiquette: 'Aire',
      valeur: formaterAireIncertaine(releve.aire, releve.incertitude, k),
      aide: `${AIDE_INCERTITUDE[releve.sourceIncertitude ?? 'exacte']} `
        + 'C’est l’incertitude de la MÉTHODE sur cette capture, pas la reproductibilité '
        + 'de la mesure : celle-ci se lit plus bas, « D’une capture à l’autre », et elle '
        + 'est bien plus grande.',
    },
    { etiquette: 'Périmètre', valeur: formaterLongueur(releve.perimetre, k) },
  ];

  // The share of the entity this layer sits inside. « 35 % de la nageoire
  // pectorale droite » is the figure a conservator actually writes down, and it
  // only means anything because the group above now says what it is.
  const entite = panneauDroit.doc.entiteDe(calque.id);
  if (entite && releve.aire > 0) {
    const etendue = aireDUneEntite(entite, calque.id);
    if (etendue && etendue.aire > releve.aire) {
      lignes.push({
        etiquette: `Part de « ${entite.nom} »`,
        valeur: formaterPourcentage(releve.aire / etendue.aire),
        aide: `Rapporté aux ${formaterAire(etendue.aire, k)} du calque « ${etendue.nom} », `
          + `l’étendue que cette entité porte directement.`,
      });
    }
  }

  if (releve.methode === 'maillage') {
    lignes.push({ etiquette: 'Faces', valeur: releve.faces.toLocaleString('fr-FR') });
    const aideVolume = releve.boucles === 0
      ? 'Volume de la surface fermée.'
      : (releve.boucles === 1
        ? 'Volume compris entre la zone et le couvercle plat qui ferme son contour.'
        : `Volume fermé par ${releve.boucles} couvercles plats, un par contour.`);
    lignes.push({
      etiquette: 'Volume',
      valeur: formaterVolume(releve.volume, k),
      aide: aideVolume,
    });
  }

  const notes = [];
  if (releve.methode === 'maillage' && releve.aireRaster) {
    const ecart = Math.abs(releve.aire - releve.aireRaster) / releve.aire;
    notes.push(`Les deux méthodes indépendantes se rejoignent à ${formaterPourcentage(ecart, 2)} `
      + '(somme exacte sur les triangles contre intégration de la couverture). '
      + 'C’est cet écart, mesuré ici et maintenant, qui sert d’incertitude.');
  }
  if (releve.methode === 'atlas') {
    notes.push('Peinture : l’aire est intégrée sur l’atlas. Le '
      + 'périmètre est sous-estimé là où la zone traverse une couture UV — jusqu’à '
      + '13 % dans le pire cas. Un volume demande un bord fait d’arêtes : '
      + 'convertissez la zone en région pour l’obtenir.');
  } else if (releve.volume === null) {
    notes.push('Le contour est interrompu ou se ramifie : il ne délimite pas encore une surface '
      + 'refermable. « Lisser la région » peut réparer les petites irrégularités.');
  } else if (releve.boucles > 1) {
    notes.push(`Volume fermé par ${releve.boucles} couvercles plats — un pour chaque contour. `
      + 'C’est le cas normal d’une bande qui entoure la queue.');
  }
  return { lignes, note: notes.join(' ') || null };
};

panneauDroit.surConversionRegion = async (calqueInitial) => {
  const calque = panneauDroit.doc.trouver(calqueInitial?.id);
  if (!calque || calque.type !== 'peinture' || !captureCourante) {
    afficherStatut('Conversion impossible : aucune capture active.');
    return false;
  }

  afficherStatut('Conversion de la peinture en région…');
  // Let the status reach the screen before the deliberate GPU readback.
  await new Promise((resoudre) => requestAnimationFrame(resoudre));
  const faces = metrologie.facesDepuisPeinture(calque, captureCourante);
  if (faces.size === 0) {
    afficherStatut('Aucune face suffisamment couverte par cette peinture.');
    return false;
  }

  const region = creerCalque('region', panneauDroit.doc.nomDisponible(`${calque.nom} — région`));
  region.couleur = calque.couleur;
  region.opacite = calque.opacite;
  region.visible = calque.visible;
  region.portee = structuredClone(calque.portee ?? 'toutes');
  region.contour = true;
  region.donnees.elements.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now().toString(36)}`,
    faces: [...faces],
    session: captureCourante.session ?? sessionCourante?.id ?? null,
  });

  const parent = panneauDroit.doc.parentDe(calque.id);
  const idParent = parent === panneauDroit.doc.racine ? null : parent.id;
  const index = parent.enfants.findIndex((c) => c.id === calque.id) + 1;
  panneauDroit.muter('Convertir la peinture en région', () => {
    panneauDroit.doc.ajouter(region, idParent, index);
  });
  panneauDroit.liste.selectionner(region.id);
  afficherStatut(`Région créée · ${faces.size.toLocaleString('fr-FR')} faces`);
  setTimeout(() => {
    if (elements.statut.textContent.startsWith('Région créée')) afficherStatut('');
  }, 2200);
  return true;
};

panneauDroit.surLissageRegion = (calqueInitial) => {
  const id = calqueInitial?.id;
  const calque = panneauDroit.doc.trouver(id);
  if (!calque || calque.type !== 'region') return false;

  let resultat = null;
  panneauDroit.muter('Lisser la région', () => {
    const courant = panneauDroit.doc.trouver(id);
    if (!courant || courant.type !== 'region') return;
    resultat = regions.lisser(courant);
    metrologie.invalider(courant.id);
  });

  if (!resultat?.elements) return false;
  const releve = metrologie.mesurer(panneauDroit.doc.trouver(id), captureCourante);
  const detail = `${resultat.apres.toLocaleString('fr-FR')} faces`;
  afficherStatut(releve?.volume === null
    ? `Région lissée · ${detail} · le contour reste interrompu ou ramifié`
    : `Région lissée · ${detail}${releve?.volume != null ? ' · volume disponible' : ''}`);
  setTimeout(() => {
    if (elements.statut.textContent.startsWith('Région lissée')) afficherStatut('');
  }, 2600);
  return true;
};

// The extent of an entity, for the ratio above — and the rule is deliberately
// strict, because the first version of it lied.
//
// It took the largest extent layer anywhere under the entity. On the group
// « Pectoral », which holds one paint layer per fin, that made the right fin
// « 91,9 % of Pectoral » when what it had actually been divided by was the LEFT
// fin. A wrong ratio printed beside two honest measurements is worse than no
// ratio: it is the one figure a reader cannot check.
//
// So nothing is guessed. The whole must be a layer the entity holds DIRECTLY,
// and there must be exactly one candidate — two means the tree does not say
// which is the whole. The part must sit deeper than that, inside a sub-group:
// the nesting is then the user asserting containment, not this function
// inferring it from a comparison of sizes.
function aireDUneEntite(entite, idCalque) {
  const doc = panneauDroit.doc;
  const enfants = entite.enfants ?? [];
  if (enfants.some((c) => c.id === idCalque)) return null;

  const candidats = enfants.filter((c) => (c.type === 'peinture' || c.type === 'region')
    && !doc.contient(c.id, idCalque));
  if (candidats.length !== 1) return null;

  const releve = metrologie.mesurer(candidats[0], captureCourante);
  return releve?.aire ? { aire: releve.aire, nom: candidats[0].nom } : null;
}

/* ------------------------------------------------- d’une capture à l’autre */

// The alignment residuals, produced when the captures were registered onto the
// first one. A pin placed on session 1 and read on session 3 is not where it
// was to the millimetre, and this file says by how much. Showing it is the
// difference between a viewer that shares one frame and one that pretends the
// frame is exact.
let recalage = null;

async function chargerRecalage() {
  const chemin = config.mesure.recalage;
  if (!chemin) return;
  try {
    const reponse = await fetch(chemin, { cache: 'no-store' });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    recalage = await reponse.json();
    // It usually lands after the first capture is already on screen, so the
    // read-outs that quote it are asked to say it again.
    majSpecimen();
    panneauDroit.inspecteur.rendre();
  } catch (erreur) {
    // Not fatal, and not worth a message on screen: the figures below simply
    // come without their residual rather than not at all.
    console.warn('Résidus de recalage indisponibles.', erreur);
  }
}

// Worst residual across the captures, in model units — the honest single number
// when a figure concerns all of them at once.
function residuRecalage() {
  if (!recalage) return null;
  let pire = 0;
  for (const [cle, valeur] of Object.entries(recalage)) {
    if (!/^session\d+$/.test(cle) || !Number.isFinite(valeur?.rmse)) continue;
    pire = Math.max(pire, valeur.rmse);
  }
  return pire || null;
}

// The same layer, measured on every capture already in memory.
//
// Read this table for what it is. The three captures were taken within an hour
// of each other, so it does not show the specimen changing — it shows the same
// state measured three times, and its spread is the repeatability of the whole
// chain: photogrammetry, alignment, face transfer, estimator. That number is
// what a single area from this tool is worth. On a specimen re-captured in two
// years the very same table reads as change instead, against a noise floor that
// is now known rather than assumed.
panneauDroit.comparaison = (calque) => {
  if (calque.type !== 'peinture' && calque.type !== 'region') return null;
  const chargees = sessionsConnues
    .map((session, index) => ({ session, capture: atlas.capture(cleCapture(session, index)) }))
    .filter(({ capture }) => capture && regions.capture(capture.cle));
  if (chargees.length < 2) return null;

  const k = echelle();
  const lignes = [];
  const aires = [];
  for (const { session, capture } of chargees) {
    const releve = metrologie.mesurer(calque, capture);
    const mesurable = releve && releve.aire > 0;
    if (mesurable) aires.push(releve.aire);
    lignes.push({
      etiquette: session.label,
      valeur: mesurable ? formaterAire(releve.aire, k) : 'non transférée',
      absent: !mesurable,
      courante: capture.cle === captureCourante?.cle,
    });
  }
  if (aires.length < 2) return null;

  const moyenne = aires.reduce((somme, valeur) => somme + valeur, 0) / aires.length;
  const etendue = Math.max(...aires) - Math.min(...aires);
  const dispersion = {
    etiquette: 'Écart entre captures',
    valeur: `${formaterAire(etendue, k)} · ${formaterPourcentage(etendue / moyenne)}`,
    aide: 'Étendue des valeurs rapportée à leur moyenne.',
  };

  const notes = [];
  const manquantes = sessionsConnues.length - chargees.length;
  if (manquantes > 0) {
    notes.push(`${manquantes} capture${manquantes > 1 ? 's ne sont' : ' n’est'} pas chargée${manquantes > 1 ? 's' : ''} `
      + '— ouvrez-la pour la faire entrer dans la comparaison.');
  }
  // Measured on this specimen: the estimator agrees with itself to about a
  // tenth of a percent, while two captures of the same fin disagree by nearly
  // three. The ± printed above is therefore the smaller, easier claim, and
  // saying which is which is the difference between an honest read-out and a
  // falsely precise one.
  const methode = metrologie.incertitudeRelative ?? config.mesure.incertitudeAire;
  if (methode && etendue / moyenne > methode * 2) {
    notes.push(`Cet écart vaut ${formaterPourcentage(etendue / moyenne)}, contre `
      + `${formaterPourcentage(methode, 2)} d’incertitude de méthode : c’est la reproductibilité, `
      + 'et non le « ± » affiché plus haut, qui limite ce qu’on peut conclure d’une différence.');
  }

  const memeJour = new Set(sessionsConnues.map((s) => s.date)).size === 1;
  notes.push(memeJour
    ? 'Ces captures ont été prises le même jour : cet écart n’est pas une évolution '
      + 'du spécimen, c’est la répétabilité de la chaîne de mesure. Toute variation '
      + 'plus faible que lui, sur une campagne future, ne sera pas interprétable.'
    : 'Captures de dates différentes : l’écart mêle l’évolution réelle du spécimen '
      + 'et la répétabilité de la chaîne de mesure.');
  const residu = residuRecalage();
  if (residu) {
    notes.push(`Les captures sont recalées à ${formaterLongueur(residu, k)} près (RMSE), `
      + 'ce qui borne aussi la fidélité du report d’un calque d’une capture à l’autre.');
  }

  return { lignes, dispersion, note: notes.join(' ') };
};

function relevesMesure(calque) {
  const elements = calque.donnees?.elements ?? [];
  if (elements.length === 0) return null;
  const entree = regions.capture(captureCourante?.cle);

  const k = echelle();
  let total = 0;
  const lignes = [];
  for (const element of elements) {
    const trace = coucheMesures.trace(element, entree, captureCourante?.cle ?? '-');
    total += trace.longueur;
    lignes.push({
      etiquette: element.mode === 'surface' ? 'Sur la surface' : 'En ligne droite',
      valeur: formaterLongueur(trace.longueur, k),
    });
  }
  if (lignes.length > 1) lignes.push({ etiquette: 'Total', valeur: formaterLongueur(total, k) });
  return { lignes, note: null };
}

// The specimen itself, in the ruler's panel: the one place where a figure
// about the whole model belongs.
function majSpecimen() {
  const bloc = elementsMesure.specimen;
  bloc.replaceChildren();
  const releve = metrologie.specimen(captureCourante);
  if (!releve) return;

  const titre = document.createElement('span');
  titre.className = 'group-title';
  titre.textContent = 'Le spécimen';
  bloc.appendChild(titre);

  const k = echelle();
  const lignes = [
    ['Surface', formaterAire(releve.aire, k)],
    ['Volume', formaterVolume(releve.volume, k)],
    ['Face médiane', formaterLongueur(releve.areteMediane, k)],
  ];
  for (const [etiquette, valeur] of lignes) {
    const ligne = document.createElement('div');
    ligne.className = 'releve-ligne';
    ligne.append(Object.assign(document.createElement('span'), { textContent: etiquette }),
      Object.assign(document.createElement('strong'), { textContent: valeur }));
    bloc.appendChild(ligne);
  }

  // The volume of an open surface is whatever the divergence theorem happens
  // to return, which is not a volume. Saying so is the whole value of the line.
  const note = document.createElement('p');
  note.className = 'reglages-note';
  note.textContent = releve.ferme
    ? 'Maillage fermé : le volume est exact.'
    : `Maillage ouvert (${releve.aretesDeBord.toLocaleString('fr-FR')} arêtes de bord) : `
      + 'le volume ci-dessus n’est qu’un ordre de grandeur.';
  bloc.appendChild(note);

  // Where the metre comes from. Without this line every figure above is
  // unverifiable: they are all one multiplication away from a reference nobody
  // can see, and a reader has no way to know whether it was measured on the
  // specimen or inherited from the capture device.
  const provenance = document.createElement('p');
  provenance.className = 'reglages-note';
  const reference = `${formaterLongueur(Number(config.mesure.longueurModeleReference))} `
    + `dans le modèle pour ${formaterLongueur(Number(config.mesure.longueurReelleReference))} réels`;
  const residu = residuRecalage();
  provenance.textContent = `Échelle : ${reference}. Toutes les valeurs de l’application en découlent.`
    + (residu ? ` Captures recalées à ${formaterLongueur(residu, k)} près (RMSE).` : '');
  bloc.appendChild(provenance);
}

// The selection becomes a named region layer — the point of the whole tool:
// « nageoire pectorale droite » rather than a set of triangle indices.
function creerRegion() {
  if (outilSelection.vide) return;
  const faces = [...outilSelection.selection];
  const idCalque = atelier.calqueCourant();
  if (!idCalque) return;

  panneauDroit.muter('Ajouter à la région', () => {
    const calque = panneauDroit.doc.trouver(idCalque);
    if (!calque?.donnees) return;
    calque.donnees.elements.push({
      id: crypto.randomUUID(), faces,
      session: regions.idSession ?? captureCourante?.session ?? sessionCourante?.id ?? null,
    });
  });

  outilSelection.vider();
  majCibles();
}

function majResolutionContours() {
  const t = scene3d.renderer.domElement;
  contours.majResolution(t.clientWidth, t.clientHeight);
  coucheMesures.majResolution(t.clientWidth, t.clientHeight);
}
window.addEventListener('resize', majResolutionContours);
majResolutionContours();

window.addEventListener('keydown', (evenement) => {
  const cible = evenement.target;
  if (cible instanceof HTMLInputElement || cible instanceof HTMLTextAreaElement
    || cible instanceof HTMLSelectElement || cible?.isContentEditable) return;

  if (evenement.key === 'Enter' && outilMesure.enCours) {
    evenement.preventDefault();
    terminerMesure();
    return;
  }
  // Escape otherwise falls through to the rail, which switches back to
  // « Naviguer » — dropping an unfinished measurement first.
  if (evenement.key === 'Escape' && outilMesure.enCours) {
    evenement.preventDefault();
    // Both listeners are on `window`, so only the immediate form stops the
    // rail from also hearing this Escape and jumping back to « Naviguer ».
    evenement.stopImmediatePropagation();
    outilMesure.annuler();
    return;
  }
  if (evenement.key === 'Enter' && !outilSelection.vide) {
    evenement.preventDefault();
    creerRegion();
    return;
  }
  // Clears the selection and stays in the tool. Escape already dropped it, but
  // only as a side effect of the rail switching back to « Naviguer » — so the
  // way to start a selection over was to leave the tool and come back. Now the
  // on-screen hint can promise it, and pressing it twice still leaves.
  if (evenement.key === 'Escape' && !outilSelection.vide) {
    evenement.preventDefault();
    evenement.stopImmediatePropagation();
    outilSelection.vider();
  }
});

const palettes = {};

const barreOutils = new BarreOutils($('#barreOutils'), {
  panneaux: {
    epingle: elementsEpingle.panneau,
    pinceau: elementsPinceau.panneau,
    gomme: elementsGomme.panneau,
    baguette: elementsSelection.panneau,
    lasso: elementsSelection.panneau,
    mesure: elementsMesure.panneau,
  },
  surChangement: (outil) => {
    const selectionne = outil === 'baguette' || outil === 'lasso';
    const trace = outil === 'pinceau' || outil === 'gomme';

    elementsSelection.champAngle.hidden = outil !== 'baguette';
    elementsSelection.champTolerance.hidden = outil !== 'baguette';
    if (!selectionne) { outilSelection.vider(); elementsSelection.trace.hidden = true; }
    if (outil !== 'mesure') outilMesure.annuler();
    else { majSpecimen(); outilMesure.surChangement?.(); }

    if (trace) {
      pinceau.efface = outil === 'gomme';
      pinceau.rayon = reglagesTrace[outil].taille / 2000;
      pinceau.durete = reglagesTrace[outil].durete;
    }

    // These tools need the left button; panning and zooming stay available so
    // the specimen can still be turned without leaving the tool.
    const trainee = trace || selectionne;
    scene3d.controls.mouseButtons.LEFT = trainee ? null : THREE.MOUSE.ROTATE;
    // Same bargain with a finger, and it has to be spelled out separately:
    // one finger draws, two fingers still turn and zoom the specimen. Without
    // this the brush and the orbit fight over every touch.
    scene3d.controls.touches.ONE = trainee ? null : THREE.TOUCH.ROTATE;
    scene3d.controls.touches.TWO = trainee ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;

    atelier.alignerCalqueSurOutil(outil);
    majCibles();
    barreOutils.rafraichirPanneau();
  },
});

const atelier = new Atelier({ panneauDroit, barreOutils });
panneauDroit.surSelectionCalque = (id) => {
  atelier.alignerOutilSurCalque(id);
  majCibles();
};

brancherPalette($('#epinglePalette'), 'epingle');
brancherPalette($('#pinceauPalette'), 'pinceau');
brancherPalette($('#mesurePalette'), 'mesure');
majCibles();

let departPointeur = null;
let sessionCourante = null;
// Every capture the project declares, loaded or not. The comparison read-out
// needs to know what exists, not only what is in memory, so it can say what is
// missing rather than silently comparing two captures out of three.
let sessionsConnues = [];
// The pointer that owns the gesture in progress. A tablet reports a palm
// resting on the screen as a second pointer; without this it would paint.
let pointeurActif = null;

const toile = scene3d.renderer.domElement;

// Capturing the pointer keeps a stroke alive when the finger wanders off the
// canvas. It can legitimately fail — the pointer may already be gone — and a
// throw here would abort the rest of the handler, leaving the atlas without
// its debuterTrait and the stroke without a live preview.
function capturer(pointerId) {
  try {
    toile.setPointerCapture(pointerId);
  } catch {
    /* le geste continue sans capture */
  }
}

toile.addEventListener('pointerdown', (evenement) => {
  departPointeur = { x: evenement.clientX, y: evenement.clientY, t: performance.now() };

  if (evenement.button !== 0) return;
  if (pointeurActif !== null) return;
  pointeurActif = evenement.pointerId;

  if (barreOutils.actif === 'baguette') {
    outilSelection.baguetteA(evenement.clientX, evenement.clientY, outilSelection.mode(evenement));
    return;
  }

  if (barreOutils.actif === 'lasso') {
    outilSelection.demarrerLasso(evenement.clientX, evenement.clientY);
    capturer(evenement.pointerId);
    elementsSelection.trace.hidden = false;
    return;
  }

  if (barreOutils.actif !== 'pinceau' && barreOutils.actif !== 'gomme') return;
  // An eraser can only target existing paint. It must never manufacture an
  // empty paint layer just because the first gesture in a document is erase.
  const cibleExistante = atelier.calqueUtilisable('peinture');
  if (barreOutils.actif === 'gomme' && !cibleExistante) return;
  if (!pinceau.demarrer(evenement.clientX, evenement.clientY)) return;
  const idCalque = cibleExistante?.id ?? atelier.calqueCourant();
  if (!idCalque) { pinceau.annuler(); return; }
  capturer(evenement.pointerId);
  atlas.debuterTrait(panneauDroit.doc, idCalque);
  pinceau.idCalque = idCalque;
});

let apercuLassoEnAttente = false;

// The free end of a measurement follows the pointer without any button down,
// so this one is outside the gesture guard below.
let mouvementMesureEnAttente = null;
let rafMouvementMesure = 0;
toile.addEventListener('pointermove', (evenement) => {
  if (barreOutils.actif !== 'mesure' || !outilMesure.enCours) return;
  if (evenement.pointerType === 'touch') return; // pas de survol au doigt
  mouvementMesureEnAttente = { x: evenement.clientX, y: evenement.clientY };
  if (rafMouvementMesure) return;
  rafMouvementMesure = requestAnimationFrame(() => {
    rafMouvementMesure = 0;
    const mouvement = mouvementMesureEnAttente;
    mouvementMesureEnAttente = null;
    if (mouvement && barreOutils.actif === 'mesure' && outilMesure.enCours) {
      outilMesure.deplacer(mouvement.x, mouvement.y);
    }
  });
});

toile.addEventListener('pointermove', (evenement) => {
  if (pointeurActif !== null && evenement.pointerId !== pointeurActif) return;
  if (outilSelection.trace) {
    if (!outilSelection.continuerLasso(evenement.clientX, evenement.clientY)) return;
    elementsSelection.ligne.setAttribute('points',
      outilSelection.trace.map((p) => `${p.x},${p.y}`).join(' '));

    // Live preview of what the lasso is about to take, recomputed at most once
    // per frame: without it the gesture is made blind and only judged after
    // the button is released.
    if (apercuLassoEnAttente) return;
    apercuLassoEnAttente = true;
    const mode = outilSelection.mode(evenement);
    requestAnimationFrame(() => {
      apercuLassoEnAttente = false;
      if (!outilSelection.trace) return;
      outilSelection.apercuLasso(scene3d.camera, toile.clientWidth, toile.clientHeight, mode);
    });
    return;
  }
  if (!pinceau.actif) return;
  pinceau.continuer(evenement.clientX, evenement.clientY);
  pinceau.pousser();
  scene3d.demanderRendu();
});

toile.addEventListener('pointerup', (evenement) => {
  if (pointeurActif !== null && evenement.pointerId !== pointeurActif) return;
  if (outilSelection.trace) {
    if (toile.hasPointerCapture(evenement.pointerId)) toile.releasePointerCapture(evenement.pointerId);
    elementsSelection.trace.hidden = true;
    elementsSelection.ligne.removeAttribute('points');
    outilSelection.terminerLasso(scene3d.camera, toile.clientWidth, toile.clientHeight,
      outilSelection.mode(evenement));
    return;
  }

  if (!pinceau.actif) return;
  if (toile.hasPointerCapture(evenement.pointerId)) toile.releasePointerCapture(evenement.pointerId);

  const idCalque = pinceau.idCalque;
  const trait = pinceau.terminer();
  // Always, not only when the stroke was empty: leaving the atlas in
  // stroke mode would freeze every later recomposition.
  // The document refresh below recomposes once with the committed stroke.
  // Replaying the old document here first only made the stroke disappear and
  // paid for a full atlas pass that was immediately discarded.
  atlas.terminerTrait(panneauDroit.doc, false);
  if (!trait) return;

  // One stroke, one undo entry — and a targeted command rather than a whole
  // document snapshot, because a paint layer is far too big to copy per dab.
  pile.executer({
    nom: trait.efface ? 'Coup de gomme' : 'Trait de pinceau',
    faire: () => {
      const calque = panneauDroit.doc.trouver(idCalque);
      if (calque?.donnees) calque.donnees.elements.push(trait);
    },
    defaire: () => {
      const calque = panneauDroit.doc.trouver(idCalque);
      if (calque?.donnees) {
        calque.donnees.elements = calque.donnees.elements.filter((t) => t.id !== trait.id);
      }
    },
  });
  panneauDroit.rafraichir();
  sauvegarde.planifier(panneauDroit.doc.serialiser());
});

toile.addEventListener('pointercancel', () => {
  if (!pinceau.actif) return;
  pinceau.annuler();
  recomposerPeinture();
});


// A click is a press that neither moved nor lingered; anything else was the
// user turning the specimen, and must not drop a pin or a measurement point.
toile.addEventListener('pointerup', (evenement) => {
  const depart = departPointeur;
  departPointeur = null;
  const outil = barreOutils.actif;
  if (outil !== 'naviguer' && outil !== 'epingle' && outil !== 'mesure') return;
  if (!depart || evenement.button !== 0) return;
  // A finger is less steady than a mouse and takes longer to lift.
  const tolerance = evenement.pointerType === 'touch' ? 12 : 5;
  if (Math.hypot(evenement.clientX - depart.x, evenement.clientY - depart.y) > tolerance) return;
  if (performance.now() - depart.t > 700) return;

  if (outil === 'mesure') {
    outilMesure.ajouterPoint(evenement.clientX, evenement.clientY);
    return;
  }
  if (outil !== 'epingle') {
    if (panneauDroit.fiche.ouverte) panneauDroit.fermerFiche();
    return;
  }
  poserEpingle(evenement.clientX, evenement.clientY);
});

// A double click closes the measurement, the way every polyline tool does.
toile.addEventListener('dblclick', () => {
  if (barreOutils.actif === 'mesure' && outilMesure.enCours) terminerMesure();
});

// Whatever the gesture was, the pointer that owned it is free again.
for (const nom of ['pointerup', 'pointercancel']) {
  toile.addEventListener(nom, (evenement) => {
    if (evenement.pointerId === pointeurActif) pointeurActif = null;
  });
}

function poserEpingle(x, y) {
  const touche = pointeur.surfaceSous(x, y);
  if (!touche) return;

  const idCalque = atelier.calqueCourant();
  const epingle = creerEpingle(touche.position, touche.normale, sessionCourante?.id ?? null);

  panneauDroit.muter('Poser une annotation', () => {
    const calque = panneauDroit.doc.trouver(idCalque);
    if (calque?.donnees) calque.donnees.elements.push(epingle);
  });
  panneauDroit.ouvrirFiche(epingle.id, idCalque);
}

// One eased flight, used by everything that moves the camera on purpose.
function allerVers(cible, arrivee, duree = 450) {
  const departCible = scene3d.controls.target.clone();
  const departCamera = scene3d.camera.position.clone();
  const debut = performance.now();

  const animer = () => {
    const part = Math.min((performance.now() - debut) / duree, 1);
    const douceur = part < 0.5 ? 2 * part * part : 1 - ((-2 * part + 2) ** 2) / 2;
    scene3d.controls.target.lerpVectors(departCible, cible, douceur);
    scene3d.camera.position.lerpVectors(departCamera, arrivee, douceur);
    scene3d.controls.update();
    if (part < 1) requestAnimationFrame(animer);
  };
  requestAnimationFrame(animer);
}

// Brings a pin into view: same distance, but looking at it from the direction
// its surface faces, so it is never left behind the specimen.
panneauDroit.surCentrage = (epingle) => {
  if (!epingle) return;
  const cible = new THREE.Vector3(...epingle.position);
  const normale = new THREE.Vector3(...epingle.normale);
  const distance = scene3d.camera.position.distanceTo(scene3d.controls.target);
  allerVers(cible, cible.clone().addScaledVector(normale, distance));
};

/* ------------------------------------------------------- vue d’observation */

// The conditions under which something was seen, recorded so a reader can be
// put back in them.
//
// A varnish loss that only shows at seventy degrees of raking light does not
// exist for a reader who arrives from an arbitrary orbit under flat ambient
// light — and « voir photo 4 » is the usual, poor substitute. The camera and
// the light disc are two vectors and four numbers; storing them turns
// « visible en lumière rasante » from a claim into something reproducible in
// one click. Nothing else in a condition report can do this.
function vueCourante() {
  return {
    camera: scene3d.camera.position.toArray(),
    cible: scene3d.controls.target.toArray(),
    lumiere: {
      mode: eclairage.mode,
      x: eclairage.x,
      y: eclairage.y,
      angle: eclairage.angle,
      ambiance: eclairage.ambiance,
      intensite: eclairage.cle.intensity,
    },
    // Which capture was on screen. The frame is shared, so the viewpoint is
    // valid on all three; this only records where the observation was made.
    session: sessionCourante?.id ?? null,
    prise: new Date().toISOString(),
  };
}

function restituerVue(vue) {
  if (!vue?.camera || !vue?.cible) return;

  const lumiere = vue.lumiere;
  if (lumiere) {
    definirModeLumiere(lumiere.mode === 'dirigee' ? 'dirigee' : 'fixe');
    if (Number.isFinite(lumiere.intensite)) {
      elements.lumiereForce.value = lumiere.intensite;
      elements.lumiereForceValeur.textContent = Number(lumiere.intensite).toFixed(2);
      eclairage.definirIntensite(lumiere.intensite);
    }
    if (Number.isFinite(lumiere.ambiance)) {
      elements.lumiereAmbiance.value = lumiere.ambiance;
      elements.lumiereAmbianceValeur.textContent = `${Math.round(lumiere.ambiance * 100)} %`;
      eclairage.definirAmbiance(lumiere.ambiance);
    }
    if (Number.isFinite(lumiere.x) && Number.isFinite(lumiere.y)) {
      // The disc is set without emitting, then the light is aimed once: letting
      // the widget emit would fire a second, identical change through the
      // renderer for nothing.
      disqueLumiere.definir(lumiere.x, lumiere.y);
      eclairage.definirDirection(lumiere.x, lumiere.y);
    }
  }

  allerVers(new THREE.Vector3(...vue.cible), new THREE.Vector3(...vue.camera), 620);
}

panneauDroit.surMemoriserVue = () => vueCourante();
panneauDroit.surRestituerVue = (vue) => restituerVue(vue);

// The published file is never written to from here: the draft lives in this
// browser only, and leaves it through the export button or not at all.
async function chargerAnnotations() {
  const [publie, brouillon] = await Promise.all([chargerPublie(), chargerBrouillon(ID_PROJET)]);

  const appliquer = (donnees) => {
    panneauDroit.definirDocument(DocumentAnnotation.deserialiser(donnees));
    pile.vider();
  };

  if (brouillon) {
    appliquer(brouillon.donnees);
    // The banner is for the one case where it matters: a draft that no longer
    // says the same thing as what is online.
    const diverge = publie
      && JSON.stringify(brouillon.donnees.racine) !== JSON.stringify(publie.racine);
    if (diverge) {
      panneauDroit.afficherBandeauBrouillon(brouillon, async () => {
        await supprimerBrouillon(ID_PROJET);
        appliquer(publie);
        panneauDroit.afficherBandeauBrouillon(null);
      });
    }
    return;
  }

  if (publie) appliquer(publie);
}

// Losing a draft to a closed tab would be unforgivable for something with no
// server behind it, so any pending save is flushed on the way out.
window.addEventListener('pagehide', () => sauvegarde.maintenant());

chargerAnnotations();

/* -------------------------------------------------------------- sessions */

function afficherStatut(texte) {
  elements.statut.textContent = texte;
  elements.statut.classList.toggle('visible', Boolean(texte));
}

// Captures are keyed by session id, falling back to the index for the single
// nameless model. Everything downstream — atlases, mesh analyses, caches —
// hangs off this key.
const cleCapture = (session, index) => session.id ?? `capture-${index}`;

async function obtenirCouche(session, index) {
  if (scene3d.couches[index]) return scene3d.couches[index];
  if (chargementsModeles.has(index)) return chargementsModeles.get(index);

  const chargement = (async () => {

    afficherStatut(`Chargement · ${session.label}…`);
    const { racine, boite } = await chargerModele(session.glb, (part) => {
      afficherStatut(`Chargement · ${session.label} · ${Math.round(part * 100)} %`);
    });

    appliquerMatiere(racine, {
      rugosite: Number(elements.reflet.value),
      metal: config.matiere.metal,
      opacite: Number(elements.opaciteModele.value),
      anisotropie,
    });
    modelesCharges.push(racine);
    // Each capture gets its own atlas, in its own UV space, and its own mesh
    // analysis. Registering both here rather than on display means switching
    // sessions never pays for the analysis twice.
    atlas.enregistrerCapture(cleCapture(session, index), racine, session.id ?? null);
    regions.enregistrer(cleCapture(session, index), racine, session.id ?? null);
    scene3d.definirCouche(index, racine);

    // All sessions share one coordinate frame, so the camera is framed once and
    // never touched again: switching sessions keeps the exact same viewpoint.
    if (!cadre) {
      scene3d.cadrer(boite);
      ombre.ajuster(boite);
      // The key light stands off by the specimen's own radius, so a capture at
      // any scale is lit the same way.
      eclairage.cadrer(boite);
      cadre = true;
    }

    afficherStatut('');
    return racine;
  })();

  chargementsModeles.set(index, chargement);
  try {
    return await chargement;
  } finally {
    chargementsModeles.delete(index);
  }
}

function marquerOnglet(bouton) {
  for (const onglet of elements.listeSessions.querySelectorAll('.session-tab')) {
    onglet.setAttribute('aria-pressed', String(onglet === bouton));
  }
}

let revisionVue = 0;

async function choisirSession(session, index, bouton) {
  const revision = ++revisionVue;
  marquerOnglet(bouton);
  try {
    await obtenirCouche(session, index);
  } catch (erreur) {
    console.error(erreur);
    afficherStatut('Impossible de charger ce modèle.');
    return;
  }
  if (revision !== revisionVue) return;
  scene3d.afficherCouche(index);
  ombre.visible = true;
  requestAnimationFrame(() => ombre.rafraichir());
  definirSourcesAR(session.glb, session.usdz);
  sessionCourante = session;
  // Each capture has its own UV atlas, so the paint has to be rasterised
  // again for this one — from the same 3D strokes, which is exactly why they
  // are stored as strokes rather than as pixels.
  definirCaptures([cleCapture(session, index)]);
  panneauDroit.definirSessionActive(session.id ?? null);
  coucheEpingles.definirSessionActive(session.id ?? null);
  elements.sousTitre.textContent = `${session.label} · ${session.date}, ${session.time}`;
}

// The captures on screen. The first is the reference: where the brush writes,
// what the selection tools analyse, and what the measurements are taken on.
function definirCaptures(cles) {
  atlas.definirActives(cles);
  regions.definirCourante(cles[0]);
  captureCourante = atlas.capture(cles[0]);
  outilSelection.vider();
  outilMesure.annuler();
  coucheMesures.invalider();
  recomposerPeinture();
  majSpecimen();
  // Only the inspector, not a full refresh: that would recompose the atlases a
  // second time for nothing. The figures it shows are per capture, so they do
  // have to be read again.
  panneauDroit.inspecteur.rendre();
}

async function choisirComposite(sessions, bouton) {
  const revision = ++revisionVue;
  marquerOnglet(bouton);
  try {
    await Promise.all(sessions.map((session, index) => obtenirCouche(session, index)));
  } catch (erreur) {
    console.error(erreur);
    afficherStatut('Impossible de charger toutes les sessions.');
    return;
  }
  if (revision !== revisionVue) return;
  scene3d.afficherComposite();
  // The old version set shadow-intensity to 0 on the stacked layers.
  ombre.visible = false;
  definirSourcesAR(sessions[0].glb, sessions[0].usdz);
  // Every capture is on screen at once, so no layer is out of scope.
  sessionCourante = null;
  panneauDroit.definirSessionActive(null);
  coucheEpingles.definirSessionActive(null);
  // All three atlases are recomposed, each in its own UV space. Painting and
  // measuring target the first, the frame all the others were aligned onto.
  definirCaptures(sessions.map((session, index) => cleCapture(session, index)));
  elements.sousTitre.textContent = `Les ${sessions.length} sessions superposées`;
}

async function chargerSessions() {
  let sessions;
  try {
    const reponse = await fetch('./sessions.json', { cache: 'no-store' });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    sessions = await reponse.json();
    if (!Array.isArray(sessions) || sessions.length === 0) throw new Error('Aucune session');
    sessionsConnues = sessions;
    panneauDroit.definirSessions(sessions);
  } catch (erreur) {
    console.error('sessions.json illisible, retour au modèle par défaut.', erreur);
    elements.listeSessions.hidden = true;
    elements.sousTitre.textContent = 'Modèle par défaut';
    const secours = { label: 'Modèle', glb: './model.glb', usdz: './model.usdz' };
    const bouton = document.createElement('button');
    await choisirSession(secours, 0, bouton);
    elements.sousTitre.textContent = 'Modèle par défaut';
    return;
  }

  sessions.forEach((session, index) => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'session-tab';
    bouton.setAttribute('aria-pressed', 'false');
    bouton.innerHTML = `${session.label}<span>${session.date} · ${session.time}</span>`;
    bouton.addEventListener('click', () => choisirSession(session, index, bouton));
    elements.listeSessions.appendChild(bouton);

    if (index === 0) choisirSession(session, index, bouton);
  });

  if (sessions.length > 1) {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'session-tab';
    bouton.setAttribute('aria-pressed', 'false');
    bouton.innerHTML = `Toutes les sessions<span>Superposition des ${sessions.length} captures</span>`;
    bouton.addEventListener('click', () => choisirComposite(sessions, bouton));
    elements.listeSessions.appendChild(bouton);
  }
}

chargerRecalage();
chargerSessions();

// Handy while comparing against the old viewer.
window.DURAIR = {
  scene3d, eclairage, ombre, config, THREE, pile, panneauDroit,
  coucheEpingles, barreOutils, pointeur, medias: bibliotheque, atlas, pinceau,
  regions, contours, outilSelection, creerRegion,
  metrologie, coucheMesures, outilMesure, terminerMesure,
  get captureCourante() { return captureCourante; },
  get pointeurActif() { return pointeurActif; },
  // Undo replaces the document object wholesale, so this has to be resolved
  // on each access rather than captured once.
  get document() { return panneauDroit.doc; },
};
