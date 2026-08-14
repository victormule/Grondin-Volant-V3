// The layer list: a tree, in reverse document order, the way every layer panel
// in every image editor shows it — top of the list is top of the stack.
//
// One row per layer, and nothing else. Annotations used to appear twice over:
// once as the layer holding them and once as a nested list underneath it, at a
// depth that looked like containment but was not the tree. An annotation is a
// layer now, so it is a row like every other, and the panel has one kind of
// thing in it again.

import {
  TYPES_CALQUE, NATURES, CONFIANCES, GENRES, ficheRenseignee, typeAffiche, genresDuCalque,
} from '../document/modele.js';
import { marquerPastille } from './glyphes.js';

const OEIL_VISIBLE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
const OEIL_MASQUE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/><path d="M3 13 13 3"/></svg>';
const CADENAS = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const POIGNEE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h10M3 8h10M3 10.5h10"/></svg>';
// A luggage tag: the label the layer puts on the specimen, and the switch that
// takes it off again.
const ETIQUETTE_VISIBLE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.4 2H13a1 1 0 0 1 1 1v4.6a1 1 0 0 1-.3.7l-5.4 5.4a1 1 0 0 1-1.4 0L2.3 9.1a1 1 0 0 1 0-1.4l5.4-5.4a1 1 0 0 1 .7-.3Z"/><circle cx="11" cy="5" r="1"/></svg>';
const ETIQUETTE_MASQUEE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.4 2H13a1 1 0 0 1 1 1v4.6a1 1 0 0 1-.3.7l-5.4 5.4a1 1 0 0 1-1.4 0L2.3 9.1a1 1 0 0 1 0-1.4l5.4-5.4a1 1 0 0 1 .7-.3Z"/><path d="M2.5 13.5 13.5 2.5"/></svg>';

// Movement past which a press becomes a drag rather than a tap.
const SEUIL_GLISSE = 6;

export class ListeCalques {
  constructor(conteneur, { document: doc, surMutation, surSelection }) {
    this.conteneur = conteneur;
    this.doc = doc;
    this.surMutation = surMutation;
    this.surSelection = surSelection;
    // The layer the inspector and the card speak for. It is always a member of
    // `selections`, which is what makes « the selection » unambiguous when
    // several rows are lit.
    this.selection = null;
    this.selections = new Set();
    this.sessionActive = null;
    this.glisse = null;
    this.ordreRendu = [];
  }

  definirDocument(doc) {
    this.doc = doc;
    for (const id of [...this.selections]) {
      if (!this.doc.trouver(id)) this.selections.delete(id);
    }
    if (this.selection && !this.doc.trouver(this.selection)) {
      this.selection = this.selections.values().next().value ?? null;
    }
    this.rendre();
  }

  /* ---------------------------------------------------------- sélection */

  get selectionMultiple() {
    return [...this.selections];
  }

  // Selected layers in document order, bottom of the stack first. Merging and
  // deleting both need this order rather than the order rows were clicked in.
  calquesSelectionnes() {
    return this.doc.aplatir()
      .map(({ calque }) => calque)
      .filter((calque) => this.selections.has(calque.id));
  }

  selectionner(id, prevenir = true) {
    this.selection = id;
    this.selections = new Set(id ? [id] : []);
    this.rendre();
    if (prevenir) this.surSelection?.(id);
  }

  // Ctrl/Cmd picks layers one by one, Shift takes everything between the anchor
  // and the row clicked — the two gestures every list in every editor uses, and
  // the reason the merge and delete buttons can act on a set at all.
  _selectionnerAvecClavier(id, evenement) {
    const meta = evenement.ctrlKey || evenement.metaKey;
    if (evenement.shiftKey && this.selection) {
      const ordre = this.ordreRendu;
      const depart = ordre.indexOf(this.selection);
      const arrivee = ordre.indexOf(id);
      if (depart >= 0 && arrivee >= 0) {
        const [a, b] = depart < arrivee ? [depart, arrivee] : [arrivee, depart];
        if (!meta) this.selections = new Set();
        for (let i = a; i <= b; i++) this.selections.add(ordre[i]);
        // The anchor does not move on a Shift click: pressing Shift again has
        // to be able to shrink the range it just grew.
        this.selections.add(this.selection);
        this.rendre();
        this.surSelection?.(this.selection);
        return;
      }
    }

    if (meta) {
      if (this.selections.has(id) && this.selections.size > 1) {
        this.selections.delete(id);
        if (this.selection === id) this.selection = this.selections.values().next().value;
      } else {
        this.selections.add(id);
        this.selection = id;
      }
      this.rendre();
      this.surSelection?.(this.selection);
      return;
    }

    this.selectionner(id);
  }

