// The layer list: a tree, in reverse document order, the way every layer panel
// in every image editor shows it — top of the list is top of the stack.

import { TYPES_CALQUE } from '../document/modele.js';

const OEIL_VISIBLE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
const OEIL_MASQUE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/><path d="M3 13 13 3"/></svg>';
const CADENAS = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const POIGNEE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h10M3 8h10M3 10.5h10"/></svg>';

// Movement past which a press becomes a drag rather than a tap.
const SEUIL_GLISSE = 6;

export class ListeCalques {
  constructor(conteneur, { document: doc, surMutation, surSelection, surSelectionElement }) {
    this.conteneur = conteneur;
    this.doc = doc;
    this.surMutation = surMutation;
    this.surSelection = surSelection;
    this.surSelectionElement = surSelectionElement;
    this.selection = null;
    this.selectionElement = null;
    this.sessionActive = null;
    this.glisse = null;
  }

  definirDocument(doc) {
    this.doc = doc;
    if (this.selection && !this.doc.trouver(this.selection)) this.selection = null;
    if (this.selectionElement) {
      const calque = this.doc.trouver(this.selectionElement.idCalque);
      const existe = calque?.donnees?.elements.some((e) => e.id === this.selectionElement.idElement);
      if (!existe) this.selectionElement = null;
    }
    this.rendre();
  }

  selectionner(id, prevenir = true) {
    this.selection = id;
    this.selectionElement = null;
    this.rendre();
    if (prevenir) this.surSelection?.(id);
  }

