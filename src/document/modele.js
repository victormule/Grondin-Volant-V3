// The annotation document: a tree of layers, and nothing else.
//
// One document per specimen, not per session. The three captures were aligned
// onto session 1, so a layer authored on one of them is geometrically valid on
// the others — which is the whole point of annotating this project. A layer can
// still be pinned to particular captures through its `portee`.

export const TYPES_CALQUE = {
  groupe: { libelle: 'Groupe', icone: '▤', contenant: true },
  annotation: { libelle: 'Annotations', icone: '◉' },
  peinture: { libelle: 'Peinture', icone: '◍' },
  region: { libelle: 'Région', icone: '⬢' },
  contour: { libelle: 'Contour', icone: '◠' },
  mesure: { libelle: 'Mesure', icone: '↔' },
};

export const FUSIONS = {
  normal: 'Normal',
  produit: 'Produit',
  ecran: 'Écran',
  superposition: 'Superposition',
};

// What kind of statement a record makes. « Perte de vernis » is not an
// observation, it is a diagnosis: the observation was « zone mate, plus claire,
// aux limites nettes ». A condition report that cannot tell the two apart is
// not refutable, and an unrefutable report is not an examination. One field
// separates them, and it costs the writer one click.
export const NATURES = {
  constat: { libelle: 'Constat', aide: 'Ce qui est vu, indépendamment de toute cause supposée.' },
  interpretation: { libelle: 'Interprétation', aide: 'Ce qu’on en déduit — un diagnostic, pas une observation.' },
  hypothese: { libelle: 'Hypothèse', aide: 'Une explication proposée, qui reste à vérifier.' },
  preconisation: { libelle: 'Préconisation', aide: 'Une action proposée.' },
  intervention: { libelle: 'Intervention', aide: 'Une action réalisée, avec sa date et son auteur.' },
};

// Attached to the statement, not to the observer. « Probable » on a constat is
// a legitimate thing to write: the zone is there, its limits are not certain.
export const CONFIANCES = {
  certain: { libelle: 'Certain', abrege: 'C' },
  probable: { libelle: 'Probable', abrege: 'P' },
  hypothetique: { libelle: 'Hypothétique', abrege: 'H' },
};

// The condition of observation is part of the observation: a crack « visible en
// UV » and a crack « visible à l’œil nu » are two different statements. Offered
// as suggestions, never imposed — a list that refuses an unforeseen method
// would simply be worked around by writing it in the free text.
export const METHODES = [
  'Lumière visible',
  'Lumière rasante',
  'Lumière transmise',
  'Fluorescence UV',
  'Réflectographie IR',
  'Loupe binoculaire',
  'Microscope',
  'Radiographie',
  'Fluorescence X (XRF)',
  'Spectroscopie IR (FTIR)',
  'Coupe stratigraphique',
  'Examen organoleptique',
];

// The descriptive payload, carried both by a pin and by a layer.
//
// A pin has a title of its own; a layer is titled by its name in the panel,
// so `titre` stays empty there and the card edits the name instead.
export function creerFiche(titre = '') {
  return {
    titre,
    texte: '',
    nature: 'constat',
    confiance: 'certain',
    methode: '',
    auteur: '',
    medias: [],
    proprietes: [],
    vue: null,
    cree: new Date().toISOString(),
    modifie: null,
  };
}

// Old documents predate every field above. Rather than migrating the file on
// load — which would rewrite a document the user has not touched — the missing
// fields are filled in on read, and only get written when something is edited.
export function normaliserFiche(fiche) {
  if (!fiche) return null;
  const modele = creerFiche();
  return {
    ...modele,
    ...fiche,
    medias: Array.isArray(fiche.medias) ? fiche.medias : [],
    proprietes: Array.isArray(fiche.proprietes) ? fiche.proprietes : [],
    nature: fiche.nature in NATURES ? fiche.nature : modele.nature,
    confiance: fiche.confiance in CONFIANCES ? fiche.confiance : modele.confiance,
  };
}

// Whether a record carries anything a reader would want to see. Used to decide
// if a layer deserves a « described » marker in the panel: an empty card
// created by a stray click must not decorate the row for ever.
export function ficheRenseignee(fiche) {
  if (!fiche) return false;
  return Boolean(fiche.texte?.trim() || fiche.auteur?.trim() || fiche.methode?.trim()
    || fiche.vue || fiche.medias?.length || fiche.proprietes?.some((p) => p.cle || p.valeur)
    || (fiche.nature && fiche.nature !== 'constat'));
}

