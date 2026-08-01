// The link between tools and layers, made explicit.
//
// Until now each tool quietly looked for a layer of the kind it needed, and
// created one if it found none. It worked, but you could not tell where your
// next stroke was going to land until after you had made it. The rule now is
// a single one, in both directions:
//
//     one kind of layer, one set of tools — and they stay in step.
//
// Pick a tool and its target layer becomes the selected one, highlighted in
// the panel. Select a layer and the matching tool becomes active. There is
// never a tool pointing at a layer you cannot see.

import { creerCalque, TYPES_CALQUE } from '../document/modele.js';

export const TYPE_PAR_OUTIL = {
  epingle: 'annotation',
  pinceau: 'peinture',
  gomme: 'peinture',
  baguette: 'region',
  lasso: 'region',
  mesure: 'mesure',
};

// The tool a layer hands back to when it is selected.
export const OUTIL_PAR_TYPE = {
  annotation: 'epingle',
  peinture: 'pinceau',
  region: 'baguette',
  mesure: 'mesure',
};

export class Atelier {
  constructor({ panneauDroit, barreOutils }) {
    this.panneauDroit = panneauDroit;
    this.barreOutils = barreOutils;
    this.enSynchro = false;
  }

  get doc() {
    return this.panneauDroit.doc;
  }

  typeDeLOutil(outil = this.barreOutils.actif) {
    return TYPE_PAR_OUTIL[outil] ?? null;
  }

  // Layer the active tool writes to. Never returns a locked or hidden one: it
  // would accept work that nobody could see.
  calqueUtilisable(type) {
    const courant = this.panneauDroit.selection;
    if (courant?.type === type && !this.doc.verrouilleEffectivement(courant.id)
      && this.doc.visibleEffectivement(courant.id)) {
      return courant;
    }
    return this.doc.aplatir()
      .map(({ calque }) => calque)
      .reverse()
      .find((c) => c.type === type && !this.doc.verrouilleEffectivement(c.id)
        && this.doc.visibleEffectivement(c.id)) ?? null;
  }

  // Called when a tool is picked: selects a layer of the matching kind if
  // there is one. Deliberately does NOT create one — merely trying the tools
  // would otherwise leave a trail of empty layers behind. The layer is created
  // by the first actual gesture, and the tool panel says so beforehand.
  alignerCalqueSurOutil(outil) {
    const type = this.typeDeLOutil(outil);
    if (!type || this.enSynchro) return null;

    const calque = this.calqueUtilisable(type);
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
  alignerOutilSurCalque(idCalque) {
    if (this.enSynchro || !idCalque) return;
    const calque = this.doc.trouver(idCalque);
    const outil = calque && OUTIL_PAR_TYPE[calque.type];
    if (!outil) return;
    // A layer already served by the current tool must not steal it: the eraser
    // would jump back to the brush at every click on its own layer.
    if (this.typeDeLOutil() === calque.type) return;

    this.enSynchro = true;
    try {
      this.barreOutils.choisir(outil);
    } finally {
      this.enSynchro = false;
    }
  }

  creerCalquePour(type) {
    const calque = creerCalque(type);
    calque.nom = this.doc.nomDisponible(TYPES_CALQUE[type].libelle);
    if (type === 'region') calque.contour = true;
    this.panneauDroit.muter(`Nouveau calque « ${calque.nom} »`,
      () => this.doc.ajouter(calque, null, null));
    this.panneauDroit.liste.selectionner(calque.id);
    return calque.id;
  }

  // Target for the tool about to be used, created on the spot if the user
  // deleted or locked the one it had.
  calqueCourant() {
    const type = this.typeDeLOutil();
    if (!type) return null;
    const calque = this.calqueUtilisable(type);
    return calque ? calque.id : this.creerCalquePour(type);
  }

  // One line describing where the work will go, shown in every tool panel.
  etiquetteCible() {
    const type = this.typeDeLOutil();
    if (!type) return '';
    const calque = this.calqueUtilisable(type);
    const nomType = TYPES_CALQUE[type].libelle.toLowerCase();
    if (!calque && this.barreOutils.actif === 'gomme') return 'Aucune peinture à effacer.';
    return calque
      ? `Calque : ${calque.nom}`
      : `Aucun calque de ${nomType} : le prochain geste en créera un.`;
  }
}
