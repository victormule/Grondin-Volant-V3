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

  // An unknown or absent ?objet= falls back to the first entry rather than
  // failing: a bare URL is the normal way in, and a stale bookmark should land
  // somewhere rather than nowhere.
  const demande = new URL(location.href).searchParams.get('objet');
  const entree = catalogue.find((o) => o.id === demande) ?? catalogue[0];

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
  document.title = `${nom} — Visualisation 3D`;
  const titre = document.getElementById('projectTitle');
  if (titre) titre.textContent = nom;

  await import('./app.js');
} catch (erreur) {
  echouer(`Objet introuvable. ${erreur.message}`, erreur);
}