const COULEURS = ['#c9553d', '#d99a35', '#4f9066', '#3d7ab8', '#8360b8', '#b8508a'];

let compteurCouleur = 0;

function identifiant() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'c-' + Math.random().toString(36).slice(2, 11);
}

export function creerCalque(type, nom) {
  const modele = TYPES_CALQUE[type] || TYPES_CALQUE.annotation;
  return {
    id: identifiant(),
    type,
    nom: nom || modele.libelle,
    visible: true,
    verrouille: false,
    replie: false,
    opacite: 1,
    fusion: 'normal',
    couleur: COULEURS[compteurCouleur++ % COULEURS.length],
    portee: 'toutes',
    enfants: modele.contenant ? [] : null,
    donnees: modele.contenant ? null : { elements: [] },
  };
}

// A measurement is a polyline in the shared frame, plus how it is to be read:
// through the air, or across the surface. The path itself is never stored —
// on another capture it has to be walked again over that capture's mesh, and a
// path baked on session 1 would float off session 3.
export function creerMesure(points, mode = 'droite', session = null) {
  return {
    id: identifiant(),
    points: points.map((p) => [p.x, p.y, p.z]),
    mode,
    titre: '',
    session,
    cree: new Date().toISOString(),
  };
}

// A pin lives in the shared frame, in metres — not in the frame of whichever
// session was on screen when it was placed. `session` only records where it
// came from.
export function creerEpingle(position, normale, session = null) {
  return {
    id: identifiant(),
    position: [position.x, position.y, position.z],
    normale: [normale.x, normale.y, normale.z],
    ...creerFiche(),
    session,
  };
}

export class DocumentAnnotation {
  constructor(donnees) {
    this.version = donnees?.version ?? 1;
    this.sessionReference = donnees?.sessionReference ?? null;
    this.racine = donnees?.racine ?? { id: 'racine', type: 'groupe', enfants: [] };
    this.medias = donnees?.medias ?? [];
  }

  static vide(sessionReference) {
    return new DocumentAnnotation({ sessionReference });
  }

  /* ------------------------------------------------------------ parcours */

  // Depth-first, document order: index 0 is the bottom of the stack, the way
  // it composites.
  aplatir(depuis = this.racine, profondeur = 0, sortie = []) {
    for (const calque of depuis.enfants) {
      sortie.push({ calque, profondeur });
      if (calque.enfants) this.aplatir(calque, profondeur + 1, sortie);
    }
    return sortie;
  }

  // Panel order: top of the stack first. Note that this is not the reverse of
  // the list above — siblings are reversed, but a group still has to come
  // before the layers it contains, or it would appear underneath them.
  pourAffichage(depuis = this.racine, profondeur = 0, sortie = []) {
    for (const calque of [...depuis.enfants].reverse()) {
      sortie.push({ calque, profondeur });
      if (calque.enfants) this.pourAffichage(calque, profondeur + 1, sortie);
    }
    return sortie;
  }

  trouver(id, depuis = this.racine) {
    if (depuis.id === id) return depuis;
    for (const calque of depuis.enfants || []) {
      if (calque.id === id) return calque;
      if (calque.enfants) {
        const trouve = this.trouver(id, calque);
        if (trouve) return trouve;
      }
    }
    return null;
  }

  parentDe(id, depuis = this.racine) {
    for (const calque of depuis.enfants || []) {
      if (calque.id === id) return depuis;
      if (calque.enfants) {
        const parent = this.parentDe(id, calque);
        if (parent) return parent;
      }
    }
    return null;
  }

