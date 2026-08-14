// The link between tools and layers, made explicit.
//
// Until now each tool quietly looked for a layer of the kind it needed, and
// created one if it found none. It worked, but you could not tell where your
// next stroke was going to land until after you had made it. The rule now is
// a single one, in both directions:
//
//     one kind of content, one set of tools — and they stay in step.
//
// Pick a tool and its target layer becomes the selected one, highlighted in
// the panel. Select a layer and the matching tool becomes active. There is
// never a tool pointing at a layer you cannot see.
//
// Two rules follow from that, and they are the whole reason this file has state
// of its own:
//
//   • NOTHING here creates an empty layer. Choosing a tool, choosing a colour,
//     asking for a new layer — none of them touch the document. A layer comes
//     into being with its first stroke, its first pin, its first measurement,
//     and never before. An empty « Peinture » that appeared because someone
//     clicked a swatch is a row that looks like work and is not.
//
//   • Starting a NEW layer has to be as easy as continuing an old one. The
//     button arms the next gesture instead of creating anything, so the two
//     read the same way: you say where the work goes, then you do the work.
//
// Annotations are the deliberate exception, and it is the point of this
// version: a pin does not join a layer, it IS one. `poserEpingle` therefore
// creates a layer per annotation rather than asking for a target here.

import {
  creerCalque, TYPES_CALQUE, GENRES, calquePorte, genresDuCalque,
} from '../document/modele.js';

export const GENRE_PAR_OUTIL = {
  epingle: 'epingle',
  pinceau: 'trace',
  gomme: 'trace',
  baguette: 'region',
  lasso: 'region',
  mesure: 'mesure',
};

// The tool a layer hands back to when it is selected.
export const OUTIL_PAR_GENRE = {
  epingle: 'epingle',
  trace: 'pinceau',
  region: 'baguette',
  mesure: 'mesure',
};

// The kinds a tool can start a fresh layer of. An eraser cannot: a new, empty
// paint layer is precisely the thing an eraser has nothing to do with.
export const GENRES_NOUVEAU = new Set(['trace', 'region', 'mesure']);

export class Atelier {
  constructor({ panneauDroit, barreOutils }) {
    this.panneauDroit = panneauDroit;
    this.barreOutils = barreOutils;
    this.enSynchro = false;
    // The kind whose next gesture must start a fresh layer rather than join the
    // one already selected. Cleared as soon as that gesture happens, or as soon
    // as the user picks a layer by hand — clicking a row IS saying where the
    // work goes, and it must win over a button pressed a moment earlier.
    this.nouveauPour = null;
    // Colours chosen before there was anything to colour. A swatch clicked with
    // no target layer used to conjure one up; now it waits here for the layer
    // the next gesture creates.
    this.couleursEnAttente = {};
    // Set by the application: the tool panels say where the work will land, and
    // that sentence changes when any of this does.
    this.surChangement = null;
  }

  get doc() {
    return this.panneauDroit.doc;
  }

  genreDeLOutil(outil = this.barreOutils.actif) {
    return GENRE_PAR_OUTIL[outil] ?? null;
  }

  _prevenir() {
    this.surChangement?.();
  }

  // Whether a layer can take content of this kind. A layer whose declared type
  // matches, and one that already holds some, both qualify — the second so that
  // a layer whose type was set by an older build still accepts the brush that
  // visibly made it.
  peutRecevoir(calque, genre) {
    if (!calque || calque.enfants) return false;
    return calque.type === GENRES[genre].type || calquePorte(calque, genre);
  }

  // Layer the active tool writes to. Never returns a locked or hidden one: it
  // would accept work that nobody could see.
  calqueUtilisable(genre) {
    const utilisable = (calque) => this.peutRecevoir(calque, genre)
      && !this.doc.verrouilleEffectivement(calque.id)
      && this.doc.visibleEffectivement(calque.id);

    const courant = this.panneauDroit.selection;
    if (courant && utilisable(courant)) return courant;

    return this.doc.aplatir()
      .map(({ calque }) => calque)
      .reverse()
      .find(utilisable) ?? null;
  }

