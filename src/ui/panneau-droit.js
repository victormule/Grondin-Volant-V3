// The right-hand panel: layer stack, actions, inspector.
//
// It is the only writer to the document. Every change goes through `muter`,
// which wraps it in an undo command and schedules the local draft save — so
// there is no path by which a change escapes the undo stack or gets lost.

import {
  creerCalque, TYPES_CALQUE, DocumentAnnotation, identifiant, ficheRenseignee,
} from '../document/modele.js';
import { commandeInstantane } from '../document/commandes.js';
import { exporter, telecharger } from '../document/stockage.js';
import { construireZip, lireZip } from '../document/zip.js';
import { ListeCalques } from './liste-calques.js';
import { Inspecteur } from './inspecteur.js';
import { Fiche } from './fiche.js';

const CLE_INSPECTEUR_OUVERT = 'durair.inspecteur.ouvert';
const CLE_INSPECTEUR_HAUTEUR = 'durair.inspecteur.hauteur';
const HAUTEUR_INSPECTEUR_DEFAUT = 260;
const HAUTEUR_INSPECTEUR_MIN = 96;

const CLE_FICHE_HAUTEUR = 'durair.fiche.hauteur';
const HAUTEUR_FICHE_DEFAUT = 300;
const HAUTEUR_FICHE_MIN = 150;

export class PanneauDroit {
  constructor(elements, options) {
    const { document: doc, pile, sauvegarde, sessions, medias } = options;
    this.elements = elements;
    this.doc = doc;
    this.pile = pile;
    this.sauvegarde = sauvegarde;
    this.sessions = sessions || [];
    this.medias = medias;

    // Set by the application: rebuilds the 3D markers after any change.
    this.surChangementDocument = null;
    this.surApercuDocument = null;
    this.surCentrage = null;
    // Set by the application: keeps the active tool in step with the selection.
    this.surSelectionCalque = null;
    this.surDemandeOuverture = null;
    this.surConversionRegion = null;
    this.surLissageRegion = null;
    this.apercuEnAttente = false;
    // Set by the application: what a layer measures, for the inspector.
    this.mesures = null;

    this.muter = this.muter.bind(this);

    this.liste = new ListeCalques(elements.liste, {
      document: doc,
      surMutation: this.muter,
      surSelection: (id) => {
        // A card left open on a layer nobody is looking at any more is a card
        // that gets edited by mistake. Selecting another layer moves it.
        if (this.fiche.ouverte && this.fiche.idCalque !== id) {
          if (id && ficheRenseignee(this.doc.trouver(id)?.fiche)) this.fiche.ouvrir(id);
          else this.fermerFiche();
        }
        this.inspecteur.afficher(id, this.liste.selections.size);
        this.surSelectionCalque?.(id);
        this._majActions();
      },
    });

    this.inspecteur = new Inspecteur(elements.inspecteur, {
      document: doc,
      surMutation: this.muter,
      // The opacity slider's live preview. It used to be handed to the layer
      // list, which has no slider and ignored it, so dragging opacity showed
      // nothing until the mouse was released — every intermediate value went
      // to a callback that did not exist.
      surApercu: (detail) => this._planifierApercu(detail),
      sessions: this.sessions,
      couleurs: options.couleurs,
      mesures: (calque) => this.mesures?.(calque) ?? null,
      comparaison: (calque) => this.comparaison?.(calque) ?? null,
      surConversionRegion: (calque) => this.surConversionRegion?.(calque),
      surLissageRegion: (calque) => this.surLissageRegion?.(calque),
      surOuvrirFiche: (idCalque) => this.ouvrirFiche(idCalque),
    });

    this.fiche = new Fiche(elements.fiche, {
      document: doc,
      medias: this.medias,
      surMutation: this.muter,
      surFermeture: () => this.fermerFiche(),
      surCentrage: (calque) => this.surCentrage?.(calque),
      surSuppression: (idCalque) => this.supprimerCalque(idCalque),
      surMemoriserVue: () => this.surMemoriserVue?.() ?? null,
      surRestituerVue: (vue) => this.surRestituerVue?.(vue),
    });

    this.fiche.surPoignee = (poignee) => this._brancherPoigneeFiche(poignee);
    this._appliquerHauteurFiche(Number(localStorage.getItem(CLE_FICHE_HAUTEUR))
      || HAUTEUR_FICHE_DEFAUT, false);

    this._brancherActions();
    this._brancherVoletInspecteur();
    this._brancherRaccourcis();
    this.pile.ecouter(() => this._majAnnulation());

    this.rafraichir();
  }