  // « Peinture », then « Peinture 2 »… Two layers with the same name in the
  // same panel are a small thing that makes the panel unusable.
  nomDisponible(base) {
    const pris = new Set(this.aplatir().map(({ calque }) => calque.nom));
    if (!pris.has(base)) return base;
    let n = 2;
    while (pris.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  contient(idGroupe, idCandidat) {
    const groupe = this.trouver(idGroupe);
    if (!groupe || !groupe.enfants) return false;
    return this.aplatir(groupe).some(({ calque }) => calque.id === idCandidat);
  }

  /* ------------------------------------------------------------ mutation */

  ajouter(calque, idParent = null, index = null) {
    const parent = (idParent && this.trouver(idParent)) || this.racine;
    const cible = parent.enfants ? parent : this.racine;
    cible.enfants.splice(index ?? cible.enfants.length, 0, calque);
    return calque;
  }

  retirer(id) {
    const parent = this.parentDe(id);
    if (!parent) return null;
    const index = parent.enfants.findIndex((c) => c.id === id);
    return parent.enfants.splice(index, 1)[0];
  }

  // Returns false when the move is impossible — dropping a group inside one of
  // its own descendants, which would detach the branch from the tree.
  deplacer(id, idParent, index) {
    if (id === idParent || this.contient(id, idParent)) return false;
    const parent = (idParent && this.trouver(idParent)) || this.racine;
    if (!parent.enfants) return false;

    const ancien = this.parentDe(id);
    const positionActuelle = ancien.enfants.findIndex((c) => c.id === id);
    const calque = ancien.enfants.splice(positionActuelle, 1)[0];

    let cible = index ?? parent.enfants.length;
    if (ancien === parent && positionActuelle < cible) cible -= 1;
    parent.enfants.splice(Math.max(0, Math.min(cible, parent.enfants.length)), 0, calque);
    return true;
  }

  /* ------------------------------------------------------------ affichage */

  // A layer counts as visible only if every group above it is too.
  visibleEffectivement(id) {
    let calque = this.trouver(id);
    while (calque && calque !== this.racine) {
      if (!calque.visible) return false;
      calque = this.parentDe(calque.id);
    }
    return true;
  }

  // Locking a group locks the work it contains. Showing a lock on a group but
  // still letting a brush edit its children would make the control deceptive.
  verrouilleEffectivement(id) {
    let calque = this.trouver(id);
    while (calque && calque !== this.racine) {
      if (calque.verrouille) return true;
      calque = this.parentDe(calque.id);
    }
    return false;
  }

  // Opacity is relative to the containing group. A child at 100% inside a
  // 40% group is therefore rendered at 40%; deeper groups keep multiplying.
  opaciteEffective(id) {
    let calque = this.trouver(id);
    let opacite = 1;
    while (calque && calque !== this.racine) {
      const valeur = Number(calque.opacite);
      opacite *= Number.isFinite(valeur) ? Math.max(0, Math.min(1, valeur)) : 1;
      calque = this.parentDe(calque.id);
    }
    return opacite;
  }

  /* --------------------------------------------------------------- fiches */

  // The chain from the root down to a layer, the layer itself last.
  chemin(id) {
    const suite = [];
    let calque = this.trouver(id);
    while (calque && calque !== this.racine) {
      suite.unshift(calque);
      calque = this.parentDe(calque.id);
    }
    return suite;
  }

  // The entity a layer belongs to: the nearest ancestor that has been given a
  // card. This is what turns « a paint layer » into « the extent of *this*
  // varnish loss » — and it is what makes a ratio between two layers meaningful
  // rather than a coincidence of the panel order.
  entiteDe(id) {
    let calque = this.parentDe(id);
    while (calque && calque !== this.racine) {
      if (ficheRenseignee(calque.fiche)) return calque;
      calque = this.parentDe(calque.id);
    }
    return null;
  }

  // Every property name already used in the document, so the card can offer
  // them back. Free keys are what makes a corpus impossible to aggregate:
  // « épaisseur », « Epaisseur » and « ép. » are three columns for one thing,
  // and suggesting the existing spelling fixes most of it without forbidding
  // anything.
  vocabulaireProprietes() {
    const cles = new Map();
    const visiter = (fiche) => {
      for (const propriete of fiche?.proprietes ?? []) {
        const cle = String(propriete.cle ?? '').trim();
        if (!cle) continue;
        const unite = String(propriete.unite ?? '').trim();
        if (!cles.has(cle)) cles.set(cle, unite);
        else if (unite && !cles.get(cle)) cles.set(cle, unite);
      }
    };
    for (const { calque } of this.aplatir()) {
      visiter(calque.fiche);
      for (const element of calque.donnees?.elements ?? []) visiter(element);
    }
    return cles;
  }

  concerneSession(calque, idSession) {
    if (!idSession) return true;
    let courant = calque;
    while (courant && courant !== this.racine) {
      const portee = courant.portee ?? 'toutes';
      if (portee !== 'toutes'
        && (!Array.isArray(portee) || !portee.includes(idSession))) return false;
      courant = this.parentDe(courant.id);
    }
    return true;
  }

  /* --------------------------------------------------------- sérialisation */

  serialiser() {
    return {
      version: this.version,
      sessionReference: this.sessionReference,
      racine: structuredClone(this.racine),
      medias: structuredClone(this.medias),
    };
  }

  static deserialiser(donnees) {
    return new DocumentAnnotation(structuredClone(donnees));
  }
}
