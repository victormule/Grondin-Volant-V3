// Which object is open, and where its files live.
//
// The site used to serve one specimen, and five paths were written into as
// many modules — the sessions list, the published document, the media folder,
// the alignment residuals, the draft key. Generalising to a catalogue is
// mostly the work of gathering them here, resolved once at start-up from the
// object's manifest, before anything else runs. See amorce.js.
//
// Nothing in this module is a setting. Settings live in reglages.js and are
// merged from the manifest's `reglages` block; this is identity and location.

// Filled by `definirObjet` before app.js is imported. Read-only afterwards:
// changing object means reloading the page, which is the only way to be sure
// no atlas, mesh analysis or draft from the previous one is left behind.
export const objet = {
  id: null,
  nom: '',

  // The coordinate frame this object's stored coordinates belong to.
  //
  // Everything in a document — pin positions, brush dabs, measurement points —
  // is a coordinate in the capture's own frame. Moving that frame (redressing
  // a mesh, re-baking an alignment) silently puts every older annotation
  // somewhere it was never placed: a pin on the eye lands in mid-air, and
  // nothing about it looks wrong enough to notice.
  //
  // So each object names its frame, and a document that does not match is
  // refused rather than drawn. Bump the string in objet.json whenever that
  // object's geometry moves. Per object, because redressing one cadre has no
  // bearing on what was annotated on another.
  repere: null,

  racine: '',
  sessions: [],
  chemins: { annotations: '', medias: '', recalage: '' },
};

// The catalogue entry the user picked, plus its manifest. Paths in the
// manifest are relative to the object's own folder, so a folder can be moved
// or renamed without editing anything inside it.
// Every object the site offers, in catalogue order. Filled at start-up and
// read by the object list in the left-hand panel.
export const catalogue = [];

export function definirCatalogue(entrees) {
  catalogue.length = 0;
  catalogue.push(...entrees);
  return catalogue;
}

export function definirObjet(id, manifeste) {
  const racine = `./objets/${id}`;
  objet.id = id;
  objet.nom = manifeste.nom ?? id;
  objet.repere = manifeste.repere ?? null;
  objet.racine = racine;
  objet.sessions = (manifeste.sessions ?? []).map((session) => ({
    ...session,
    glb: `${racine}/${session.glb}`,
  }));
  objet.chemins.annotations = `${racine}/annotations/annotations.json`;
  objet.chemins.medias = `${racine}/annotations`;
  objet.chemins.recalage = manifeste.recalage
    ? `${racine}/${manifeste.recalage}`
    : null;
  return objet;
}