  /* ------------------------------------------------------------ document */

  definirDocument(doc) {
    this.doc = doc;
    this.liste.definirDocument(doc);
    this.inspecteur.definirDocument(doc);
    this.fiche.definirDocument(doc);
    this.rafraichir();
  }

  /* --------------------------------------------------------------- fiche */

  // The layer as the subject of its own card. Selection is set without
  // notifying, because the panel's own selection callback would move the card
  // that is being opened.
  ouvrirFiche(idCalque) {
    if (!this.doc.trouver(idCalque)) return;
    this.surDemandeOuverture?.();
    if (this.liste.selection !== idCalque) this.liste.selectionner(idCalque, false);
    this.fiche.ouvrir(idCalque);
    this.inspecteur.afficher(idCalque, this.liste.selections.size);
    this.surSelectionCalque?.(idCalque);
    this._majActions();
  }

  fermerFiche() {
    this.fiche.fermer();
    this.inspecteur.afficher(this.liste.selection, this.liste.selections.size);
    this._majActions();
  }

  /* ------------------------------------------------- hauteur de la fiche */

  // The card grows upwards from the foot of the view: dragging its top edge is
  // the only handle it can have, since its bottom is pinned there.
  _brancherPoigneeFiche(poignee) {
    let glisse = null;

    poignee.addEventListener('pointerdown', (evenement) => {
      if (evenement.button !== undefined && evenement.button !== 0) return;
      glisse = {
        pointeur: evenement.pointerId,
        y: evenement.clientY,
        hauteur: this.hauteurFiche,
      };
      poignee.setPointerCapture?.(evenement.pointerId);
      poignee.classList.add('redimensionnement');
      evenement.preventDefault();
    });

    poignee.addEventListener('pointermove', (evenement) => {
      if (!glisse || evenement.pointerId !== glisse.pointeur) return;
      this._appliquerHauteurFiche(glisse.hauteur + glisse.y - evenement.clientY, false);
      evenement.preventDefault();
    });

    const finir = (evenement) => {
      if (!glisse || evenement.pointerId !== glisse.pointeur) return;
      if (poignee.hasPointerCapture?.(evenement.pointerId)) {
        poignee.releasePointerCapture(evenement.pointerId);
      }
      glisse = null;
      poignee.classList.remove('redimensionnement');
      localStorage.setItem(CLE_FICHE_HAUTEUR, String(Math.round(this.hauteurFiche)));
    };
    poignee.addEventListener('pointerup', finir);
    poignee.addEventListener('pointercancel', finir);
    poignee.addEventListener('dblclick', () => this._appliquerHauteurFiche(HAUTEUR_FICHE_DEFAUT));
  }

  _appliquerHauteurFiche(hauteur, memoriser = true) {
    const maximum = Math.max(HAUTEUR_FICHE_MIN, Math.floor(window.innerHeight * 0.78));
    this.hauteurFiche = Math.max(HAUTEUR_FICHE_MIN, Math.min(maximum, hauteur));
    document.documentElement.style.setProperty('--hauteur-fiche', `${this.hauteurFiche}px`);
    if (memoriser) localStorage.setItem(CLE_FICHE_HAUTEUR, String(Math.round(this.hauteurFiche)));
  }

