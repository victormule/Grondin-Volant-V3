// The card: what is said about something, and on what grounds.
//
// ONE SUBJECT, and it is always a layer. A pin used to carry a card of its own
// while the layer holding it carried another, which meant two titles for one
// observation and a reader who could not tell which was the statement. An
// annotation is a layer now, so « the card of this thing » has exactly one
// meaning, and a painted zone, a region and a measurement can have one for the
// first time.
//
// It floats at the foot of the view rather than filling the layer panel. A card
// that takes the panel over hides the stack it is about: you could not look at
// what you were describing and at where it sits at the same time, and closing
// the card was the only way to check. Down here it covers the plinth, which is
// the one part of the view nothing is ever annotated on.

import { rendreMarkdown } from './texte.js';
import { marquerPastille } from './glyphes.js';
import { genreDepuisType } from '../annotations/medias.js';
import {
  NATURES, CONFIANCES, METHODES, GENRES, creerFiche, normaliserFiche,
  typeAffiche, genresDuCalque,
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
    this.editionTexte = false;
    // Which folded sections are open. On the instance, not in the document:
    // this is how someone is working right now, not a fact about the specimen.
    this.sectionsOuvertes = new Set();
    // Set by the panel: wires the resize handle each time the card is rebuilt.
    this.surPoignee = null;
  }

  definirDocument(doc) {
    this.doc = doc;
    if (this.ouverte) this.rendre();
  }

  ouvrir(idCalque) {
    this.idCalque = idCalque;
    this.editionTexte = false;
    this.conteneur.hidden = false;
    this.rendre();
  }

  fermer() {
    this.idCalque = null;
    this.conteneur.hidden = true;
    this.conteneur.replaceChildren();
  }

  get ouverte() {
    return Boolean(this.idCalque);
  }

  /* ------------------------------------------------------------- le sujet */

  // Resolved on every access: undo swaps the whole document, so a reference
  // captured earlier would point at a detached copy. A layer that has never
  // been described reads as an empty card rather than as nothing — writing one
  // field is what actually creates it.
  _sujet() {
    const calque = this.idCalque && this.doc.trouver(this.idCalque);
    if (!calque) return null;
    return normaliserFiche(calque.fiche) ?? creerFiche();
  }

  // Mutations are applied to the live object inside the document, never to the
  // normalised copy `_sujet` hands out for reading. A layer that had no card
  // gets one here, on its first edit — an empty card is never written by the
  // mere act of looking.
  _muter(nom, mutation) {
    this.surMutation(nom, () => {
      const calque = this.doc.trouver(this.idCalque);
      if (!calque) return;
      calque.fiche = normaliserFiche(calque.fiche) ?? creerFiche();
      mutation(calque.fiche, calque);
      calque.fiche.modifie = new Date().toISOString();
    });
  }

  rendre() {
    const sujet = this._sujet();
    if (!sujet) { this.fermer(); return; }
    const calque = this.doc.trouver(this.idCalque);

    // The scroll position survives a re-render. Every field commits through a
    // document mutation, which rebuilds the whole card; without this, typing a
    // property at the bottom threw you back to the top after each field.
    const defilement = this.conteneur.querySelector('.fiche-corps')?.scrollTop ?? 0;

    this.conteneur.replaceChildren();
    this.conteneur.append(
      this._poignee(),
      this._entete(sujet, calque),
      this._corps(sujet, calque),
    );
    const corps = this.conteneur.querySelector('.fiche-corps');
    if (corps) corps.scrollTop = defilement;
  }

  // The top edge, draggable. A card is sometimes one line and sometimes a page;
  // deciding its height once, for everyone, would be wrong either way.
  _poignee() {
    const poignee = document.createElement('div');
    poignee.className = 'fiche-poignee';
    poignee.setAttribute('role', 'separator');
    poignee.setAttribute('aria-orientation', 'horizontal');
    poignee.title = 'Glisser pour redimensionner · double-cliquer pour réinitialiser';
    poignee.appendChild(document.createElement('span'));
    this.surPoignee?.(poignee);
    return poignee;
  }

  // Name, kind and statement on one line.
  //
  // These four were four stacked blocks taking a third of the card before a
  // word of it could be read. They belong together — « ce que c'est, comment ça
  // s'appelle, et quel genre d'énoncé c'est » is one thought — and the nature
  // buttons only need their full width when someone is actually changing them.
  _entete(sujet, calque) {
    const entete = document.createElement('div');
    entete.className = 'fiche-entete';

    const modele = typeAffiche(calque);
    const pastille = document.createElement('span');
    pastille.className = 'fiche-pastille';
    marquerPastille(pastille, calque);
    const genres = genresDuCalque(calque);
    pastille.title = calque.enfants
      ? 'Groupe'
      : (genres.length > 0 ? GENRES[genres[0]].libelle : modele.libelle);

    const champ = this._titre(calque);

    const fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'fiche-fermer';
    fermer.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    fermer.title = 'Fermer la fiche (Échap)';
    fermer.setAttribute('aria-label', 'Fermer la fiche');
    fermer.addEventListener('click', () => this.surFermeture?.());

    entete.append(pastille, champ, this._qualification(sujet), fermer);
    return entete;
  }

  // Everything under the header scrolls; the header itself stays put, so the
  // name and the way out never scroll off a long card.
  //
  // The text comes first and is the only thing given room by default. What
  // remains — the conditions of examination, the recorded viewpoint, the media,
  // the properties — is real, is needed, and is not what you look at while
  // writing; each folds into one line until it is opened. The card went from
  // nine blocks always on screen to one paragraph and four closed drawers.
  _corps(sujet, calque) {
    const corps = document.createElement('div');
    corps.className = 'fiche-corps';
    corps.append(
      this._texte(sujet),
      this._section('conditions', 'Conditions d’examen', this._resumeConditions(sujet),
        () => this._conditions(sujet)),
      this._section('vue', 'Vue d’observation', sujet.vue ? 'mémorisée' : null,
        () => this._vue(sujet)),
      this._section('medias', 'Médias', sujet.medias?.length ? String(sujet.medias.length) : null,
        () => this._medias(sujet)),
      this._section('proprietes', 'Propriétés', this._resumeProprietes(sujet),
        () => this._proprietes(sujet)),
      this._section('affichage', 'Affichage', calque.etiquette === false ? 'sans étiquette' : null,
        () => this._affichage(calque)),
      this._signature(sujet),
      this._actions(calque),
    );
    return corps;
  }

  // A folded block. Which ones are open is remembered on the instance rather
  // than in the document: it is how someone is working right now, not something
  // about the specimen.
  _section(cle, titre, resume, contenu) {
    const bloc = document.createElement('details');
    bloc.className = 'fiche-section';
    bloc.open = this.sectionsOuvertes.has(cle);
    bloc.addEventListener('toggle', () => {
      if (bloc.open) this.sectionsOuvertes.add(cle);
      else this.sectionsOuvertes.delete(cle);
    });

    const entete = document.createElement('summary');
    entete.append(Object.assign(document.createElement('span'), {
      className: 'fiche-section-titre', textContent: titre,
    }));
    if (resume) {
      entete.append(Object.assign(document.createElement('span'), {
        className: 'fiche-section-resume', textContent: resume,
      }));
    }
    bloc.append(entete, contenu());
    return bloc;
  }

  _resumeConditions(sujet) {
    const morceaux = [sujet.methode?.trim(), sujet.auteur?.trim()].filter(Boolean);
    return morceaux.join(' · ') || null;
  }

  _resumeProprietes(sujet) {
    const n = (sujet.proprietes ?? []).filter((p) => p.cle || p.valeur).length;
    return n > 0 ? String(n) : null;
  }

  // The layer's name IS the title of its card. Two editable titles for one
  // thing would be a trap: the card would say one name and the layer row
  // another, and the label on the specimen a third.
  _titre(calque) {
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'champ fiche-titre';
    champ.value = calque?.nom ?? '';
    champ.placeholder = 'Nom — c’est aussi l’étiquette dans la vue';
    champ.addEventListener('change', () => {
      const valeur = champ.value.trim();
      if (!valeur) { champ.value = calque?.nom ?? ''; return; }
      this.surMutation('Renommer', () => {
        const courant = this.doc.trouver(this.idCalque);
        if (courant) courant.nom = valeur;
      });
    });
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') champ.blur();
    });
    return champ;
  }

  /* ------------------------------------------------------- qualification */

  // What kind of statement this is, and how firmly it is made — the whole
  // difference between a description and an examination, in two menus on the
  // header line.
  //
  // It was five pill buttons, a paragraph of explanation and a labelled select:
  // three blocks and a quarter of the card, permanently, for two values that
  // are set once and then read. Both keep their explanations as tooltips, and
  // both stay one click away.
  _qualification(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-qualification';

    const nature = document.createElement('select');
    nature.className = 'fiche-select fiche-select-nature';
    nature.dataset.nature = sujet.nature;
    nature.setAttribute('aria-label', 'Nature de l’énoncé');
    for (const [cle, { libelle }] of Object.entries(NATURES)) {
      const option = document.createElement('option');
      option.value = cle;
      option.textContent = libelle;
      option.selected = sujet.nature === cle;
      nature.appendChild(option);
    }
    nature.title = `Nature de l’énoncé — ${NATURES[sujet.nature]?.aide ?? ''}`;
    nature.addEventListener('change', () => {
      const valeur = nature.value;
      this._muter('Nature de l’énoncé', (e) => { e.nature = valeur; });
    });

    const confiance = document.createElement('select');
    confiance.className = 'fiche-select fiche-select-confiance';
    confiance.dataset.confiance = sujet.confiance;
    confiance.setAttribute('aria-label', 'Confiance');
    for (const [cle, { libelle }] of Object.entries(CONFIANCES)) {
      const option = document.createElement('option');
      option.value = cle;
      option.textContent = libelle;
      option.selected = sujet.confiance === cle;
      confiance.appendChild(option);
    }
    confiance.title = 'Confiance — attachée à l’énoncé, pas à l’observateur : '
      + '« probable » sur un constat est une chose légitime à écrire.';
    confiance.addEventListener('change', () => {
      const valeur = confiance.value;
      this._muter('Confiance', (e) => { e.confiance = valeur; });
    });

    bloc.append(nature, confiance);
    return bloc;
  }

  // Under what conditions, and by whom. Suggestions, not a closed list: a
  // vocabulary that refuses an unforeseen method just gets bypassed into the
  // free text, where nothing can find it again.
  _conditions(sujet) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-conditions';

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
    zone.rows = 6;
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
        this._muter('Texte de la fiche', (e) => { e.texte = valeur; });
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

  // Removed from the card, and from the document when nothing else uses it.
  _retirerMedia(id) {
    this._muter('Retirer le média', (sujet) => {
      sujet.medias = (sujet.medias || []).filter((m) => m !== id);
      const encoreUtilise = this.doc.aplatir()
        .some(({ calque }) => (calque.fiche?.medias || []).includes(id));
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

  /* ------------------------------------------------------------ affichage */

  // Whether this layer says its name on the specimen. The same switch sits on
  // the layer row; it is repeated here because the moment you decide a zone
  // does not deserve a name in the view is the moment you are describing it.
  _affichage(calque) {
    const bloc = document.createElement('div');
    bloc.className = 'fiche-affichage';

    const ligne = document.createElement('label');
    ligne.className = 'case';
    const champ = document.createElement('input');
    champ.type = 'checkbox';
    champ.checked = calque.etiquette !== false;
    champ.addEventListener('change', () => {
      const valeur = champ.checked;
      this.surMutation(valeur ? 'Afficher l’étiquette' : 'Masquer l’étiquette', () => {
        const courant = this.doc.trouver(this.idCalque);
        if (courant) courant.etiquette = valeur;
      });
    });
    ligne.append(champ, document.createTextNode(calque.enfants
      ? 'Étiquettes de ce groupe dans la vue'
      : 'Étiquette dans la vue'));

    const note = document.createElement('p');
    note.className = 'reglages-note';
    note.textContent = calque.enfants
      ? 'Décoché, plus rien de ce groupe ne se nomme dans la vue.'
      : 'L’étiquette porte le nom ci-dessus, à l’endroit exact que ce calque désigne.';

    bloc.append(ligne, note);
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

  _actions(calque) {
    const barre = document.createElement('div');
    barre.className = 'barre-calques fiche-actions';

    if (!calque.enfants) {
      const centrer = document.createElement('button');
      centrer.type = 'button';
      centrer.textContent = 'Centrer la vue';
      centrer.addEventListener('click', () => this.surCentrage?.(calque));
      barre.appendChild(centrer);
    }

    // Removing a layer's card must not remove the layer: the paint, the region
    // and the measurements underneath are the expensive part. Deleting the
    // layer itself is a separate button, and it says so.
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.textContent = 'Retirer la fiche';
    retirer.title = 'Supprime la description, jamais le calque ni son contenu';
    retirer.addEventListener('click', () => {
      if (!window.confirm('Retirer la fiche de ce calque ? Le calque et son contenu sont conservés.')) return;
      this.surMutation('Retirer la fiche', () => {
        const courant = this.doc.trouver(this.idCalque);
        if (courant) courant.fiche = null;
      });
      this.surFermeture?.();
    });
    barre.appendChild(retirer);

    const supprimer = document.createElement('button');
    supprimer.type = 'button';
    supprimer.className = 'action-dangereuse';
    supprimer.textContent = 'Supprimer';
    supprimer.title = 'Supprime le calque et tout son contenu';
    supprimer.addEventListener('click', () => this.surSuppression?.(this.idCalque));
    barre.appendChild(supprimer);

    return barre;
  }
}