  /* ------------------------------------------------- démarrer / continuer */

  // « Je veux une nouvelle peinture. » Arms the next gesture; creates nothing.
  demanderNouveauCalque(genre = this.genreDeLOutil()) {
    if (!genre || !GENRES_NOUVEAU.has(genre)) return;
    this.nouveauPour = this.nouveauPour === genre ? null : genre;
    this._prevenir();
  }

  annulerNouveauCalque() {
    if (this.nouveauPour === null) return;
    this.nouveauPour = null;
    this._prevenir();
  }

  get nouveauArme() {
    return this.nouveauPour !== null && this.nouveauPour === this.genreDeLOutil();
  }

  // Which layer a colour chosen in a tool panel would repaint.
  //
  // An annotation is one layer, so « the annotation layer the tool is aimed at »
  // is only ever the one being looked at — reaching for the most recent one, the
  // way the brush legitimately reaches for the last paint layer, would recolour
  // an annotation placed ten minutes ago from the panel of the next one.
  _cibleCouleur(genre) {
    if (this.nouveauPour === genre) return null;
    if (genre === 'epingle') {
      const courant = this.panneauDroit.selection;
      return this.peutRecevoir(courant, genre) ? courant : null;
    }
    return this.calqueUtilisable(genre);
  }

  // A colour chosen in a tool panel. It recolours the layer the tool is aimed
  // at, and when there is none — or when a new layer has just been asked for —
  // it is remembered for the layer the next gesture will create. Either way it
  // creates nothing.
  definirCouleur(genre, couleur) {
    if (!genre) return;
    // For annotations the colour is above all the one the NEXT pin will wear,
    // since every pin makes its own layer.
    if (genre === 'epingle') this.couleursEnAttente[genre] = couleur;

    const calque = this._cibleCouleur(genre);
    if (!calque) {
      this.couleursEnAttente[genre] = couleur;
      this._prevenir();
      return;
    }
    this.panneauDroit.muter('Couleur du calque', () => {
      const courant = this.doc.trouver(calque.id);
      if (courant) courant.couleur = couleur;
    });
    this._prevenir();
  }

  // The colour the tool is currently showing: the target layer's, or the one
  // waiting for the layer that does not exist yet.
  couleurCourante(genre = this.genreDeLOutil()) {
    if (!genre) return '';
    if (genre === 'epingle') {
      return this.couleursEnAttente[genre] ?? this._cibleCouleur(genre)?.couleur ?? '';
    }
    return this._cibleCouleur(genre)?.couleur ?? this.couleursEnAttente[genre] ?? '';
  }

  /* ------------------------------------------------------- synchronisation */

  // Called when a tool is picked: selects a layer of the matching kind if
  // there is one. Deliberately does NOT create one — merely trying the tools
  // would otherwise leave a trail of empty layers behind. The layer is created
  // by the first actual gesture, and the tool panel says so beforehand.
  alignerCalqueSurOutil(outil) {
    const genre = this.genreDeLOutil(outil);
    if (!genre || this.enSynchro) return null;
    // An armed « new layer » belongs to the tool that armed it.
    if (this.nouveauPour && this.nouveauPour !== genre) this.nouveauPour = null;

    const calque = this.calqueUtilisable(genre);
    if (!calque) return null;

    this.enSynchro = true;
    try {
      if (this.panneauDroit.liste.selection !== calque.id) {
        this.panneauDroit.liste.selectionner(calque.id);
      }
      return calque.id;
    } finally {
      this.enSynchro = false;
    }
  }

  // Called when a layer is selected: switches to the tool that fills it.
  //
  // Choosing a layer by hand is the clearest possible statement of where the
  // next stroke goes, so it cancels a pending « new layer ». Without that, one
  // could arm a new paint, change one's mind, click an existing paint layer,
  // and still get a new one.
  alignerOutilSurCalque(idCalque) {
    if (this.enSynchro || !idCalque) return;
    this.annulerNouveauCalque();
    const calque = this.doc.trouver(idCalque);
    if (!calque || calque.enfants) return;
    const genre = this._genrePrincipal(calque);
    const outil = genre && OUTIL_PAR_GENRE[genre];
    if (!outil) return;
    // A layer already served by the current tool must not steal it: the eraser
    // would jump back to the brush at every click on its own layer.
    if (this.genreDeLOutil() === genre) return;

    this.enSynchro = true;
    try {
      this.barreOutils.choisir(outil);
    } finally {
      this.enSynchro = false;
    }
  }

