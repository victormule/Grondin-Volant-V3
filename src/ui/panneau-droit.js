// The right-hand panel: layer stack, actions, inspector.
//
// It is the only writer to the document. Every change goes through `muter`,
// which wraps it in an undo command and schedules the local draft save — so
// there is no path by which a change escapes the undo stack or gets lost.

import { creerCalque, TYPES_CALQUE } from '../document/modele.js';
import { commandeInstantane } from '../document/commandes.js';
import { exporter, telecharger } from '../document/stockage.js';
import { construireZip } from '../document/zip.js';
import { ListeCalques } from './liste-calques.js';
import { Inspecteur } from './inspecteur.js';
import { Fiche } from './fiche.js';

// Only the kinds a tool can actually fill. Offering a type nothing can put
// anything into was the main thing making the tool/layer relationship
// confusing. « Mesure » is back because the ruler is; « Contour » stays out
// until it has a tool of its own — a region already draws its own outline.
const TYPES_CREABLES = ['annotation', 'peinture', 'region', 'mesure'];
const TYPES_FUSION_DIRECTE = new Set(['annotation', 'mesure', 'region']);
const CLE_INSPECTEUR_OUVERT = 'durair.inspecteur.ouvert';
const CLE_INSPECTEUR_HAUTEUR = 'durair.inspecteur.hauteur';
const HAUTEUR_INSPECTEUR_DEFAUT = 260;
const HAUTEUR_INSPECTEUR_MIN = 96;

function memePortee(a, b) {
  return JSON.stringify(a.portee ?? 'toutes') === JSON.stringify(b.portee ?? 'toutes');
}

