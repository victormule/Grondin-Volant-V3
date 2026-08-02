// The card: what is said about something, and on what grounds.
//
// It slides over the layer list rather than squeezing into the inspector —
// a photo and a paragraph need the room, and covering the list is reversible
// where cramming is not.
//
// One card serves two subjects, because they are the same kind of statement
// written about two different things:
//
//   • a pin   — a point on the specimen, with a title of its own;
//   • a layer — the entity itself. « Perte de vernis » is not a pin and not a
//     paint stroke: it is the thing both of them are about. Before layers could
//     carry a card, describing one meant creating a paint layer AND an
//     annotation layer with the same name, and hoping the reader would connect
//     them. The group was already the entity; it just had no right to speak.

import { rendreMarkdown } from './texte.js';
import { genreDepuisType } from '../annotations/medias.js';
import {
  NATURES, CONFIANCES, METHODES, TYPES_CALQUE, creerFiche, normaliserFiche,
} from '../document/modele.js';

export class Fiche {
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.doc = options.document;
    this.medias = options.medias;
    this.surMutation = options.surMutation;
    this.surFermeture = options.surFermeture;
    this.surCentrage = options.surCentrage;
    this.surSuppression = options.surSuppression;
    // Set by the application: the current viewpoint and lighting, and how to
    // go back to one. The card knows what a view is worth, not how to take it.
    this.surMemoriserVue = options.surMemoriserVue;
    this.surRestituerVue = options.surRestituerVue;

