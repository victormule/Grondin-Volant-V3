// Persistence. The site is static and stays static: there is no server to save
// to, so work lives in the browser and leaves it only when explicitly exported.
//
// Two sources, deliberately kept apart:
//   • annotations/annotations.json — the published document, read-only here.
//   • IndexedDB — the local draft, this browser only.
// A visitor's edits therefore never touch what is deployed. Only the export
// button produces a file, and only you decide to put it online.

const BASE = 'durair-annotations';
const MAGASIN = 'documents';
export const MAGASIN_MEDIAS = 'medias';
const CHEMIN_PUBLIE = './annotations/annotations.json';

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
    const reponse = await fetch(CHEMIN_PUBLIE, { cache: 'no-store' });
    if (!reponse.ok) return null;
    return await reponse.json();
  } catch {
    return null;
  }
}

export function telecharger(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  lien.click();
  URL.revokeObjectURL(url);
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