  // What one tool would have to be in hand to add to this layer. Content
  // answers first; an empty layer is described by the type it was created with.
  _genrePrincipal(calque) {
    const genres = genresDuCalque(calque);
    if (genres.length >= 1) return genres[0];
    for (const [genre, modele] of Object.entries(GENRES)) {
      if (calque.type === modele.type) return genre;
    }
    return null;
  }

  /* ------------------------------------------------------------- création */

  creerCalquePour(genre) {
    const type = GENRES[genre].type;
    const calque = creerCalque(type);
    calque.nom = this.doc.nomDisponible(TYPES_CALQUE[type].libelle);
    if (genre === 'region') calque.contour = true;
    const couleur = this.couleursEnAttente[genre];
    if (couleur) {
      calque.couleur = couleur;
      delete this.couleursEnAttente[genre];
    }
    this.panneauDroit.muter(`Nouveau calque « ${calque.nom} »`,
      () => this.doc.ajouter(calque, null, null));
    this.panneauDroit.liste.selectionner(calque.id);
    return calque.id;
  }

  // Target for the tool about to be used. This is the ONLY place a layer is
  // born of a tool, and it runs at the start of a real gesture — never when a
  // tool is merely selected or a colour merely chosen.
  calqueCourant() {
    const genre = this.genreDeLOutil();
    if (!genre) return null;
    if (this.nouveauPour === genre) {
      this.nouveauPour = null;
      return this.creerCalquePour(genre);
    }
    const calque = this.calqueUtilisable(genre);
    return calque ? calque.id : this.creerCalquePour(genre);
  }

  // Where the work will go, as a chip: a short label that never wraps, plus the
  // full sentence for its tooltip and a state for its styling.
  //
  // The label used to BE the sentence. « Le prochain geste créera un calque de
  // peinture. » landed in a column ninety pixels wide — six lines of prose for
  // one fact you need to check at a glance, every time you look down. The fact
  // is « nouveau calque »; the rest is an explanation, and an explanation
  // belongs where you go looking for it, not where you keep tripping over it.
  etiquetteCible() {
    const genre = this.genreDeLOutil();
    if (!genre) return { texte: '', detail: '', etat: 'vide' };

    // A pin is a layer of its own, every time. There is no target to announce
    // and nothing to reuse — saying « calque : Annotation 3 » would suggest the
    // next click joins that one.
    if (genre === 'epingle') {
      return {
        texte: 'Un calque par annotation',
        detail: 'Chaque annotation posée devient son propre calque.',
        etat: 'nouveau',
      };
    }

    const nomGenre = GENRES[genre].libelle.toLowerCase();
    const calque = this.calqueUtilisable(genre);

    if (!calque && this.barreOutils.actif === 'gomme') {
      return {
        texte: 'Aucune peinture',
        detail: 'Rien à effacer : ce document ne contient aucune peinture.',
        etat: 'vide',
      };
    }

    // Armed, or simply nothing to aim at: the outcome is the same, so the label
    // is the same. What tells them apart is the button, which stays pressed
    // only when the new layer was actually asked for.
    if (this.nouveauPour === genre || !calque) {
      return {
        texte: 'Nouveau calque',
        detail: this.nouveauPour === genre
          ? `Le prochain geste créera un calque de ${nomGenre}.`
          : `Aucun calque de ${nomGenre} : le prochain geste en créera un.`,
        etat: 'nouveau',
      };
    }

    return {
      texte: calque.nom,
      detail: `Le geste ira dans « ${calque.nom} ». Cliquez une autre ligne du panneau `
        + 'des calques pour changer de destination.',
      etat: 'cible',
    };
  }
}