  supprimerCalque(idCalque) {
    const calque = this.doc.trouver(idCalque);
    if (!calque) return;
    this.muter(`Supprimer « ${calque.nom} »`, () => this.doc.retirer(idCalque));
    if (this.fiche.idCalque === idCalque) this.fermerFiche();
    this.liste.selectionner(null);
    this.inspecteur.afficher(null);
    this.rafraichir();
  }

  definirSessions(sessions) {
    this.sessions = sessions;
    this.inspecteur.definirSessions(sessions);
  }

  definirSessionActive(id) {
    this.liste.sessionActive = id;
    this.inspecteur.definirSessionActive(id);
    this.liste.rendre();
  }

  muter(nom, mutation) {
    this.pile.executer(commandeInstantane(this.doc, nom, mutation));
    this.rafraichir();
    this.sauvegarde?.planifier(this.doc.serialiser());
  }

  rafraichir() {
    // A card whose subject no longer exists — its layer deleted, its creation
    // undone — closes through the panel rather than through itself.
    if (this.fiche.ouverte && !this.doc.trouver(this.fiche.idCalque)) this.fermerFiche();

    // Invalidate/recompose before the inspector asks for derived metrics.
    // Doing it afterwards computed an expensive paint area only to discard
    // its cache immediately in the document-change callback.
    this.surChangementDocument?.(this.liste.selection);
    this.liste.rendre();
    this.inspecteur.rendre();
    if (this.fiche.ouverte) this.fiche.rendre();
    this._majAnnulation();
    this._majActions();
  }

  _planifierApercu(detail = null) {
    this.detailApercu = detail;
    if (this.apercuEnAttente) return;
    this.apercuEnAttente = true;
    requestAnimationFrame(() => {
      this.apercuEnAttente = false;
      const courant = this.detailApercu;
      this.detailApercu = null;
      if (this.surApercuDocument) this.surApercuDocument(courant);
      else this.surChangementDocument?.(this.liste.selection);
    });
  }

  get selection() {
    return this.liste.selection ? this.doc.trouver(this.liste.selection) : null;
  }

  /* ------------------------------------------------------------- actions */

  _brancherActions() {
    const { nouveauGroupe, dupliquer, supprimer,
      annuler, retablir, exporter: boutonExport, importer: boutonImport,
      fichierImport } = this.elements;

    nouveauGroupe.addEventListener('click', () => this._creerGroupe());
    dupliquer.addEventListener('click', () => this._dupliquer());
    supprimer.addEventListener('click', () => this._supprimer());
    annuler.addEventListener('click', () => { this.pile.annuler(); this._apresHistorique(); });
    retablir.addEventListener('click', () => { this.pile.retablir(); this._apresHistorique(); });
    boutonExport.addEventListener('click', () => this._exporter());

    if (boutonImport && fichierImport) {
      boutonImport.addEventListener('click', () => fichierImport.click());
      fichierImport.addEventListener('change', async () => {
        const fichier = fichierImport.files?.[0];
        // Cleared before awaiting, so choosing the same file twice in a row
        // still fires a change event the second time.
        fichierImport.value = '';
        await this._importer(fichier);
      });
    }
  }

  // Without media, a plain annotations.json is what goes in the folder. With
  // media, an archive holding that same file plus medias/, to unzip in place.
  async _exporter() {
    const bouton = this.elements.exporter;
    const donnees = this.doc.serialiser();

    if (donnees.medias.length === 0) {
      exporter(donnees);
      return;
    }

    bouton.disabled = true;
    this._message(bouton, 'Préparation…', 0);
    try {
      const { fichiers, table } = await this.medias.pourExport(donnees.medias);
      for (const media of donnees.medias) {
        if (table.has(media.id)) media.chemin = table.get(media.id);
      }
      const json = new TextEncoder().encode(JSON.stringify(donnees, null, 2));
      const archive = construireZip([{ nom: 'annotations.json', donnees: json }, ...fichiers]);
      telecharger(archive, 'annotations.zip');
    } catch (erreur) {
      console.error('Export impossible.', erreur);
      bouton.disabled = false;
      this._message(bouton, 'Export impossible');
      return;
    }
    bouton.disabled = false;
    this._message(bouton);
  }

