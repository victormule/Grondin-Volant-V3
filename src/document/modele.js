// The annotation document: a tree of layers, and nothing else.
//
// One document per specimen, not per session. The three captures were aligned
// onto session 1, so a layer authored on one of them is geometrically valid on
// the others — which is the whole point of annotating this project. A layer can
// still be pinned to particular captures through its `portee`.

// Which coordinate frame the stored coordinates belong to.
//
// Everything in a document — pin positions, brush dabs, measurement points — is
// a coordinate in the captures' own frame. Redressing the meshes so the plinth
// sits level moved that frame, which silently puts every older annotation
// somewhere it was never placed: a pin on the eye lands in mid-air, and nothing
// about it looks wrong enough to notice.
//
// So a document carries the name of the frame it was written in, and one that
// does not match this build is refused rather than drawn. Bump this string
// whenever the geometry is moved again.
export const REPERE = 'socle-net-2026-08';

// Version 2 is the one where an annotation became a layer of its own, and where
// every element says what it is instead of relying on its layer's type to say
// it. `migrer` below walks a version 1 document up to it, once, on load.
export const VERSION = 3;

// The project record: what the document IS, as opposed to what it observes.
//
// A condition report is worth exactly what its header is worth. « Fissure du
// rayon III, probable » means nothing on its own — it means something once you
// know which specimen, held where, examined by whom, when, by what method and
// to what end. That is the difference between an observation and a record, and
// it is the part that is still true in twenty years when nobody involved is
// reachable.
//
// The fields below are grouped by the question a reader asks, not by type:
// what the thing is, why it was looked at, who looked, when and where, and how.
// The « how » is the one people skip and the one that decides whether a figure
// can be trusted at all — a length is a claim about a scale, and a scale is a
// claim about a method.
export function creerProjet() {
  return {
    titre: '',
    objectif: '',
    commanditaire: '',
    objet: {
      designation: '',
      taxon: '',
      inventaire: '',
      materiaux: '',
      dimensions: '',
      conservation: '',
    },
    intervenants: [],
    campagne: { lieu: '', debut: '', fin: '' },
    methode: { technique: '', materiel: '', logiciels: '', echelle: '' },
    references: '',
    cree: new Date().toISOString(),
    modifie: null,
  };
}

// Whether anything has actually been written. Used to nag gently rather than
// to block: a document with no header is legitimate while you work, and a
// problem the moment you hand it to someone else.
export function projetRenseigne(projet) {
  if (!projet) return false;
  const plein = (valeur) => String(valeur ?? '').trim().length > 0;
  return plein(projet.titre) || plein(projet.objectif) || plein(projet.commanditaire)
    || plein(projet.references)
    || Object.values(projet.objet ?? {}).some(plein)
    || Object.values(projet.campagne ?? {}).some(plein)
    || Object.values(projet.methode ?? {}).some(plein)
    || (projet.intervenants ?? []).some((p) => plein(p.nom));
}

// What a single piece of content IS, independently of the layer holding it.
//
// Layers hold one kind each — that is what makes them readable — but knowing
// the kind from the element rather than from the layer is what lets a layer be
// described, measured and drawn by asking what is actually in it. A layer whose
// type says « peinture » and which holds nothing is not a paint layer in any
// useful sense, and this is the field that lets everything downstream say so.
// These used to carry an `icone` each — ◍ ⬢ ↔ ◉ — which is how the panel, the
// card and the labels drew a layer's kind. Unicode geometry does not survive
// eleven pixels: ◍ and ◉ are the same pierced disc there. The marks are drawn
// shapes now and live in ../ui/glyphes.js; what a kind is CALLED still belongs
// here, next to what it means.
export const GENRES = {
  trace: { libelle: 'Peinture', type: 'peinture' },
  region: { libelle: 'Région', type: 'region' },
  mesure: { libelle: 'Mesure', type: 'mesure' },
  epingle: { libelle: 'Annotation', type: 'annotation' },
};