// Concatenating two content arrays is visually lossless only for these types
// and only when both layers already share all inherited rendering choices.
// Paint is deliberately excluded: an eraser on the upper layer must never
// start erasing strokes from the lower layer after a so-called merge.
function fusionCompatible(haut, bas) {
  return Boolean(haut && bas
    && TYPES_FUSION_DIRECTE.has(haut.type)
    && haut.type === bas.type
    && !haut.enfants && !bas.enfants
    && haut.couleur === bas.couleur
    && haut.opacite === bas.opacite
    && haut.visible === bas.visible
    && haut.verrouille === bas.verrouille
    && haut.contour === bas.contour
    && memePortee(haut, bas));
}

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
    // A single selection shared by the 3D labels and the rows nested under an
    // annotation layer.
    this.surSelectionElement = null;
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
      surApercu: (detail) => this._planifierApercu(detail),
      surSelection: (id) => {
        if (this.fiche.ouverte) this.fermerFiche();
        this.inspecteur.afficher(id);
        this.surSelectionCalque?.(id);
        this._majActions();
      },
      surSelectionElement: (idElement, idCalque) => {
        this.ouvrirFiche(idElement, idCalque);
      },
    });

    this.inspecteur = new Inspecteur(elements.inspecteur, {
      document: doc,
      surMutation: this.muter,
      sessions: this.sessions,
      couleurs: options.couleurs,
      mesures: (calque) => this.mesures?.(calque) ?? null,
      surConversionRegion: (calque) => this.surConversionRegion?.(calque),
      surLissageRegion: (calque) => this.surLissageRegion?.(calque),
    });

    this.fiche = new Fiche(elements.fiche, {
      document: doc,
      medias: this.medias,
      surMutation: this.muter,
      surFermeture: () => this.fermerFiche(),
      surCentrage: (epingle) => this.surCentrage?.(epingle),
      surSuppression: (idEpingle, idCalque) => this.supprimerEpingle(idEpingle, idCalque),
    });

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

  ouvrirFiche(idEpingle, idCalque) {
    this.surDemandeOuverture?.();
    const dejaSelectionnee = this.liste.selectionElement?.idElement === idEpingle
      && this.liste.selectionElement?.idCalque === idCalque;
    if (!dejaSelectionnee && !this.liste.selectionnerElement(idEpingle, idCalque, false)) return;
    this.fiche.ouvrir(idEpingle, idCalque);
    this.elements.panneau.classList.add('fiche-ouverte');
    this.surSelectionCalque?.(idCalque);
    this.surSelectionElement?.(idEpingle, idCalque);
  }

  fermerFiche() {
    this.fiche.fermer();
    this.elements.panneau.classList.remove('fiche-ouverte');
    this.liste.selectionElement = null;
    this.liste.rendre();
    this.inspecteur.afficher(this.liste.selection);
    this._majActions();
    this.surSelectionElement?.(null, this.liste.selection);
    this.surChangementDocument?.(null);
  }

  supprimerEpingle(idEpingle, idCalque) {
    this.muter('Supprimer l’annotation', () => {
      const calque = this.doc.trouver(idCalque);
      if (!calque?.donnees) return;
      calque.donnees.elements = calque.donnees.elements.filter((e) => e.id !== idEpingle);
    });
    this.fermerFiche();
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
    // Invalidate/recompose before the inspector asks for derived metrics.
    // Doing it afterwards computed an expensive paint area only to discard
    // its cache immediately in the document-change callback.
    this.surChangementDocument?.(this.fiche.ouverte ? this.fiche.idEpingle : null);
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
      else this.surChangementDocument?.(this.fiche.ouverte ? this.fiche.idEpingle : null);
    });
  }

  get selection() {
    return this.liste.selection ? this.doc.trouver(this.liste.selection) : null;
  }

  /* ------------------------------------------------------------- actions */

  _brancherActions() {
    const { nouveauCalque, nouveauGroupe, dupliquer, supprimer, fusionner,
      annuler, retablir, exporter: boutonExport, menu } = this.elements;

    nouveauCalque.addEventListener('click', (e) => {
      e.stopPropagation();
      this._basculerMenu();
    });

    for (const type of TYPES_CREABLES) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'menu-option';
      option.innerHTML = `<span class="menu-icone">${TYPES_CALQUE[type].icone}</span>${TYPES_CALQUE[type].libelle}`;
      option.addEventListener('click', () => {
        this._fermerMenu();
        this._creer(type);
      });
      menu.appendChild(option);
    }

    document.addEventListener('click', () => this._fermerMenu());

    nouveauGroupe.addEventListener('click', () => this._creer('groupe'));
    dupliquer.addEventListener('click', () => this._dupliquer());
    supprimer.addEventListener('click', () => this._supprimer());
    fusionner.addEventListener('click', () => this._fusionnerVersLeBas());
    annuler.addEventListener('click', () => { this.pile.annuler(); this._apresHistorique(); });
    retablir.addEventListener('click', () => { this.pile.retablir(); this._apresHistorique(); });
    boutonExport.addEventListener('click', () => this._exporter());
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

    const libelle = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = 'Préparation…';
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
      bouton.textContent = 'Export impossible';
      setTimeout(() => { bouton.textContent = libelle; bouton.disabled = false; }, 2500);
      return;
    }
    bouton.textContent = libelle;
    bouton.disabled = false;
  }

  _basculerMenu() {
    this.elements.menu.classList.toggle('ouvert');
  }

  _fermerMenu() {
    this.elements.menu.classList.remove('ouvert');
  }

  // New layers land just above the selection, like in any layer panel.
  _creer(type) {
    const calque = creerCalque(type);
    calque.nom = this.doc.nomDisponible(TYPES_CALQUE[type].libelle);
    const courant = this.selection;
    let idParent = null;
    let index = null;

    if (courant) {
      if (courant.enfants && !courant.replie
        && !this.doc.verrouilleEffectivement(courant.id)) {
        idParent = courant.id;
        index = courant.enfants.length;
      } else {
        const parent = this.doc.parentDe(courant.id);
        idParent = parent === this.doc.racine ? null : parent.id;
        index = parent.enfants.findIndex((c) => c.id === courant.id) + 1;
      }
    }

    this.muter(`Nouveau ${TYPES_CALQUE[type].libelle.toLowerCase()}`,
      () => this.doc.ajouter(calque, idParent, index));
    this.liste.selectionner(calque.id);
  }

  _dupliquer() {
    const courant = this.selection;
    if (!courant) return;
    const parent = this.doc.parentDe(courant.id);
    const index = parent.enfants.findIndex((c) => c.id === courant.id) + 1;
    const copie = renommerRecursivement(structuredClone(courant));
    copie.nom = this.doc.nomDisponible(`${courant.nom} copie`);

    this.muter('Dupliquer', () => this.doc.ajouter(
      copie, parent === this.doc.racine ? null : parent.id, index,
    ));
    this.liste.selectionner(copie.id);
  }

  _supprimer() {
    const courant = this.selection;
    if (!courant) return;
    const nom = courant.nom;
    this.muter(`Supprimer « ${nom} »`, () => this.doc.retirer(courant.id));
    this.liste.selection = null;
    this.inspecteur.afficher(null);
    this.rafraichir();
  }

  // Merge rule, decided once so it never has to be argued again:
  //   • same type      → the two layers become one, contents concatenated;
  //   • anything else  → they go into a group instead.
  // Grouping rather than merging incompatible types is the honest option: a
  // merge that silently drops half the information would be worse than a
  // slightly different result, and the panel still ends up with one row.
  _fusionnerVersLeBas() {
    const courant = this.selection;
    if (!courant) return;
    const parent = this.doc.parentDe(courant.id);
    const index = parent.enfants.findIndex((c) => c.id === courant.id);
    if (index <= 0) return;
    const dessous = parent.enfants[index - 1];

    if (!fusionCompatible(courant, dessous)) return;
    this.muter(`Fusionner « ${courant.nom} »`, () => {
      const bas = this.doc.trouver(dessous.id);
      const haut = this.doc.trouver(courant.id);
      bas.donnees.elements = [...bas.donnees.elements, ...haut.donnees.elements];
      this.doc.retirer(haut.id);
    });
    this.liste.selectionner(dessous.id);
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
    const courant = this.selection;
    this.elements.dupliquer.disabled = !courant;
    this.elements.supprimer.disabled = !courant;

    let fusionnable = false;
    if (courant) {
      const parent = this.doc.parentDe(courant.id);
      const index = parent.enfants.findIndex((c) => c.id === courant.id);
      fusionnable = index > 0 && fusionCompatible(courant, parent.enfants[index - 1]);
    }
    this.elements.fusionner.disabled = !fusionnable;
    this.elements.fusionner.title = fusionnable
      ? 'Fusionner avec le calque du dessous sans modifier le rendu'
      : 'Fusion disponible pour deux calques compatibles de même type et de même apparence';
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

  _hauteurInspecteurMax() {
    return Math.max(HAUTEUR_INSPECTEUR_MIN,
      Math.floor((this.elements.panneau.clientHeight || window.innerHeight) * 0.68));
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
    texte.textContent = calque ? `Propriétés · ${calque.nom}` : 'Propriétés';
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
      if (evenement.key === 'Delete' || evenement.key === 'Backspace') {
        if (this.liste.selectionElement) {
          evenement.preventDefault();
          const { idElement, idCalque } = this.liste.selectionElement;
          this.supprimerEpingle(idElement, idCalque);
          return;
        }
        if (!this.selection) return;
        evenement.preventDefault();
        this._supprimer();
        return;
      }
      if (evenement.key === 'F2' && this.liste.selectionElement) {
        evenement.preventDefault();
        const champ = this.elements.fiche.querySelector('.fiche-titre');
        champ?.focus();
        champ?.select();
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

    const texte = document.createElement('span');
    const date = new Date(info.modifie);
    texte.textContent = `Brouillon local · ${date.toLocaleDateString('fr-FR')} à `
      + `${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

    const retour = document.createElement('button');
    retour.type = 'button';
    retour.className = 'bandeau-action';
    retour.textContent = 'Revenir au publié';
    retour.addEventListener('click', surRetourPublie);

    bandeau.append(texte, retour);
  }
}

// A duplicated subtree must not reuse its ids: two layers sharing one id would
// make every lookup ambiguous.
function renommerRecursivement(calque) {
  calque.id = crypto.randomUUID ? crypto.randomUUID() : 'c-' + Math.random().toString(36).slice(2, 11);
  for (const element of calque.donnees?.elements || []) {
    element.id = crypto.randomUUID ? crypto.randomUUID() : 'e-' + Math.random().toString(36).slice(2, 11);
  }
  for (const enfant of calque.enfants || []) renommerRecursivement(enfant);
  return calque;
}