  /* ------------------------------------------------------ état des boutons */

  // A passing message on a button, and its way back.
  //
  // The label is read from the DOM once and kept on the element; each new
  // message cancels the previous one's timer. Both matter: restoring
  // `textContent` as it was on entry meant that a second import, started before
  // the first message had faded, captured « 3 calques importés » as the label
  // to return to — and the button wore it for good.
  _message(bouton, texte = null, duree = 2800) {
    if (!bouton) return;
    bouton.dataset.libelle ??= bouton.textContent;
    this._minuteursBouton ??= new Map();
    clearTimeout(this._minuteursBouton.get(bouton));
    bouton.textContent = texte ?? bouton.dataset.libelle;
    if (texte === null || duree <= 0) return;
    this._minuteursBouton.set(bouton,
      setTimeout(() => { bouton.textContent = bouton.dataset.libelle; }, duree));
  }

  /* -------------------------------------------------------------- import */

  // The counterpart of the export, and the only way a document gets from one
  // browser to another: there is no server, so a file is the whole transport.
  //
  // Both shapes the export produces are accepted — a bare annotations.json, or
  // the archive that carries the media alongside it — and they are told apart
  // by content rather than by extension, because a file that has been through a
  // mail client often arrives renamed.
  async _importer(fichier) {
    if (!fichier) return;
    const bouton = this.elements.importer;
    const echouer = (message) => {
      console.error('Import impossible.', message);
      if (bouton) bouton.disabled = false;
      this._message(bouton, 'Fichier illisible');
      return false;
    };

    if (bouton) bouton.disabled = true;
    this._message(bouton, 'Lecture…', 0);

    let donnees = null;
    let fichiers = null;
    try {
      const tampon = await fichier.arrayBuffer();
      const entete = new Uint8Array(tampon, 0, Math.min(4, tampon.byteLength));
      const estZip = entete[0] === 0x50 && entete[1] === 0x4B;

      if (estZip) {
        fichiers = await lireZip(tampon);
        const json = fichiers.get('annotations.json')
          ?? [...fichiers.entries()].find(([nom]) => nom.endsWith('annotations.json'))?.[1];
        if (!json) throw new Error('L’archive ne contient pas annotations.json.');
        donnees = JSON.parse(new TextDecoder().decode(json));
      } else {
        donnees = JSON.parse(new TextDecoder().decode(tampon));
      }
    } catch (erreur) {
      return echouer(erreur.message);
    }

    if (!donnees?.racine || !Array.isArray(donnees.racine.enfants)) {
      return echouer('Ce fichier ne contient pas de document d’annotation.');
    }
    // Coordinates from a frame this build no longer uses would be drawn in
    // mid-air, plausibly enough to be mistaken for real placements.
    if (!DocumentAnnotation.frameCompatible(donnees)) {
      console.error('Import refusé : document écrit dans le repère '
        + `« ${donnees.repere ?? 'inconnu'} », antérieur au redressement de la géométrie.`);
      if (bouton) bouton.disabled = false;
      this._message(bouton, 'Repère périmé', 4000);
      return false;
    }
    donnees.medias = Array.isArray(donnees.medias) ? donnees.medias : [];

    // Replacing the layer stack throws away whatever is on screen, and the undo
    // stack cannot walk back across a document swap. Asking is the only honest
    // thing to do — and only when there is actually something to lose.
    const aDuTravail = this.doc.racine.enfants.length > 0;
    if (aDuTravail && !window.confirm(
      'Importer ce profil remplacera les calques actuels. '
      + 'Cette action ne pourra pas être annulée. Continuer ?')) {
      if (bouton) bouton.disabled = false;
      this._message(bouton);
      return false;
    }

    // Media travel as files inside the archive; they are moved into this
    // browser's store so the cards find them, exactly as if they had been
    // dropped in by hand.
    let manquants = 0;
    if (fichiers && this.medias) {
      for (const media of donnees.medias) {
        const octets = media.chemin ? fichiers.get(media.chemin) : null;
        if (!octets) { manquants += 1; continue; }
        try {
          await this.medias.adopter(media, new Blob([octets], { type: media.type || '' }));
        } catch (erreur) {
          console.warn(`Média non repris : ${media.nom}`, erreur);
          manquants += 1;
        }
      }
    }

    this.fermerFiche();
    this.definirDocument(DocumentAnnotation.deserialiser(donnees));
    this.pile.vider();
    this.liste.selectionner(null, false);
    this.inspecteur.afficher(null);
    this.rafraichir();
    this.sauvegarde?.planifier(this.doc.serialiser());

    if (bouton) bouton.disabled = false;
    const calques = this.doc.aplatir().length;
    this._message(bouton, manquants > 0
      ? `${calques} calques · ${manquants} média(s) manquant(s)`
      : `${calques} calque${calques > 1 ? 's' : ''} importé${calques > 1 ? 's' : ''}`, 3200);
    return true;
  }