export const TYPES_CALQUE = {
  groupe: { libelle: 'Groupe', contenant: true },
  annotation: { libelle: 'Annotation', genre: 'epingle' },
  peinture: { libelle: 'Peinture', genre: 'trace' },
  region: { libelle: 'Région', genre: 'region' },
  mesure: { libelle: 'Mesure', genre: 'mesure' },
  contour: { libelle: 'Contour', genre: 'region' },
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

/* ------------------------------------------------------------------ fiches */

// The descriptive payload of a layer.
//
// It used to be carried both by a pin and by a layer, which is precisely the
// confusion this version removes: a pin IS a layer now, so there is one card
// per described thing and it always hangs off the layer. The layer's name is
// its title — a card with a title of its own would let the panel say one name
// and the card another.
export function creerFiche() {
  return {
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
// whether a layer deserves a label in the view and a « described » marker in
// the panel: an empty card created by a stray click must not decorate either
// for ever.
export function ficheRenseignee(fiche) {
  if (!fiche) return false;
  return Boolean(fiche.texte?.trim() || fiche.auteur?.trim() || fiche.methode?.trim()
    || fiche.vue || fiche.medias?.length || fiche.proprietes?.some((p) => p.cle || p.valeur)
    || (fiche.nature && fiche.nature !== 'constat'));
}

/* ---------------------------------------------------------------- éléments */

// What an element is, read from the element itself. Documents written before
// version 2 have no `genre`, and their content is recognisable without one:
// dabs, faces, a polyline, a point on the surface. Inferring rather than
// requiring means a file that skipped the migration still draws correctly.
export function genreElement(element) {
  if (!element) return null;
  if (element.genre && element.genre in GENRES) return element.genre;
  if (Array.isArray(element.empreintes)) return 'trace';
  if (Array.isArray(element.faces)) return 'region';
  if (Array.isArray(element.points)) return 'mesure';
  if (Array.isArray(element.position)) return 'epingle';
  return null;
}

export function elementsDuGenre(calque, genre) {
  const elements = calque?.donnees?.elements;
  if (!elements) return [];
  return elements.filter((element) => genreElement(element) === genre);
}

export function calquePorte(calque, genre) {
  const elements = calque?.donnees?.elements;
  if (!elements) return false;
  return elements.some((element) => genreElement(element) === genre);
}

// Every kind of content a layer actually holds, in the order it first appears.
// An empty layer returns nothing, which is what makes « this layer draws
// something » a question with an answer.
export function genresDuCalque(calque) {
  const vus = [];
  for (const element of calque?.donnees?.elements ?? []) {
    const genre = genreElement(element);
    if (genre && !vus.includes(genre)) vus.push(genre);
  }
  return vus;
}

// What a layer should be called and iconed. Its content answers first: a layer
// is what it holds, and its declared type only speaks for one that is still
// empty — the moment between a tool being aimed and its first gesture.
export function typeAffiche(calque) {
  if (calque.type === 'groupe') return TYPES_CALQUE.groupe;
  const genres = genresDuCalque(calque);
  if (genres.length >= 1) return GENRES[genres[0]];
  return TYPES_CALQUE[calque.type] ?? TYPES_CALQUE.annotation;
}

const COULEURS = ['#c9553d', '#d99a35', '#4f9066', '#3d7ab8', '#8360b8', '#b8508a'];

let compteurCouleur = 0;

export function identifiant() {
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
    // Whether this layer speaks for itself in the view. Every kind of layer can
    // carry a label now, so every kind needs a way to be quiet: a document with
    // forty measured zones is unreadable if all forty insist on a name.
    etiquette: true,
    fiche: null,
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
    genre: 'mesure',
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
//
// It carries geometry and nothing else. What is said about it lives in the card
// of the layer that holds it, because that layer IS the annotation: one pin,
// one row in the panel, one card. The old shape — a pin with its own title,
// text, nature and media, nested inside a layer that also had a name — meant
// two titles for one thing and a panel in which « Annotations » and « an
// annotation » were different rows at different depths.
export function creerEpingle(position, normale, session = null) {
  return {
    id: identifiant(),
    genre: 'epingle',
    position: [position.x, position.y, position.z],
    normale: [normale.x, normale.y, normale.z],
    session,
  };
}

/* --------------------------------------------------------------- migration */

// The fields a version 1 pin carried inline, lifted out into a card.
function ficheDepuisEpingle(epingle) {
  const fiche = normaliserFiche({
    texte: epingle.texte,
    nature: epingle.nature,
    confiance: epingle.confiance,
    methode: epingle.methode,
    auteur: epingle.auteur,
    medias: epingle.medias,
    proprietes: epingle.proprietes,
    vue: epingle.vue,
    cree: epingle.cree,
    modifie: epingle.modifie,
  });
  return ficheRenseignee(fiche) || epingle.titre?.trim() ? fiche : null;
}

function epingleNue(epingle) {
  return {
    id: epingle.id ?? identifiant(),
    genre: 'epingle',
    position: epingle.position,
    normale: epingle.normale,
    session: epingle.session ?? null,
  };
}

function calqueDepuisEpingle(epingle, modele, nom) {
  const calque = creerCalque('annotation', nom);
  calque.id = identifiant();
  calque.couleur = modele.couleur;
  calque.visible = modele.visible !== false;
  calque.verrouille = modele.verrouille === true;
  calque.opacite = modele.opacite ?? 1;
  calque.portee = modele.portee ?? 'toutes';
  calque.fiche = ficheDepuisEpingle(epingle);
  calque.donnees.elements = [epingleNue(epingle)];
  return calque;
}

// One layer per annotation, and every element told what it is.
//
// Returns the replacement for `calque`, or null when it holds nothing at all —
// an empty annotation layer is exactly the clutter this version set out to
// remove, and it cannot be recreated by hand any more.
function migrerCalque(calque) {
  calque.etiquette = calque.etiquette !== false;
  calque.fiche = calque.fiche ?? null;

  if (calque.enfants) {
    calque.enfants = calque.enfants.map(migrerCalque).filter(Boolean);
    return calque;
  }

  const elements = calque.donnees?.elements ?? [];
  for (const element of elements) {
    const genre = genreElement(element);
    if (genre) element.genre = genre;
  }

  if (calque.type !== 'annotation') return calque;

  const epingles = elements.filter((element) => genreElement(element) === 'epingle');
  if (epingles.length === 0) return ficheRenseignee(calque.fiche) ? calque : null;

  if (epingles.length === 1) {
    const epingle = epingles[0];
    const titre = String(epingle.titre ?? '').trim();
    if (titre) calque.nom = titre;
    calque.fiche = calque.fiche ?? ficheDepuisEpingle(epingle);
    calque.donnees.elements = [epingleNue(epingle)];
    return calque;
  }

  // Several pins under one name: the name was the entity, the pins were its
  // facets. That is what a group says, so it becomes one — and each pin becomes
  // the annotation it always was.
  const groupe = creerCalque('groupe', calque.nom);
  groupe.id = calque.id;
  groupe.couleur = calque.couleur;
  groupe.visible = calque.visible !== false;
  groupe.verrouille = calque.verrouille === true;
  groupe.opacite = calque.opacite ?? 1;
  groupe.portee = calque.portee ?? 'toutes';
  groupe.fiche = calque.fiche ?? null;
  groupe.enfants = epingles.map((epingle, index) => calqueDepuisEpingle(
    epingle, calque, String(epingle.titre ?? '').trim() || `Annotation ${index + 1}`,
  ));
  return groupe;
}

export function migrer(donnees) {
  if (!donnees) return donnees;
  const version = donnees.version ?? 1;
  if (version >= VERSION) return donnees;

  // v1 → v2 : one annotation per layer, and a genre on every element. Gated on
  // the version rather than run unconditionally — replaying a layer conversion
  // on a document that has already had it is at best wasted work and at worst
  // a second pass over structures the first pass reshaped.
  if (version < 2) {
    const racine = donnees.racine ?? { id: 'racine', type: 'groupe', enfants: [] };
    racine.enfants = (racine.enfants ?? []).map(migrerCalque).filter(Boolean);
    donnees.racine = racine;
  }

  // v2 → v3 : the project record. Nothing to convert — a document written
  // before there was a header simply gets an empty one, which the constructor
  // fills in from `creerProjet()`.
  donnees.version = VERSION;
  return donnees;
}

/* ------------------------------------------------------------------ le doc */

export class DocumentAnnotation {
  constructor(donnees) {
    const migre = migrer(donnees);
    this.version = migre?.version ?? VERSION;
    this.repere = migre?.repere ?? null;
    this.sessionReference = migre?.sessionReference ?? null;
    this.racine = migre?.racine ?? { id: 'racine', type: 'groupe', enfants: [] };
    this.medias = migre?.medias ?? [];
    this.projet = { ...creerProjet(), ...(migre?.projet ?? {}) };
  }

  // An empty document is in whatever frame the build is in, so it always
  // matches; only stored coordinates can be stale.
  static frameCompatible(donnees) {
    if (!donnees) return false;
    if ((donnees.racine?.enfants?.length ?? 0) === 0) return true;
    return donnees.repere === REPERE;
  }

  static vide(sessionReference) {
    return new DocumentAnnotation({ sessionReference, version: VERSION });
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

  // Whether a layer is allowed to speak in the view. Switching a group off
  // silences everything under it, the same way hiding it does: a group is the
  // entity, and an entity that is not being shown has nothing to say.
  etiquetteEffective(id) {
    let calque = this.trouver(id);
    while (calque && calque !== this.racine) {
      if (calque.etiquette === false) return false;
      calque = this.parentDe(calque.id);
    }
    return true;
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

  // The outermost group a layer sits in — the top of the chain, not the group
  // immediately above it. A label three levels deep belongs, to a reader, to
  // the thing the whole branch is about; carrying the colour of the innermost
  // group instead meant two sibling labels of one entity wore different dots.
  groupeExterieur(id) {
    const chemin = this.chemin(id);
    const premier = chemin[0];
    if (!premier || premier.id === id || premier.type !== 'groupe') return null;
    return premier;
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
    for (const { calque } of this.aplatir()) {
      for (const propriete of calque.fiche?.proprietes ?? []) {
        const cle = String(propriete.cle ?? '').trim();
        if (!cle) continue;
        const unite = String(propriete.unite ?? '').trim();
        if (!cles.has(cle)) cles.set(cle, unite);
        else if (unite && !cles.get(cle)) cles.set(cle, unite);
      }
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
      version: VERSION,
      // Stamped, never copied: whatever was loaded, what is being written now
      // was authored against the geometry this build ships.
      repere: REPERE,
      sessionReference: this.sessionReference,
      racine: structuredClone(this.racine),
      medias: structuredClone(this.medias),
      projet: structuredClone(this.projet),
    };
  }

  static deserialiser(donnees) {
    return new DocumentAnnotation(structuredClone(donnees));
  }
}