  /* -------------------------------------------------------------- rendu */

  rendre() {
    const lignes = this.doc.pourAffichage();
    this.conteneur.replaceChildren();
    this.ordreRendu = [];

    if (lignes.length === 0) {
      const vide = document.createElement('p');
      vide.className = 'calques-vide';
      vide.textContent = 'Aucun calque. Un outil en crée un au premier geste, '
        + 'et le bouton ci-dessus crée un groupe.';
      this.conteneur.appendChild(vide);
      return;
    }

    const masques = new Set();
    for (const { calque, profondeur } of lignes) {
      // A collapsed group hides its subtree from the list, not from the scene.
      const parent = this.doc.parentDe(calque.id);
      if (parent && masques.has(parent.id)) { masques.add(calque.id); continue; }
      if (calque.enfants && calque.replie) masques.add(calque.id);
      this.ordreRendu.push(calque.id);
      this.conteneur.appendChild(this._ligne(calque, profondeur));
    }
  }

  _ligne(calque, profondeur) {
    const modele = typeAffiche(calque);
    const ligne = document.createElement('div');
    ligne.className = 'calque';
    ligne.dataset.id = calque.id;
    ligne.style.setProperty('--profondeur', profondeur);
    ligne.tabIndex = 0;

    // One rule per level of nesting, dropped under the parent's chevron. Depth
    // was carried by indentation alone — thirteen pixels a level, which is not
    // enough to read a tree at a glance, and annotations are layers now so the
    // tree gets deep quickly.
    if (profondeur > 0) {
      const guides = document.createElement('span');
      guides.className = 'calque-guides';
      guides.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < profondeur; i++) guides.appendChild(document.createElement('span'));
      ligne.appendChild(guides);
    }
    if (this.selections.has(calque.id)) {
      ligne.classList.add('selectionne');
      if (calque.id === this.selection) ligne.classList.add('principal');
    }
    if (!this.doc.visibleEffectivement(calque.id)) ligne.classList.add('masque');
    const verrouilleEffectif = this.doc.verrouilleEffectivement(calque.id);
    if (verrouilleEffectif) ligne.classList.add('verrouille');
    if (!this.doc.concerneSession(calque, this.sessionActive)) ligne.classList.add('hors-portee');