  /* ------------------------------------------------------------- création */

  // Groups are the only thing that can still be created by hand.
  //
  // Empty layers cannot, and that is the point: a « Peinture » with nothing in
  // it was a row that looked like work and was not, and there were always three
  // of them because trying a tool used to make one. A layer now comes into
  // being with its first stroke, its first pin, its first measurement. A group
  // is different in kind — an empty group is a decision about how the document
  // is organised, made before there is anything to put in it.
  _creerGroupe() {
    const calque = creerCalque('groupe');
    calque.nom = this.doc.nomDisponible(TYPES_CALQUE.groupe.libelle);
    const selection = this.liste.calquesSelectionnes();

    // With layers selected, the group is made AROUND them: that is what one
    // wants nine times out of ten, and doing it by hand means creating the
    // group and then dragging each layer into it.
    if (selection.length > 0) {
      const premier = selection[0];
      const parent = this.doc.parentDe(premier.id);
      const idParent = parent === this.doc.racine ? null : parent.id;
      const index = parent.enfants.findIndex((c) => c.id === premier.id);
      const ids = selection.map((c) => c.id);
      this.muter(`Grouper ${ids.length} calque${ids.length > 1 ? 's' : ''}`, () => {
        this.doc.ajouter(calque, idParent, index);
        for (const id of ids) {
          if (this.doc.contient(id, calque.id)) continue;
          this.doc.deplacer(id, calque.id, calque.enfants.length);
        }
      });
      this.liste.selectionner(calque.id);
      return;
    }

    this.muter('Nouveau groupe', () => this.doc.ajouter(calque, null, null));
    this.liste.selectionner(calque.id);
  }

  _dupliquer() {
    const selection = this.liste.calquesSelectionnes();
    if (selection.length === 0) return;
    const copies = [];

    this.muter(selection.length > 1 ? 'Dupliquer les calques' : 'Dupliquer', () => {
      for (const courant of selection) {
        const parent = this.doc.parentDe(courant.id);
        if (!parent) continue;
        const index = parent.enfants.findIndex((c) => c.id === courant.id) + 1;
        const copie = renommerRecursivement(structuredClone(courant));
        copie.nom = this.doc.nomDisponible(`${courant.nom} copie`);
        this.doc.ajouter(copie, parent === this.doc.racine ? null : parent.id, index);
        copies.push(copie.id);
      }
    });

    this.liste.selections = new Set(copies);
    this.liste.selection = copies.at(-1) ?? null;
    this.rafraichir();
    this.inspecteur.afficher(this.liste.selection, this.liste.selections.size);
    this.surSelectionCalque?.(this.liste.selection);
  }

