// The card behind a pin: title, text, media, free properties.
//
// It slides over the layer list rather than squeezing into the inspector —
// a photo and a paragraph need the room, and covering the list is reversible
// where cramming is not.

import { rendreMarkdown } from './texte.js';
import { genreDepuisType } from '../annotations/medias.js';

export class Fiche {
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.doc = options.document;
    this.medias = options.medias;
    this.surMutation = options.surMutation;
    this.surFermeture = options.surFermeture;
    this.surCentrage = options.surCentrage;
    this.surSuppression = options.surSuppression;

    this.idCalque = null;
    this.idEpingle = null;
    this.editionTexte = false;
  }

  definirDocument(doc) {
    this.doc = doc;
    if (this.idEpingle) this.rendre();
  }

  ouvrir(idEpingle, idCalque) {
    this.idEpingle = idEpingle;
    this.idCalque = idCalque;
    this.editionTexte = false;
    this.conteneur.hidden = false;
    this.rendre();
  }

  fermer() {
    this.idEpingle = null;
    this.idCalque = null;
    this.conteneur.hidden = true;
  }

  get ouverte() {
    return Boolean(this.idEpingle);
  }

  // Resolved on every access: undo swaps the whole document, so a reference
  // captured earlier would point at a detached copy.
  _epingle() {
    const calque = this.idCalque && this.doc.trouver(this.idCalque);
    if (!calque?.donnees) return null;
    return calque.donnees.elements.find((e) => e.id === this.idEpingle) ?? null;
  }

  _muter(nom, mutation) {
    this.surMutation(nom, () => {
      const calque = this.doc.trouver(this.idCalque);
      const epingle = calque?.donnees?.elements.find((e) => e.id === this.idEpingle);
      if (epingle) mutation(epingle, calque);
    });
  }

  rendre() {
    const epingle = this._epingle();
    if (!epingle) { this.fermer(); return; }

    this.conteneur.replaceChildren();
    this.conteneur.append(
      this._entete(epingle),
      this._titre(epingle),
      this._texte(epingle),
      this._medias(epingle),
      this._proprietes(epingle),
      this._actions(),
    );
  }

  _entete() {
    const entete = document.createElement('div');
    entete.className = 'fiche-entete';

    const retour = document.createElement('button');
    retour.type = 'button';
    retour.className = 'fiche-retour';
    retour.textContent = '← Propriétés du calque';
    retour.addEventListener('click', () => this.surFermeture?.());

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Annotation';

    entete.append(retour, titre);
    return entete;
  }

  _titre(epingle) {
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'champ fiche-titre';
    champ.value = epingle.titre || '';
    champ.placeholder = 'Titre de l’annotation';
    champ.addEventListener('change', () => {
      const valeur = champ.value.trim();
      this._muter('Titre de l’annotation', (e) => { e.titre = valeur; });
    });
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') champ.blur();
    });
    return champ;
  }

  // Shows the rendered text; one click turns it into the editor. Editing in
  // place beats a permanent text area that nobody would want to read.
  _texte(epingle) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-texte';

    if (!this.editionTexte) {
      const rendu = document.createElement('div');
      rendu.className = 'fiche-rendu';
      const html = rendreMarkdown(epingle.texte);
      if (html) rendu.innerHTML = html;
      else rendu.innerHTML = '<p class="fiche-vide">Cliquez pour écrire… (Markdown accepté)</p>';
      rendu.addEventListener('click', (evenement) => {
        if (evenement.target.tagName === 'A') return;
        this.editionTexte = true;
        this.rendre();
        this.conteneur.querySelector('.fiche-zone')?.focus();
      });
      bloc.appendChild(rendu);
      return bloc;
    }

    const zone = document.createElement('textarea');
    zone.className = 'champ fiche-zone';
    zone.rows = 7;
    zone.value = epingle.texte || '';
    zone.placeholder = '## Titre\n\nTexte, **gras**, *italique*, - listes, [liens](https://…)';
    zone.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') zone.blur();
    });
    zone.addEventListener('blur', () => {
      const valeur = zone.value;
      this.editionTexte = false;
      const epingleCourante = this._epingle();
      if (epingleCourante && valeur !== (epingleCourante.texte || '')) {
        this._muter('Texte de l’annotation', (e) => { e.texte = valeur; });
      } else {
        this.rendre();
      }
    });
    bloc.appendChild(zone);
    return bloc;
  }

  _medias(epingle) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-medias';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Médias';
    bloc.appendChild(titre);

    const grille = document.createElement('div');
    grille.className = 'medias-grille';
    bloc.appendChild(grille);

    for (const id of epingle.medias || []) {
      const media = this.doc.medias.find((m) => m.id === id);
      if (!media) continue;
      grille.appendChild(this._media(media));
    }

    const depot = document.createElement('label');
    depot.className = 'medias-depot';
    depot.textContent = 'Glissez une image, un son ou une vidéo — ou cliquez';

    const champ = document.createElement('input');
    champ.type = 'file';
    champ.accept = 'image/*,audio/*,video/*';
    champ.multiple = true;
    champ.hidden = true;
    champ.addEventListener('change', () => {
      this._ajouterFichiers([...champ.files]);
      champ.value = '';
    });
    depot.appendChild(champ);

    depot.addEventListener('dragover', (e) => { e.preventDefault(); depot.classList.add('survol'); });
    depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
    depot.addEventListener('drop', (e) => {
      e.preventDefault();
      depot.classList.remove('survol');
      this._ajouterFichiers([...e.dataTransfer.files]);
    });

    bloc.appendChild(depot);
    return bloc;
  }

  _media(media) {
    const carte = document.createElement('div');
    carte.className = 'media-carte';

    const zone = document.createElement('div');
    zone.className = 'media-apercu';
    carte.appendChild(zone);

    this.medias.url(media).then((url) => {
      if (!url) { zone.textContent = 'introuvable'; zone.classList.add('media-absent'); return; }
      if (media.genre === 'image') {
        const image = document.createElement('img');
        image.src = url;
        image.alt = media.nom;
        image.loading = 'lazy';
        zone.appendChild(image);
      } else if (media.genre === 'son') {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = url;
        zone.appendChild(audio);
      } else if (media.genre === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.src = url;
        video.preload = 'metadata';
        zone.appendChild(video);
      } else {
        const lien = document.createElement('a');
        lien.href = url;
        lien.download = media.nom;
        lien.textContent = media.nom;
        zone.appendChild(lien);
      }
    });

    const pied = document.createElement('div');
    pied.className = 'media-pied';
    const nom = document.createElement('span');
    nom.textContent = media.nom;
    nom.title = `${media.nom} · ${Math.round(media.taille / 1024)} ko`;
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'media-retirer';
    retirer.textContent = '×';
    retirer.title = 'Retirer de cette annotation';
    retirer.addEventListener('click', () => this._retirerMedia(media.id));
    pied.append(nom, retirer);
    carte.appendChild(pied);

    return carte;
  }

  async _ajouterFichiers(fichiers) {
    const acceptes = fichiers.filter((f) => ['image', 'son', 'video'].includes(genreDepuisType(f.type)));
    if (acceptes.length === 0) return;

    const descripteurs = [];
    for (const fichier of acceptes) {
      try {
        descripteurs.push(await this.medias.importer(fichier));
      } catch (erreur) {
        console.error(`Import impossible : ${fichier.name}`, erreur);
      }
    }
    if (descripteurs.length === 0) return;

    this._muter(descripteurs.length > 1 ? 'Ajouter des médias' : 'Ajouter un média', (epingle) => {
      this.doc.medias.push(...descripteurs);
      epingle.medias = [...(epingle.medias || []), ...descripteurs.map((d) => d.id)];
    });
  }

  // Removed from the card, and from the document when no other card uses it.
  _retirerMedia(id) {
    this._muter('Retirer le média', (epingle) => {
      epingle.medias = (epingle.medias || []).filter((m) => m !== id);
      const encoreUtilise = this.doc.aplatir().some(({ calque }) => calque.donnees?.elements
        ?.some((e) => (e.medias || []).includes(id)));
      if (!encoreUtilise) this.doc.medias = this.doc.medias.filter((m) => m.id !== id);
    });
  }

  _proprietes(epingle) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-proprietes';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Propriétés';
    bloc.appendChild(titre);

    (epingle.proprietes || []).forEach((propriete, index) => {
      const ligne = document.createElement('div');
      ligne.className = 'propriete';

      const cle = document.createElement('input');
      cle.className = 'champ';
      cle.value = propriete.cle;
      cle.placeholder = 'Nom';
      cle.addEventListener('change', () => this._muter('Propriété',
        (e) => { e.proprietes[index].cle = cle.value; }));

      const valeur = document.createElement('input');
      valeur.className = 'champ';
      valeur.value = propriete.valeur;
      valeur.placeholder = 'Valeur';
      valeur.addEventListener('change', () => this._muter('Propriété',
        (e) => { e.proprietes[index].valeur = valeur.value; }));

      for (const champ of [cle, valeur]) champ.addEventListener('keydown', (e) => e.stopPropagation());

      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'media-retirer';
      retirer.textContent = '×';
      retirer.title = 'Supprimer la propriété';
      retirer.addEventListener('click', () => this._muter('Supprimer la propriété',
        (e) => { e.proprietes.splice(index, 1); }));

      ligne.append(cle, valeur, retirer);
      bloc.appendChild(ligne);
    });

    const ajouter = document.createElement('button');
    ajouter.type = 'button';
    ajouter.className = 'fiche-ajout';
    ajouter.textContent = '+ Propriété';
    ajouter.addEventListener('click', () => this._muter('Ajouter une propriété', (e) => {
      e.proprietes = [...(e.proprietes || []), { cle: '', valeur: '' }];
    }));
    bloc.appendChild(ajouter);

    return bloc;
  }

  _actions() {
    const barre = document.createElement('div');
    barre.className = 'barre-calques fiche-actions';

    const centrer = document.createElement('button');
    centrer.type = 'button';
    centrer.textContent = 'Centrer la vue';
    centrer.addEventListener('click', () => this.surCentrage?.(this._epingle()));

    const supprimer = document.createElement('button');
    supprimer.type = 'button';
    supprimer.className = 'action-dangereuse';
    supprimer.textContent = 'Supprimer';
    supprimer.addEventListener('click', () => this.surSuppression?.(this.idEpingle, this.idCalque));

    barre.append(centrer, supprimer);
    return barre;
  }
}