  selectionnerElement(idElement, idCalque, prevenir = true) {
    const calque = this.doc.trouver(idCalque);
    if (!calque?.donnees?.elements.some((e) => e.id === idElement)) return false;
    this.selection = idCalque;
    this.selectionElement = { idElement, idCalque };
    calque.replie = false;
    let parent = this.doc.parentDe(idCalque);
    while (parent && parent !== this.doc.racine) {
      parent.replie = false;
      parent = this.doc.parentDe(parent.id);
    }
    this.rendre();
    this.conteneur.querySelector(`.calque-element[data-element-id="${idElement}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    if (prevenir) this.surSelectionElement?.(idElement, idCalque);
    return true;
  }

  rendre() {
    const lignes = this.doc.pourAffichage();
    this.conteneur.replaceChildren();

    if (lignes.length === 0) {
      const vide = document.createElement('p');
      vide.className = 'calques-vide';
      vide.textContent = 'Aucun calque. Créez-en un pour commencer.';
      this.conteneur.appendChild(vide);
      return;
    }

    const masques = new Set();
    for (const { calque, profondeur } of lignes) {
      // A collapsed group hides its subtree from the list, not from the scene.
      const parent = this.doc.parentDe(calque.id);
      if (parent && masques.has(parent.id)) { masques.add(calque.id); continue; }
      if (calque.enfants && calque.replie) masques.add(calque.id);
      this.conteneur.appendChild(this._ligne(calque, profondeur));
      if (calque.type === 'annotation' && !calque.replie) {
        const elements = calque.donnees?.elements ?? [];
        elements.forEach((element, index) => {
          this.conteneur.appendChild(this._element(calque, element, profondeur + 1, index));
        });
      }
    }
  }

  _ligne(calque, profondeur) {
    const modele = TYPES_CALQUE[calque.type] || TYPES_CALQUE.annotation;
    const ligne = document.createElement('div');
    ligne.className = 'calque';
    ligne.dataset.id = calque.id;
    ligne.style.setProperty('--profondeur', profondeur);
    ligne.tabIndex = 0;
    if (calque.id === this.selection) {
      ligne.classList.add(this.selectionElement ? 'contient-selection' : 'selectionne');
    }
    if (!this.doc.visibleEffectivement(calque.id)) ligne.classList.add('masque');
    const verrouilleEffectif = this.doc.verrouilleEffectivement(calque.id);
    if (verrouilleEffectif) ligne.classList.add('verrouille');
    if (!this.doc.concerneSession(calque, this.sessionActive)) ligne.classList.add('hors-portee');

    const nombreElements = calque.type === 'annotation'
      ? (calque.donnees?.elements.length ?? 0)
      : 0;
    const depliable = Boolean(calque.enfants) || nombreElements > 0;

    if (depliable) {
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
    pastille.style.background = calque.couleur;
    pastille.textContent = modele.icone;
    pastille.title = modele.libelle;
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

    if (nombreElements > 0) {
      const compte = document.createElement('span');
      compte.className = 'calque-compte';
      compte.textContent = String(nombreElements);
      compte.title = `${nombreElements} annotation${nombreElements > 1 ? 's' : ''}`;
      ligne.appendChild(compte);
    }

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

    ligne.addEventListener('click', () => this.selectionner(calque.id));
    ligne.addEventListener('pointerdown', (e) => this._debut(e, calque.id, ligne, false));

    return ligne;
  }

  _element(calque, element, profondeur, index) {
    const ligne = document.createElement('div');
    ligne.className = 'calque-element';
    ligne.dataset.elementId = element.id;
    ligne.dataset.calqueId = calque.id;
    ligne.style.setProperty('--profondeur', profondeur);
    ligne.tabIndex = 0;
    ligne.setAttribute('role', 'button');

    if (this.selectionElement?.idElement === element.id) ligne.classList.add('selectionne');
    if (!this.doc.visibleEffectivement(calque.id)) ligne.classList.add('masque');
    if (!this.doc.concerneSession(calque, this.sessionActive)) ligne.classList.add('hors-portee');

    const point = document.createElement('span');
    point.className = 'calque-element-point';
    point.style.background = calque.couleur;

    const textes = document.createElement('span');
    textes.className = 'calque-element-textes';
    const titre = document.createElement('span');
    titre.className = 'calque-element-titre';
    titre.textContent = element.titre?.trim() || `Annotation ${index + 1}`;
    textes.appendChild(titre);

    const resume = String(element.texte ?? '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`#>*_~|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (resume) {
      const description = document.createElement('span');
      description.className = 'calque-element-description';
      description.textContent = resume;
      textes.appendChild(description);
    }

    ligne.append(point, textes);
    const choisir = (evenement) => {
      evenement.stopPropagation();
      this.selectionnerElement(element.id, calque.id);
    };
    ligne.addEventListener('click', choisir);
    ligne.addEventListener('keydown', (evenement) => {
      if (evenement.key !== 'Enter' && evenement.key !== ' ') return;
      evenement.preventDefault();
      choisir(evenement);
    });
    return ligne;
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
    // Eyes, chevrons and the rename field have their own jobs.
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
        this.glisse = id;
        ligne.classList.add('en-deplacement');
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

  _survol(x, y) {
    this._effacerIndicateur();
    if (!this.glisse) return;
    const ligne = this._ligneSous(x, y);
    if (!ligne) return;
    if (ligne.dataset.id === this.glisse) return;
    if (this.doc.contient(this.glisse, ligne.dataset.id)) return;

    ligne.classList.add(`depot-${this._zone(ligne, y)}`);
  }

  _deposer(x, y) {
    const ligne = this._ligneSous(x, y);
    const id = this.glisse;

    if (!ligne) {
      // Dropped on empty space: to the top of the stack, at the root.
      this.surMutation('Déplacer le calque',
        () => this.doc.deplacer(id, null, this.doc.racine.enfants.length));
      return;
    }

    const cible = this.doc.trouver(ligne.dataset.id);
    if (!cible || cible.id === id || this.doc.contient(id, cible.id)) return;

    const zone = this._zone(ligne, y);
    this.surMutation('Déplacer le calque', () => {
      if (zone === 'dedans') {
        this.doc.deplacer(id, cible.id, cible.enfants.length);
        return;
      }
      const parent = this.doc.parentDe(cible.id);
      const index = parent.enfants.findIndex((c) => c.id === cible.id);
      // The list is reversed on screen: dropping "above" a row means later in
      // document order.
      this.doc.deplacer(id, parent === this.doc.racine ? null : parent.id,
        zone === 'avant' ? index + 1 : index);
    });
  }

  _effacerIndicateur() {
    for (const ligne of this.conteneur.querySelectorAll('.calque')) {
      ligne.classList.remove('depot-avant', 'depot-apres', 'depot-dedans');
    }
  }
}