  _supprimer() {
    const selection = this.liste.calquesSelectionnes();
    if (selection.length === 0) return;
    const nom = selection.length === 1
      ? `Supprimer « ${selection[0].nom} »`
      : `Supprimer ${selection.length} calques`;
    const ids = selection.map((c) => c.id);
    this.muter(nom, () => { for (const id of ids) this.doc.retirer(id); });
    if (this.fiche.ouverte && !this.doc.trouver(this.fiche.idCalque)) this.fermerFiche();
    this.liste.selectionner(null);
    this.inspecteur.afficher(null);
    this.rafraichir();
  }

  _apresHistorique() {
    this.liste.definirDocument(this.doc);
    this.inspecteur.definirDocument(this.doc);
    this.rafraichir();
    this.sauvegarde?.planifier(this.doc.serialiser());
  }

  _majAnnulation() {
    const { annuler, retablir } = this.elements;
    annuler.disabled = this.pile.passe.length === 0;
    retablir.disabled = this.pile.futur.length === 0;
    annuler.title = this.pile.nomAnnulation ? `Annuler : ${this.pile.nomAnnulation}` : 'Annuler';
    retablir.title = this.pile.nomRetablissement ? `Rétablir : ${this.pile.nomRetablissement}` : 'Rétablir';
  }

  _majActions() {
    const nombre = this.liste.selections.size;
    const { dupliquer, supprimer, nouveauGroupe } = this.elements;

    dupliquer.disabled = nombre === 0;
    dupliquer.title = nombre > 1 ? `Dupliquer les ${nombre} calques` : 'Dupliquer le calque';
    supprimer.disabled = nombre === 0;
    supprimer.title = nombre > 1 ? `Supprimer les ${nombre} calques` : 'Supprimer le calque';
    nouveauGroupe.title = nombre > 0
      ? `Grouper ${nombre} calque${nombre > 1 ? 's' : ''}`
      : 'Nouveau groupe';

    this._majLibelleInspecteur();
  }

  /* ---------------------------------------------- volet des propriétés */

  _brancherVoletInspecteur() {
    const { panneau, inspecteur, barreInspecteur, poigneeInspecteur,
      inspecteurBascule } = this.elements;
    if (!barreInspecteur || !poigneeInspecteur || !inspecteurBascule) return;

    const hauteurMemorisee = Number(localStorage.getItem(CLE_INSPECTEUR_HAUTEUR));
    this.hauteurInspecteur = Number.isFinite(hauteurMemorisee) && hauteurMemorisee > 0
      ? hauteurMemorisee
      : HAUTEUR_INSPECTEUR_DEFAUT;
    this._appliquerHauteurInspecteur(this.hauteurInspecteur, false);

    const memorise = localStorage.getItem(CLE_INSPECTEUR_OUVERT);
    this._definirInspecteurOuvert(memorise !== '0', false);
    inspecteurBascule.addEventListener('click', () => {
      this._definirInspecteurOuvert(panneau.classList.contains('inspecteur-replie'));
    });

    let glisse = null;
    poigneeInspecteur.addEventListener('pointerdown', (evenement) => {
      if (evenement.button !== undefined && evenement.button !== 0) return;
      if (panneau.classList.contains('inspecteur-replie')) this._definirInspecteurOuvert(true);
      glisse = {
        pointeur: evenement.pointerId,
        y: evenement.clientY,
        hauteur: inspecteur.getBoundingClientRect().height || this.hauteurInspecteur,
      };
      poigneeInspecteur.setPointerCapture?.(evenement.pointerId);
      barreInspecteur.classList.add('redimensionnement');
      evenement.preventDefault();
    });

    poigneeInspecteur.addEventListener('pointermove', (evenement) => {
      if (!glisse || evenement.pointerId !== glisse.pointeur) return;
      this._appliquerHauteurInspecteur(glisse.hauteur + glisse.y - evenement.clientY, false);
      evenement.preventDefault();
    });

    const finir = (evenement) => {
      if (!glisse || evenement.pointerId !== glisse.pointeur) return;
      if (poigneeInspecteur.hasPointerCapture?.(evenement.pointerId)) {
        poigneeInspecteur.releasePointerCapture(evenement.pointerId);
      }
      glisse = null;
      barreInspecteur.classList.remove('redimensionnement');
      localStorage.setItem(CLE_INSPECTEUR_HAUTEUR, String(Math.round(this.hauteurInspecteur)));
    };
    poigneeInspecteur.addEventListener('pointerup', finir);
    poigneeInspecteur.addEventListener('pointercancel', finir);

    poigneeInspecteur.addEventListener('dblclick', () => {
      this._appliquerHauteurInspecteur(HAUTEUR_INSPECTEUR_DEFAUT);
    });
    poigneeInspecteur.addEventListener('keydown', (evenement) => {
      const pas = evenement.shiftKey ? 48 : 24;
      let hauteur = this.hauteurInspecteur;
      if (evenement.key === 'ArrowUp') hauteur += pas;
      else if (evenement.key === 'ArrowDown') hauteur -= pas;
      else if (evenement.key === 'Home') hauteur = HAUTEUR_INSPECTEUR_MIN;
      else if (evenement.key === 'End') hauteur = this._hauteurInspecteurMax();
      else return;
      evenement.preventDefault();
      this._appliquerHauteurInspecteur(hauteur);
    });

    window.addEventListener('resize', () => {
      this._appliquerHauteurInspecteur(this.hauteurInspecteur, false);
    });
  }

