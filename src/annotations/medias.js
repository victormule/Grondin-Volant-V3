// Media library: images, sound and video attached to pins.
//
// Two lives for one file. While you work, it is a blob in IndexedDB — dropped
// in, available at once, never uploaded anywhere. On export it becomes a file
// under annotations/medias/, and the published document points at it by path.
// The site therefore reads published media with a plain URL and needs no
// archive reader at all: only the writer.

import { ouvrir, transaction, MAGASIN_MEDIAS } from '../document/stockage.js';

const LARGEUR_MAX = 1800;
const QUALITE = 0.85;

export function genreDepuisType(type) {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'son';
  if (type.startsWith('video/')) return 'video';
  return 'fichier';
}

function identifiant() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'm-' + Math.random().toString(36).slice(2, 11);
}

function extension(type, nom) {
  const point = nom.lastIndexOf('.');
  if (point > 0) return nom.slice(point + 1).toLowerCase();
  return (type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
}

// A capture straight off a phone is several thousand pixels wide, which is far
// more than an annotation card ever shows and would make the exported archive
// unusable. Anything else — sound, video — is passed through untouched.
async function reduireImage(fichier) {
  const image = new Image();
  const url = URL.createObjectURL(fichier);
  try {
    image.src = url;
    await image.decode();
    if (image.naturalWidth <= LARGEUR_MAX && fichier.size < 900_000) return null;

    const echelle = Math.min(1, LARGEUR_MAX / image.naturalWidth);
    const toile = document.createElement('canvas');
    toile.width = Math.round(image.naturalWidth * echelle);
    toile.height = Math.round(image.naturalHeight * echelle);
    toile.getContext('2d').drawImage(image, 0, 0, toile.width, toile.height);

    const blob = await new Promise((r) => toile.toBlob(r, 'image/webp', QUALITE));
    return blob && blob.size < fichier.size ? blob : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class BibliothequeMedias {
  constructor() {
    this.urls = new Map();
  }

  // Returns the descriptor to store in the document; the bytes stay here.
  async importer(fichier) {
    const genre = genreDepuisType(fichier.type);
    let donnees = fichier;

    if (genre === 'image') {
      const reduit = await reduireImage(fichier);
      if (reduit) donnees = reduit;
    }

    const media = {
      id: identifiant(),
      genre,
      nom: fichier.name,
      type: donnees.type || fichier.type,
      taille: donnees.size,
      chemin: null,
    };

    const db = await ouvrir();
    await transaction(db, 'readwrite',
      (magasin) => magasin.put({ id: media.id, blob: donnees }), MAGASIN_MEDIAS);
    db.close();

    this.urls.set(media.id, URL.createObjectURL(donnees));
    return media;
  }

  async blob(media) {
    if (media.chemin) {
      const reponse = await fetch(`./annotations/${media.chemin}`);
      if (!reponse.ok) throw new Error(`Média introuvable : ${media.chemin}`);
      return await reponse.blob();
    }
    const db = await ouvrir();
    const ligne = await transaction(db, 'readonly',
      (magasin) => magasin.get(media.id), MAGASIN_MEDIAS);
    db.close();
    if (!ligne) throw new Error(`Média absent du brouillon : ${media.id}`);
    return ligne.blob;
  }

  // Published media resolve to a plain path; local ones to an object URL,
  // cached so a card can be reopened without leaking a URL each time.
  async url(media) {
    if (media.chemin) return `./annotations/${media.chemin}`;
    if (this.urls.has(media.id)) return this.urls.get(media.id);
    try {
      const blob = await this.blob(media);
      const url = URL.createObjectURL(blob);
      this.urls.set(media.id, url);
      return url;
    } catch {
      return null;
    }
  }

  oublier(id) {
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  // Names files as medias/<id>.<ext> so the archive can never collide on two
  // photos both called IMG_0001.jpg.
  async pourExport(medias) {
    const fichiers = [];
    const table = new Map();
    for (const media of medias) {
      const chemin = media.chemin || `medias/${media.id}.${extension(media.type, media.nom)}`;
      table.set(media.id, chemin);
      if (media.chemin) continue;
      try {
        const blob = await this.blob(media);
        fichiers.push({ nom: chemin, donnees: new Uint8Array(await blob.arrayBuffer()) });
      } catch (erreur) {
        console.warn(`Média ignoré à l'export : ${media.nom}`, erreur);
        table.delete(media.id);
      }
    }
    return { fichiers, table };
  }
}
