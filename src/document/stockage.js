// Persistence. The site is static and stays static: there is no server to save
// to, so work lives in the browser and leaves it only when explicitly exported.
//
// Two sources, deliberately kept apart:
//   • <objet>/annotations/annotations.json — the published document, read-only here.
//   • IndexedDB — the local draft, this browser only.
// A visitor's edits therefore never touch what is deployed. Only the export
// button produces a file, and only you decide to put it online.

import { objet } from '../objet.js';

const BASE = 'durair-annotations';
const MAGASIN = 'documents';
export const MAGASIN_MEDIAS = 'medias';
// Was a constant when the site served one specimen. Each object now carries
// its own published document, next to its own captures.

export function ouvrir() {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE, 2);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(MAGASIN)) db.createObjectStore(MAGASIN, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MAGASIN_MEDIAS)) {
        db.createObjectStore(MAGASIN_MEDIAS, { keyPath: 'id' });
      }
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

export function transaction(db, mode, action, magasin = MAGASIN) {
  return new Promise((resoudre, rejeter) => {
    const tx = db.transaction(magasin, mode);
    const requete = action(tx.objectStore(magasin));
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

export async function chargerBrouillon(idProjet) {
  try {
    const db = await ouvrir();
    const ligne = await transaction(db, 'readonly', (magasin) => magasin.get(idProjet));
    db.close();
    return ligne ?? null;
  } catch (erreur) {
    console.warn('Brouillon local illisible.', erreur);
    return null;
  }
}

export async function enregistrerBrouillon(idProjet, donnees) {
  try {
    const db = await ouvrir();
    await transaction(db, 'readwrite', (magasin) => magasin.put({
      id: idProjet,
      modifie: new Date().toISOString(),
      donnees,
    }));
    db.close();
    return true;
  } catch (erreur) {
    console.warn('Brouillon local non enregistré.', erreur);
    return false;
  }
}

export async function supprimerBrouillon(idProjet) {
  try {
    const db = await ouvrir();
    await transaction(db, 'readwrite', (magasin) => magasin.delete(idProjet));
    db.close();
  } catch (erreur) {
    console.warn('Brouillon local non supprimé.', erreur);
  }
}

// Absent file is the normal case before anything has been published.
export async function chargerPublie() {
  try {
    if (!objet.chemins.annotations) return null;
    const reponse = await fetch(objet.chemins.annotations, { cache: 'no-store' });
    if (!reponse.ok) return null;
    return await reponse.json();
  } catch {
    return null;
  }
}

// The link is put in the document and the URL is released on the next turn of
// the event loop, not on the line after the click. Revoking straight away is a
// race the browser loses on a large archive: it has the click but no longer has
// anything to read, and the download arrives empty or not at all.
export function telecharger(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  lien.rel = 'noopener';
  lien.style.display = 'none';
  document.body.appendChild(lien);
  lien.click();
  setTimeout(() => {
    lien.remove();
    URL.revokeObjectURL(url);
  }, 30_000);
}

export function exporter(donnees, nomFichier = 'annotations.json') {
  telecharger(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }), nomFichier);
}

// Waits for a pause in the editing before writing: dragging an opacity slider
// must not hammer IndexedDB.
export class SauvegardeDifferee {
  constructor(idProjet, delai = 800) {
    this.idProjet = idProjet;
    this.delai = delai;
    this.minuteur = null;
    this.enAttente = null;
  }

  planifier(donnees) {
    this.enAttente = donnees;
    clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => this.maintenant(), this.delai);
  }

  async maintenant() {
    clearTimeout(this.minuteur);
    if (!this.enAttente) return;
    const donnees = this.enAttente;
    this.enAttente = null;
    await enregistrerBrouillon(this.idProjet, donnees);
  }
}