  // How tall the inspector is allowed to get.
  //
  // This was 68 % of the panel, a fraction picked without asking what else had
  // to fit. The header, the draft line, the action row, the list's own minimum,
  // the resize bar and the export footer together need more than the remaining
  // 32 %, so dragging the inspector up pushed the footer out of the panel —
  // out of reach, since a panel that manages its own scrolling regions does not
  // scroll as a whole. The ceiling is now measured rather than guessed: what is
  // left once every sibling has taken what it genuinely needs.
  _hauteurInspecteurMax() {
    const panneau = this.elements.panneau;
    const inspecteur = this.elements.inspecteur;
    if (!panneau || !inspecteur) return HAUTEUR_INSPECTEUR_DEFAUT;

    const style = getComputedStyle(panneau);
    const enfants = [...panneau.children]
      .filter((enfant) => getComputedStyle(enfant).display !== 'none');
    const ecart = parseFloat(style.rowGap) || 0;

    let occupe = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      + ecart * Math.max(0, enfants.length - 1);

    for (const enfant of enfants) {
      if (enfant === inspecteur) continue;
      // The list is the one that stretches, so its current height is whatever
      // the inspector left it — circular. Its floor is what must be reserved.
      occupe += enfant === this.elements.liste
        ? (parseFloat(getComputedStyle(enfant).minHeight) || 0)
        : enfant.getBoundingClientRect().height;
    }

    const disponible = (panneau.clientHeight || window.innerHeight) - occupe;
    return Math.max(HAUTEUR_INSPECTEUR_MIN, Math.floor(disponible));
  }

  _appliquerHauteurInspecteur(hauteur, memoriser = true) {
    const maximum = this._hauteurInspecteurMax();
    this.hauteurInspecteur = Math.max(HAUTEUR_INSPECTEUR_MIN, Math.min(maximum, hauteur));
    this.elements.panneau.style.setProperty('--hauteur-inspecteur', `${this.hauteurInspecteur}px`);
    this.elements.poigneeInspecteur?.setAttribute('aria-valuemax', String(maximum));
    this.elements.poigneeInspecteur?.setAttribute('aria-valuenow', String(Math.round(this.hauteurInspecteur)));
    if (memoriser) {
      localStorage.setItem(CLE_INSPECTEUR_HAUTEUR, String(Math.round(this.hauteurInspecteur)));
    }
  }