    if (calque.enfants) {
      const chevron = document.createElement('button');
      chevron.type = 'button';
      chevron.className = 'calque-chevron';
      chevron.textContent = calque.replie ? '▸' : '▾';
      chevron.title = calque.replie ? 'Déplier' : 'Replier';
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        // Folding is a view state, not a document edit: no undo entry for it.
        calque.replie = !calque.replie;
        this.rendre();
      });
      ligne.appendChild(chevron);
    } else {
      ligne.appendChild(Object.assign(document.createElement('span'), { className: 'calque-chevron' }));
    }

    const oeil = document.createElement('button');
    oeil.type = 'button';
    oeil.className = 'calque-oeil';
    oeil.innerHTML = calque.visible ? OEIL_VISIBLE : OEIL_MASQUE;
    oeil.title = calque.visible ? 'Masquer (Alt : isoler)' : 'Afficher (Alt : isoler)';
    oeil.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.altKey) this._isoler(calque);
      else this.surMutation('Visibilité', () => { calque.visible = !calque.visible; });
    });
    ligne.appendChild(oeil);

    const pastille = document.createElement('span');
    pastille.className = 'calque-pastille';
    marquerPastille(pastille, calque);
    pastille.title = this._descriptionContenu(calque, modele);
    ligne.appendChild(pastille);

    const nom = document.createElement('span');
    nom.className = 'calque-nom';
    nom.textContent = calque.nom;
    nom.title = 'Double-clic pour renommer';
    nom.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.renommer(calque.id);
    });
    ligne.appendChild(nom);

    // A described layer says so in the panel, and says what kind of statement
    // it makes. Reading a stack of groups without this means opening each one
    // to find out which are entities and which are mere folders.
    if (ficheRenseignee(calque.fiche)) {
      const marque = document.createElement('span');
      marque.className = 'calque-fiche';
      marque.dataset.nature = calque.fiche.nature ?? 'constat';
      marque.dataset.confiance = calque.fiche.confiance ?? 'certain';
      marque.textContent = CONFIANCES[calque.fiche.confiance]?.abrege ?? 'C';
      const nature = NATURES[calque.fiche.nature]?.libelle ?? 'Constat';
      const confiance = CONFIANCES[calque.fiche.confiance]?.libelle ?? 'Certain';
      marque.title = `${nature} · ${confiance.toLowerCase()}`;
      ligne.appendChild(marque);
    }

    const nombreElements = calque.donnees?.elements.length ?? 0;
    if (nombreElements > 1) {
      const compte = document.createElement('span');
      compte.className = 'calque-compte';
      compte.textContent = String(nombreElements);
      const libelle = GENRES[genresDuCalque(calque)[0]]?.libelle.toLowerCase() ?? 'éléments';
      compte.title = `${nombreElements} tracés de ${libelle} dans ce calque`;
      ligne.appendChild(compte);
    }

    ligne.appendChild(this._basculeEtiquette(calque));

    if (verrouilleEffectif) {
      const verrou = document.createElement('span');
      verrou.className = 'calque-verrou';
      verrou.innerHTML = CADENAS;
      verrou.title = calque.verrouille ? 'Verrouillé' : 'Verrouillé par le groupe parent';
      ligne.appendChild(verrou);
    }

    // Reordering with a finger cannot use the row itself: on a scrolling list
    // a drag down the row IS the scroll gesture. Hence a handle, shown only on
    // touch screens, which is the one place a drag means « move this ».
    const poignee = document.createElement('span');
    poignee.className = 'calque-poignee';
    poignee.innerHTML = POIGNEE;
    poignee.title = 'Glisser pour réordonner';
    poignee.addEventListener('pointerdown', (e) => this._debut(e, calque.id, ligne, true));
    ligne.appendChild(poignee);

    ligne.addEventListener('click', (e) => this._selectionnerAvecClavier(calque.id, e));
    ligne.addEventListener('pointerdown', (e) => this._debut(e, calque.id, ligne, false));

    return ligne;
  }

  // The switch that silences a layer in the view. Every kind of layer carries a
  // label now, so every kind needs to be able to shut up: a document with forty
  // measured zones is unreadable if all forty insist on their name.
  _basculeEtiquette(calque) {
    const actif = calque.etiquette !== false;
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'calque-etiquette-bascule';
    bouton.innerHTML = actif ? ETIQUETTE_VISIBLE : ETIQUETTE_MASQUEE;
    bouton.setAttribute('aria-pressed', String(actif));
    bouton.classList.toggle('inactive', !actif);
    bouton.title = calque.enfants
      ? (actif ? 'Étiquettes du groupe affichées' : 'Étiquettes du groupe masquées')
      : (actif ? 'Masquer l’étiquette dans la vue' : 'Afficher l’étiquette dans la vue');
    bouton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.surMutation(actif ? 'Masquer l’étiquette' : 'Afficher l’étiquette',
        () => { calque.etiquette = !actif; });
    });
    return bouton;
  }

  _descriptionContenu(calque, modele) {
    if (calque.enfants) return TYPES_CALQUE.groupe.libelle;
    return GENRES[genresDuCalque(calque)[0]]?.libelle ?? modele.libelle;
  }

  renommer(id) {
    const ligne = this.conteneur.querySelector(`.calque[data-id="${id}"]`);
    const calque = this.doc.trouver(id);
    if (!ligne || !calque) return;
    const nom = ligne.querySelector('.calque-nom');

    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'calque-nom-champ';
    champ.value = calque.nom;
    nom.replaceWith(champ);
    champ.focus();
    champ.select();

    let termine = false;
    const valider = (garder) => {
      if (termine) return;
      termine = true;
      const valeur = champ.value.trim();
      if (garder && valeur && valeur !== calque.nom) {
        this.surMutation('Renommer', () => { calque.nom = valeur; });
      } else {
        this.rendre();
      }
    };

    champ.addEventListener('blur', () => valider(true));
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') valider(true);
      if (e.key === 'Escape') valider(false);
    });
  }

  _isoler(calque) {
    const tous = this.doc.aplatir().map(({ calque: c }) => c);
    const autresVisibles = tous.some((c) => c !== calque && c.visible);
    this.surMutation('Isoler', () => {
      for (const c of tous) c.visible = autresVisibles ? c === calque : true;
      calque.visible = true;
    });
  }

  /* -------------------------------------------------- glisser / déposer */

  // Pointer events rather than HTML5 drag and drop, which does not exist on a
  // touch screen at all — a tablet had no way to reorder anything.
  //
  // From the handle, a drag starts straight away. From the row, it waits for
  // the pointer to travel a few pixels, so an ordinary click still selects.
  _debut(evenement, id, ligne, depuisPoignee) {
    if (evenement.button !== undefined && evenement.button !== 0) return;
    // Eyes, chevrons, switches and the rename field have their own jobs.
    if (!depuisPoignee && evenement.target.closest('button, input')) return;
    if (depuisPoignee) evenement.stopPropagation();

    const depart = { x: evenement.clientX, y: evenement.clientY };
    const pointeur = evenement.pointerId;
    let arme = depuisPoignee;

    const bouger = (e) => {
      if (e.pointerId !== pointeur) return;
      if (!arme) {
        if (Math.hypot(e.clientX - depart.x, e.clientY - depart.y) < SEUIL_GLISSE) return;
        arme = true;
      }
      if (!this.glisse) {
        // Dragging a row that is part of a multiple selection moves the whole
        // selection; dragging any other row means that row alone, and drops the
        // selection rather than silently carrying it along.
        this.glisse = this.selections.has(id) ? this.calquesSelectionnes().map((c) => c.id) : [id];
        for (const idGlisse of this.glisse) {
          this.conteneur.querySelector(`.calque[data-id="${idGlisse}"]`)
            ?.classList.add('en-deplacement');
        }
        ligne.setPointerCapture?.(pointeur);
      }
      e.preventDefault();
      this._survol(e.clientX, e.clientY);
    };

    const lacher = (e) => {
      if (e.pointerId !== pointeur) return;
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', lacher);
      window.removeEventListener('pointercancel', lacher);
      if (!this.glisse) return;
      this._deposer(e.clientX, e.clientY);
      this.glisse = null;
      this._effacerIndicateur();
      this.rendre();
    };

    window.addEventListener('pointermove', bouger, { passive: false });
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', lacher);
  }

  // Top third drops above the row, bottom third below it, and the middle third
  // drops *into* the row when it is a group — the usual three-zone convention.
  _zone(ligne, y) {
    const boite = ligne.getBoundingClientRect();
    const part = (y - boite.top) / boite.height;
    const calque = this.doc.trouver(ligne.dataset.id);
    if (calque?.enfants && !this.doc.verrouilleEffectivement(calque.id)
      && part > 0.3 && part < 0.7) return 'dedans';
    return part < 0.5 ? 'avant' : 'apres';
  }

  // With the pointer captured, every move lands on the dragged row — so the
  // row under the finger has to be looked up by coordinates.
  _ligneSous(x, y) {
    const element = document.elementFromPoint(x, y);
    const ligne = element?.closest?.('.calque');
    return ligne && this.conteneur.contains(ligne) ? ligne : null;
  }

  _refuse(idCible) {
    return this.glisse.some((id) => id === idCible || this.doc.contient(id, idCible));
  }

  _survol(x, y) {
    this._effacerIndicateur();
    if (!this.glisse) return;
    const ligne = this._ligneSous(x, y);
    if (!ligne) return;
    if (this._refuse(ligne.dataset.id)) return;

    ligne.classList.add(`depot-${this._zone(ligne, y)}`);
  }

  _deposer(x, y) {
    const ligne = this._ligneSous(x, y);
    // Bottom of the document order first, so that moving several layers into
    // one place keeps them in the order they were stacked in.
    const ids = this.glisse;

    if (!ligne) {
      // Dropped on empty space: to the top of the stack, at the root.
      this.surMutation(ids.length > 1 ? 'Déplacer les calques' : 'Déplacer le calque', () => {
        for (const id of ids) this.doc.deplacer(id, null, this.doc.racine.enfants.length);
      });
      return;
    }

    const cible = this.doc.trouver(ligne.dataset.id);
    if (!cible || this._refuse(cible.id)) return;

    const zone = this._zone(ligne, y);
    this.surMutation(ids.length > 1 ? 'Déplacer les calques' : 'Déplacer le calque', () => {
      for (const id of ids) {
        if (zone === 'dedans') {
          this.doc.deplacer(id, cible.id, cible.enfants.length);
          continue;
        }
        const parent = this.doc.parentDe(cible.id);
        if (!parent) continue;
        const index = parent.enfants.findIndex((c) => c.id === cible.id);
        // The list is reversed on screen: dropping "above" a row means later in
        // document order.
        this.doc.deplacer(id, parent === this.doc.racine ? null : parent.id,
          zone === 'avant' ? index + 1 : index);
      }
    });
  }

  _effacerIndicateur() {
    for (const ligne of this.conteneur.querySelectorAll('.calque')) {
      ligne.classList.remove('depot-avant', 'depot-apres', 'depot-dedans');
    }
  }
}
