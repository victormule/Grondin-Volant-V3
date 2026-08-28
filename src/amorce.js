// Start-up. Resolves which object is open, loads its manifest, and only then
// lets the application run.
//
// WHY A SEPARATE ENTRY POINT. reglages.js computes `config` as it is imported,
// and app.js reads that config at module scope in seventeen places — the light
// sliders, the background palette, the measurement scale are all wired up
// while app.js is still being evaluated. A manifest arrives over `fetch`,
// which is asynchronous. The only way to be certain the settings are in place
// before any of that runs is to await them here and import app.js afterwards,
// dynamically. The module registry hands every other module the same `config`
// and `objet` instances this file has already filled.
//
// Nothing else in the application knows a path. It asks `objet` instead.

import { config, appliquer } from './reglages.js';
import { definirObjet, definirCatalogue } from './objet.js';
import { afficherAccueil } from './ui/accueil.js';

// A blank page with an error in the console is the worst way to fail: the
// person looking at it has no idea whether the site is broken or still
// loading. Say it on screen, in the element the viewer already uses.
function echouer(message, erreur) {
  console.error(message, erreur);
  const statut = document.getElementById('viewerStatus');
  if (statut) {
    statut.textContent = message;
    statut.classList.add('visible');
  }
  const sousTitre = document.getElementById('projectSubtitle');
  if (sousTitre) sousTitre.textContent = 'Chargement impossible';
}

// TROIS CENT MILLE OCTETS DE three.js, DEMANDÉS DEUX ALLERS-RETOURS PLUS TÔT.
//
// app.js importe three à sa première ligne, mais app.js n'est lui-même importé
// qu'une fois le manifeste lu : le navigateur ne découvre donc la plus grosse
// ressource de la page qu'après le catalogue ET le manifeste. Ces liens la font
// chercher pendant que le manifeste voyage. Rien n'est exécuté — modulepreload
// télécharge et analyse, l'ordre d'évaluation reste celui des imports — et un
// navigateur qui ne connaît pas ce type de lien l'ignore sans dommage.
//
// Appelé seulement quand un objet est demandé. La page d'accueil n'a pas de 3D,
// et lui faire télécharger three.js serait lui faire payer une bibliothèque
// qu'elle n'ouvre pas.
function prechargerLeVisualiseur() {
  // L'adresse de three vient de la carte d'import, elle n'est pas recopiée :
  // deux adresses à tenir d'accord finissent par diverger.
  let three = null;
  try {
    const carte = document.querySelector('script[type="importmap"]');
    three = JSON.parse(carte?.textContent ?? '{}').imports?.three ?? null;
  } catch (erreur) {
    console.warn('Carte d’import illisible : préchargement ignoré.', erreur);
  }
  for (const adresse of [three, './app.js']) {
    if (!adresse) continue;
    const lien = document.createElement('link');
    lien.rel = 'modulepreload';
    lien.href = adresse;
    if (/^https?:/.test(adresse)) lien.crossOrigin = 'anonymous';
    document.head.appendChild(lien);
  }
}

async function lire(chemin, quoi) {
  const reponse = await fetch(chemin, { cache: 'no-store' });
  if (!reponse.ok) throw new Error(`${quoi} : HTTP ${reponse.status} sur ${chemin}`);
  return reponse.json();
}

try {
  const catalogue = await lire('./objets/catalogue.json', 'Catalogue illisible');
  if (!Array.isArray(catalogue) || catalogue.length === 0) {
    throw new Error('Le catalogue ne déclare aucun objet.');
  }
  definirCatalogue(catalogue);

  // NO OBJECT ASKED FOR MEANS THE CATALOGUE, not a default object.
  //
  // Landing straight inside one of them made the others hard to discover: you
  // had to work out that a catalogue existed before you could reach it. The
  // bare URL now shows what there is. Nothing 3D is loaded here — the home
  // page is text and a few JPEGs, and app.js (with three.js behind it) is only
  // imported once an object is known.
  //
  // An unknown id falls back to the catalogue too: a stale bookmark should land
  // somewhere that makes sense rather than on someone else's object.
  const demande = new URL(location.href).searchParams.get('objet');
  const entree = catalogue.find((o) => o.id === demande);
  if (!entree) {
    afficherAccueil(document.getElementById('accueil'), catalogue);
    document.title = 'Art’Scanner';
  } else {

    prechargerLeVisualiseur();
    const manifeste = await lire(`./objets/${entree.id}/objet.json`, 'Manifeste illisible');
    definirObjet(entree.id, manifeste);
    appliquer(manifeste.reglages);

    // The residuals file is named by the manifest; the measurement panel reads
    // it through config, as it always has.
    config.mesure.recalage = manifeste.recalage
      ? `./objets/${entree.id}/${manifeste.recalage}`
      : null;

    // Set before app.js runs so the page never flashes another object's name.
    // app.js replaces the heading later if the document's own project sheet
    // carries a title — the manifest name is the fallback, not the authority.
    const nom = manifeste.nom ?? entree.nom ?? entree.id;
    document.title = `${nom} — Art’Scanner`;
    const titre = document.getElementById('projectTitle');
    if (titre) titre.textContent = nom;

    await import('./app.js');
  }
} catch (erreur) {
  echouer(`Objet introuvable. ${erreur.message}`, erreur);
}