    this.idCalque = null;
    this.idEpingle = null;
    this.editionTexte = false;
  }

  definirDocument(doc) {
    this.doc = doc;
    if (this.ouverte) this.rendre();
  }

  ouvrir(idEpingle, idCalque) {
    this.idEpingle = idEpingle;
    this.idCalque = idCalque;
    this.editionTexte = false;
    this.conteneur.hidden = false;
    this.rendre();
  }

  // The layer itself as the subject. No pin id: that absence is what the rest
  // of the class reads to know which of the two it is showing.
  ouvrirCalque(idCalque) {
    this.idEpingle = null;
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
    return Boolean(this.idCalque);
  }

  // Which of the two subjects is on screen. A pin always carries its layer id
  // too, so the absence of a pin id is what tells them apart.
  get surCalque() {
    return Boolean(this.idCalque && !this.idEpingle);
  }

  /* ------------------------------------------------------------- le sujet */

  // Resolved on every access: undo swaps the whole document, so a reference
  // captured earlier would point at a detached copy.
  _sujet() {
    const calque = this.idCalque && this.doc.trouver(this.idCalque);
    if (!calque) return null;
    if (this.surCalque) return normaliserFiche(calque.fiche) ?? creerFiche();
    if (!calque.donnees) return null;
    const epingle = calque.donnees.elements.find((e) => e.id === this.idEpingle);
    return epingle ? normaliserFiche(epingle) : null;
  }

  // Mutations are applied to the live object inside the document, never to the
  // normalised copy `_sujet` hands out for reading. A layer that had no card
  // gets one here, on its first edit — an empty card is never written by the
  // mere act of looking.
  _muter(nom, mutation) {
    this.surMutation(nom, () => {
      const calque = this.doc.trouver(this.idCalque);
      if (!calque) return;
      let cible;
      if (this.surCalque) {
        calque.fiche = normaliserFiche(calque.fiche) ?? creerFiche();
        cible = calque.fiche;
      } else {
        cible = calque.donnees?.elements.find((e) => e.id === this.idEpingle);
      }
      if (!cible) return;
      mutation(cible, calque);
      cible.modifie = new Date().toISOString();
    });
  }

  rendre() {
    const sujet = this._sujet();
    if (!sujet) { this.fermer(); return; }
    const calque = this.doc.trouver(this.idCalque);

    this.conteneur.replaceChildren();
    this.conteneur.append(
      this._entete(calque),
      this._titre(sujet, calque),
      this._qualification(sujet),
      this._conditions(sujet),
      this._texte(sujet),
      this._vue(sujet),
      this._medias(sujet),
      this._proprietes(sujet),
      this._signature(sujet),
      this._actions(),
    );
  }

  _entete(calque) {
    const entete = document.createElement('div');
    entete.className = 'fiche-entete';

    const retour = document.createElement('button');
    retour.type = 'button';
    retour.className = 'fiche-retour';
    retour.textContent = '← Propriétés du calque';
    retour.addEventListener('click', () => this.surFermeture?.());

    const titre = document.createElement('span');
    titre.className = 'group-title';
    if (this.surCalque) {
      const modele = TYPES_CALQUE[calque?.type] ?? TYPES_CALQUE.annotation;
      titre.textContent = calque?.type === 'groupe' ? 'Entité' : `Fiche · ${modele.libelle}`;
    } else {
      titre.textContent = 'Annotation';
    }

    entete.append(retour, titre);
    return entete;
  }

  // A pin owns its title. A layer is titled by its name in the panel, and
  // having two editable titles for one thing would be a trap: the card would
  // say one name and the layer row another.
  _titre(sujet, calque) {
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'champ fiche-titre';
    if (this.surCalque) {
      champ.value = calque?.nom ?? '';
      champ.placeholder = 'Nom de l’entité';
      champ.addEventListener('change', () => {
        const valeur = champ.value.trim();
        if (!valeur) { champ.value = calque?.nom ?? ''; return; }
        this.surMutation('Renommer', () => {
          const courant = this.doc.trouver(this.idCalque);
          if (courant) courant.nom = valeur;
        });
      });
    } else {
      champ.value = sujet.titre || '';
      champ.placeholder = 'Titre de l’annotation';
      champ.addEventListener('change', () => {
        const valeur = champ.value.trim();
        this._muter('Titre de l’annotation', (e) => { e.titre = valeur; });
      });
    }
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') champ.blur();
    });
    return champ;
  }

  /* ------------------------------------------------------- qualification */

  // What kind of statement this is, and how firmly it is made. Two controls,
  // and the whole difference between a description and an examination.
  _qualification(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-qualification';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Nature de l’énoncé';
    bloc.appendChild(titre);

    const choix = document.createElement('div');
    choix.className = 'fiche-natures';
    for (const [cle, { libelle, aide }] of Object.entries(NATURES)) {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'fiche-nature';
      bouton.dataset.nature = cle;
      bouton.textContent = libelle;
      bouton.title = aide;
      bouton.setAttribute('aria-pressed', String(sujet.nature === cle));
      bouton.addEventListener('click', () => {
        if (sujet.nature === cle) return;
        this._muter('Nature de l’énoncé', (e) => { e.nature = cle; });
      });
      choix.appendChild(bouton);
    }
    bloc.appendChild(choix);

    const note = document.createElement('p');
    note.className = 'reglages-note';
    note.textContent = NATURES[sujet.nature]?.aide ?? '';
    bloc.appendChild(note);

    const ligne = document.createElement('label');
    ligne.className = 'fiche-champ-ligne';
    ligne.append(Object.assign(document.createElement('span'), { textContent: 'Confiance' }));
    const liste = document.createElement('select');
    liste.className = 'champ';
    for (const [cle, { libelle }] of Object.entries(CONFIANCES)) {
      const option = document.createElement('option');
      option.value = cle;
      option.textContent = libelle;
      option.selected = sujet.confiance === cle;
      liste.appendChild(option);
    }
    liste.addEventListener('change', () => {
      const valeur = liste.value;
      this._muter('Confiance', (e) => { e.confiance = valeur; });
    });
    ligne.appendChild(liste);
    bloc.appendChild(ligne);

    return bloc;
  }

  // Under what conditions, and by whom. Suggestions, not a closed list: a
  // vocabulary that refuses an unforeseen method just gets bypassed into the
  // free text, where nothing can find it again.
  _conditions(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-conditions';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Conditions d’examen';
    bloc.appendChild(titre);

    const idListe = 'fiche-methodes';
    if (!document.getElementById(idListe)) {
      const datalist = document.createElement('datalist');
      datalist.id = idListe;
      for (const methode of METHODES) {
        datalist.appendChild(Object.assign(document.createElement('option'), { value: methode }));
      }
      document.body.appendChild(datalist);
    }

    bloc.appendChild(this._champLigne('Méthode', sujet.methode, 'Lumière rasante, UV, loupe…',
      (valeur) => this._muter('Méthode d’examen', (e) => { e.methode = valeur; }), idListe));
    bloc.appendChild(this._champLigne('Auteur', sujet.auteur, 'Qui a fait ce constat',
      (valeur) => this._muter('Auteur', (e) => { e.auteur = valeur; })));

    return bloc;
  }

  _champLigne(etiquette, valeur, indice, surValidation, idListe = null) {
    const ligne = document.createElement('label');
    ligne.className = 'fiche-champ-ligne';
    ligne.append(Object.assign(document.createElement('span'), { textContent: etiquette }));
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'champ';
    champ.value = valeur || '';
    champ.placeholder = indice;
    if (idListe) champ.setAttribute('list', idListe);
    champ.addEventListener('change', () => surValidation(champ.value.trim()));
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') champ.blur();
    });
    ligne.appendChild(champ);
    return ligne;
  }

  /* ---------------------------------------------------------------- texte */

  // Shows the rendered text; one click turns it into the editor. Editing in
  // place beats a permanent text area that nobody would want to read.
  _texte(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-texte';

    if (!this.editionTexte) {
      const rendu = document.createElement('div');
      rendu.className = 'fiche-rendu';
      const html = rendreMarkdown(sujet.texte);
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
    zone.value = sujet.texte || '';
    zone.placeholder = '## Titre\n\nTexte, **gras**, *italique*, - listes, [liens](https://…)';
    zone.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') zone.blur();
    });
    zone.addEventListener('blur', () => {
      const valeur = zone.value;
      this.editionTexte = false;
      const courant = this._sujet();
      if (courant && valeur !== (courant.texte || '')) {
        this._muter('Texte de l’annotation', (e) => { e.texte = valeur; });
      } else {
        this.rendre();
      }
    });
    bloc.appendChild(zone);
    return bloc;
  }

  /* ------------------------------------------------------------- la vue */

  // The viewpoint and the lighting under which the observation was made.
  //
  // This is the one thing a 3D condition report can do that a photograph and a
  // paragraph cannot: a varnish loss that only exists under raking light at a
  // particular angle is invisible to a reader who arrives from a random orbit,
  // and « see photo 4 » is the usual, poor substitute. Storing the camera and
  // the light disc position turns « visible en lumière rasante » from a claim
  // into something the reader reproduces in one click.
  _vue(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-vue';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Vue d’observation';
    bloc.appendChild(titre);

    if (sujet.vue) {
      const resume = document.createElement('p');
      resume.className = 'reglages-note';
      const lumiere = sujet.vue.lumiere;
      resume.textContent = lumiere?.mode === 'dirigee'
        ? `Lumière dirigée, ${Math.round(lumiere.angle ?? 0)}° d’incidence.`
        : 'Éclairage d’ambiance neutre.';
      bloc.appendChild(resume);
    } else {
      const vide = document.createElement('p');
      vide.className = 'reglages-note';
      vide.textContent = 'Aucune vue mémorisée. Placez le spécimen et la lumière '
        + 'comme au moment de l’observation, puis mémorisez-les.';
      bloc.appendChild(vide);
    }

    const barre = document.createElement('div');
    barre.className = 'fiche-vue-actions';

    const memoriser = document.createElement('button');
    memoriser.type = 'button';
    memoriser.className = 'inspecteur-action';
    memoriser.textContent = sujet.vue ? 'Remplacer par la vue actuelle' : 'Mémoriser la vue actuelle';
    memoriser.addEventListener('click', () => {
      const vue = this.surMemoriserVue?.();
      if (!vue) return;
      this._muter('Mémoriser la vue', (e) => { e.vue = vue; });
    });
    barre.appendChild(memoriser);

    if (sujet.vue) {
      const restituer = document.createElement('button');
      restituer.type = 'button';
      restituer.className = 'inspecteur-action';
      restituer.textContent = 'Restituer';
      restituer.addEventListener('click', () => this.surRestituerVue?.(sujet.vue));
      barre.appendChild(restituer);

      const oublier = document.createElement('button');
      oublier.type = 'button';
      oublier.className = 'media-retirer';
      oublier.textContent = '×';
      oublier.title = 'Oublier cette vue';
      oublier.addEventListener('click', () => this._muter('Oublier la vue', (e) => { e.vue = null; }));
      barre.appendChild(oublier);
    }

    bloc.appendChild(barre);
    return bloc;
  }

  /* --------------------------------------------------------------- médias */

  _medias(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-medias';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Médias';
    bloc.appendChild(titre);

    const grille = document.createElement('div');
    grille.className = 'medias-grille';
    bloc.appendChild(grille);

    for (const id of sujet.medias || []) {
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
    retirer.title = 'Retirer de cette fiche';
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

    this._muter(descripteurs.length > 1 ? 'Ajouter des médias' : 'Ajouter un média', (sujet) => {
      this.doc.medias.push(...descripteurs);
      sujet.medias = [...(sujet.medias || []), ...descripteurs.map((d) => d.id)];
    });
  }

  // Removed from the card, and from the document when nothing else uses it —
  // which now means scanning layer cards as well as pins.
  _retirerMedia(id) {
    this._muter('Retirer le média', (sujet) => {
      sujet.medias = (sujet.medias || []).filter((m) => m !== id);
      const encoreUtilise = this.doc.aplatir().some(({ calque }) => (
        (calque.fiche?.medias || []).includes(id)
        || calque.donnees?.elements?.some((e) => (e.medias || []).includes(id))
      ));
      if (!encoreUtilise) this.doc.medias = this.doc.medias.filter((m) => m.id !== id);
    });
  }

  /* ----------------------------------------------------------- propriétés */

  // Key, value and unit rather than key and value. « 12 » and « 12 mm » are not
  // comparable as strings, and a column that mixes them cannot be summed,
  // sorted or converted — which is the whole reason for having the field.
  _proprietes(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-proprietes';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Propriétés';
    bloc.appendChild(titre);

    const vocabulaire = this.doc.vocabulaireProprietes();
    const idListe = 'fiche-cles-proprietes';
    let datalist = document.getElementById(idListe);
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = idListe;
      document.body.appendChild(datalist);
    }
    datalist.replaceChildren(...[...vocabulaire.keys()].map(
      (cle) => Object.assign(document.createElement('option'), { value: cle }),
    ));

    (sujet.proprietes || []).forEach((propriete, index) => {
      const ligne = document.createElement('div');
      ligne.className = 'propriete';

      const cle = document.createElement('input');
      cle.className = 'champ';
      cle.value = propriete.cle ?? '';
      cle.placeholder = 'Nom';
      cle.setAttribute('list', idListe);
      cle.addEventListener('change', () => {
        const nom = cle.value;
        // Reusing a name that already carries a unit elsewhere adopts it, so
        // the same quantity is not half recorded in mm and half in cm.
        const unite = vocabulaire.get(nom.trim());
        this._muter('Propriété', (e) => {
          e.proprietes[index].cle = nom;
          if (unite && !e.proprietes[index].unite) e.proprietes[index].unite = unite;
        });
      });

      const valeur = document.createElement('input');
      valeur.className = 'champ propriete-valeur';
      valeur.value = propriete.valeur ?? '';
      valeur.placeholder = 'Valeur';
      valeur.addEventListener('change', () => this._muter('Propriété',
        (e) => { e.proprietes[index].valeur = valeur.value; }));

      const unite = document.createElement('input');
      unite.className = 'champ propriete-unite';
      unite.value = propriete.unite ?? '';
      unite.placeholder = 'Unité';
      unite.title = 'mm, g, %, … — laissez vide pour une valeur non numérique';
      unite.addEventListener('change', () => this._muter('Propriété',
        (e) => { e.proprietes[index].unite = unite.value.trim(); }));

      for (const champ of [cle, valeur, unite]) {
        champ.addEventListener('keydown', (e) => e.stopPropagation());
      }

      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'media-retirer';
      retirer.textContent = '×';
      retirer.title = 'Supprimer la propriété';
      retirer.addEventListener('click', () => this._muter('Supprimer la propriété',
        (e) => { e.proprietes.splice(index, 1); }));

      ligne.append(cle, valeur, unite, retirer);
      bloc.appendChild(ligne);
    });

    const ajouter = document.createElement('button');
    ajouter.type = 'button';
    ajouter.className = 'fiche-ajout';
    ajouter.textContent = '+ Propriété';
    ajouter.addEventListener('click', () => this._muter('Ajouter une propriété', (e) => {
      e.proprietes = [...(e.proprietes || []), { cle: '', valeur: '', unite: '' }];
    }));
    bloc.appendChild(ajouter);

    return bloc;
  }

  /* -------------------------------------------------------------- traces */

  // Who wrote it and when it last changed. Small, and the difference between a
  // note and a record.
  _signature(sujet) {
    const bloc = document.createElement('p');
    bloc.className = 'fiche-signature';
    const quand = (valeur) => (valeur
      ? new Date(valeur).toLocaleString('fr-FR',
        { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null);
    const morceaux = [];
    if (sujet.auteur?.trim()) morceaux.push(sujet.auteur.trim());
    const cree = quand(sujet.cree);
    if (cree) morceaux.push(`créée le ${cree}`);
    const modifie = quand(sujet.modifie);
    if (modifie && modifie !== cree) morceaux.push(`modifiée le ${modifie}`);
    bloc.textContent = morceaux.join(' · ');
    return bloc;
  }

  _actions() {
    const barre = document.createElement('div');
    barre.className = 'barre-calques fiche-actions';

    if (!this.surCalque) {
      const centrer = document.createElement('button');
      centrer.type = 'button';
      centrer.textContent = 'Centrer la vue';
      centrer.addEventListener('click', () => this.surCentrage?.(this._epingleBrute()));
      barre.appendChild(centrer);

      const supprimer = document.createElement('button');
      supprimer.type = 'button';
      supprimer.className = 'action-dangereuse';
      supprimer.textContent = 'Supprimer';
      supprimer.addEventListener('click', () => this.surSuppression?.(this.idEpingle, this.idCalque));
      barre.appendChild(supprimer);
      return barre;
    }

    // Removing a layer's card must not remove the layer: the paint, the region
    // and the measurements underneath are the expensive part.
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'action-dangereuse';
    retirer.textContent = 'Retirer la fiche';
    retirer.title = 'Supprime la description, jamais le calque ni son contenu';
    retirer.addEventListener('click', () => {
      if (!window.confirm('Retirer la fiche de ce calque ? Le calque et son contenu sont conservés.')) return;
      this.surMutation('Retirer la fiche', () => {
        const calque = this.doc.trouver(this.idCalque);
        if (calque) calque.fiche = null;
      });
      this.surFermeture?.();
    });
    barre.appendChild(retirer);
    return barre;
  }

  // The live pin, for the caller that needs its coordinates rather than its text.
  _epingleBrute() {
    const calque = this.idCalque && this.doc.trouver(this.idCalque);
    return calque?.donnees?.elements.find((e) => e.id === this.idEpingle) ?? null;
  }
}