  _definirInspecteurOuvert(ouvert, memoriser = true) {
    const { panneau, poigneeInspecteur, inspecteurBascule } = this.elements;
    panneau.classList.toggle('inspecteur-replie', !ouvert);
    inspecteurBascule.setAttribute('aria-expanded', String(ouvert));
    inspecteurBascule.querySelector('.inspecteur-bascule-aide').textContent = ouvert ? 'Replier' : 'Déplier';
    poigneeInspecteur.setAttribute('aria-disabled', String(!ouvert));
    poigneeInspecteur.tabIndex = ouvert ? 0 : -1;
    if (memoriser) localStorage.setItem(CLE_INSPECTEUR_OUVERT, ouvert ? '1' : '0');
  }

  _majLibelleInspecteur() {
    const texte = this.elements.inspecteurBasculeTexte;
    if (!texte) return;
    const calque = this.selection;
    const nombre = this.liste.selections.size;
    texte.textContent = nombre > 1
      ? `Propriétés · ${nombre} calques`
      : (calque ? `Propriétés · ${calque.nom}` : 'Propriétés');
    texte.title = texte.textContent;
  }

  /* ---------------------------------------------------------- raccourcis */

  _brancherRaccourcis() {
    window.addEventListener('keydown', (evenement) => {
      const cible = evenement.target;
      if (cible instanceof HTMLInputElement || cible instanceof HTMLSelectElement
        || cible instanceof HTMLTextAreaElement || cible?.isContentEditable) return;

      const meta = evenement.ctrlKey || evenement.metaKey;
      if (meta && evenement.key.toLowerCase() === 'z') {
        evenement.preventDefault();
        if (evenement.shiftKey) this.pile.retablir(); else this.pile.annuler();
        this._apresHistorique();
        return;
      }
      if (meta && evenement.key.toLowerCase() === 'y') {
        evenement.preventDefault();
        this.pile.retablir();
        this._apresHistorique();
        return;
      }
      if (meta && evenement.key.toLowerCase() === 'g') {
        evenement.preventDefault();
        this._creerGroupe();
        return;
      }
      if (evenement.key === 'Escape' && this.fiche.ouverte) {
        evenement.preventDefault();
        this.fermerFiche();
        return;
      }
      if (evenement.key === 'Delete' || evenement.key === 'Backspace') {
        if (this.liste.selections.size === 0) return;
        evenement.preventDefault();
        this._supprimer();
        return;
      }
      if (evenement.key === 'F2' && this.selection) {
        evenement.preventDefault();
        this.liste.renommer(this.selection.id);
      }
    });
  }

  /* ------------------------------------------------------------- bandeau */

  // Shown only when a published document exists *and* a local draft diverges
  // from it — the one case where the user needs to know which they are looking
  // at, and needs a way back.
  afficherBandeauBrouillon(info, surRetourPublie) {
    const bandeau = this.elements.bandeau;
    if (!info) { bandeau.hidden = true; return; }

    bandeau.replaceChildren();
    bandeau.hidden = false;

    // Two lines and a framed button for a status that is true nearly all the
    // time: it ate the top of the panel to say « you have unsaved work », which
    // is the normal state of anyone annotating. It says the same thing on one
    // short line now — the date it was carrying is not what you read here, so
    // it moved to the tooltip, where it stays available for the one moment you
    // do need it.
    const date = new Date(info.modifie);
    const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const texte = document.createElement('span');
    texte.className = 'bandeau-texte';
    texte.textContent = `Brouillon · ${heure}`;
    texte.title = `Modifications locales non publiées, enregistrées le `
      + `${date.toLocaleDateString('fr-FR')} à ${heure}.`;

    const retour = document.createElement('button');
    retour.type = 'button';
    retour.className = 'bandeau-action';
    retour.textContent = 'Revenir au publié';
    retour.title = 'Abandonner le brouillon local et recharger les annotations publiées';
    retour.addEventListener('click', surRetourPublie);

    bandeau.append(texte, retour);
  }
}

// A duplicated subtree must not reuse its ids: two layers sharing one id would
// make every lookup ambiguous.
function renommerRecursivement(calque) {
  calque.id = identifiant();
  for (const element of calque.donnees?.elements || []) element.id = identifiant();
  for (const enfant of calque.enfants || []) renommerRecursivement(enfant);
  return calque;
}
