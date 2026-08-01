// The brush: turns pointer movement into a stroke on the surface.
//
// A stroke is a list of dabs, each one a point and a normal in the shared
// frame with a radius in metres. Nothing here is in pixels — the stroke keeps
// its real width on the specimen whatever the zoom, and because the dabs are
// 3D the same stroke rasterises onto any of the three captures.

const ARRONDI = 100000;

// Screen distance between two samples along a movement, and the ceiling on how
// many a single pointer event may produce. A fast gesture can jump eighty
// pixels between two events; sampling only the endpoints would lay down a
// string of separate discs instead of a stroke.
const PAS_ECRAN = 4;
const PAS_MAX = 40;

function arrondir(valeur) {
  return Math.round(valeur * ARRONDI) / ARRONDI;
}

export class Pinceau {
  constructor(pointeur, atlas, config) {
    this.pointeur = pointeur;
    this.atlas = atlas;
    // config.peinture.taille is a diameter in millimetres; dabs work in metres.
    this.rayon = config.peinture.taille / 2000;
    this.durete = config.peinture.durete;
    this.seuilNormale = config.peinture.seuilNormale;
    this.espacement = config.peinture.espacement;

    this.trait = null;
    this.dernier = null;
    this.enAttente = [];
    this.efface = false;
  }

  get actif() {
    return this.trait !== null;
  }

  demarrer(x, y) {
    const touche = this.pointeur.surfaceSous(x, y);
    if (!touche) return false;

    this.trait = {
      id: crypto.randomUUID ? crypto.randomUUID() : 't-' + Math.random().toString(36).slice(2, 11),
      empreintes: [],
      durete: this.durete,
      seuilNormale: this.seuilNormale,
      efface: this.efface,
    };
    this.dernier = null;
    this.dernierEcran = { x, y };
    this.enAttente = [];
    this._ajouter(touche);
    return true;
  }

  // Walks the segment since the previous event, sampling the surface along the
  // way, then keeps only the dabs far enough apart — otherwise a slow hand
  // would pile hundreds of them on one spot and a fast one would leave gaps.
  continuer(x, y) {
    if (!this.trait) return;
    const depart = this.dernierEcran ?? { x, y };
    const dx = x - depart.x;
    const dy = y - depart.y;
    const pas = Math.max(1, Math.min(Math.ceil(Math.hypot(dx, dy) / PAS_ECRAN), PAS_MAX));

    for (let i = 1; i <= pas; i++) {
      const part = i / pas;
      const touche = this.pointeur.surfaceSous(depart.x + dx * part, depart.y + dy * part);
      // A gap in the mesh — between the fin rays, say — simply yields no dab.
      if (!touche) continue;
      if (this.dernier && touche.position.distanceTo(this.dernier) < this.rayon * this.espacement) continue;
      this._ajouter(touche);
    }

    this.dernierEcran = { x, y };
  }

  _ajouter(touche) {
    const empreinte = [
      arrondir(touche.position.x), arrondir(touche.position.y), arrondir(touche.position.z),
      arrondir(touche.normale.x), arrondir(touche.normale.y), arrondir(touche.normale.z),
      arrondir(this.rayon),
    ];
    this.trait.empreintes.push(empreinte);
    this.enAttente.push(empreinte);
    this.dernier = touche.position.clone();
  }

  // Called once per frame while drawing: only the new dabs reach the GPU.
  pousser() {
    if (!this.trait || this.enAttente.length === 0) return;
    this.atlas.ajouterEmpreintes(this.enAttente, {
      durete: this.durete,
      seuilNormale: this.seuilNormale,
      efface: this.efface,
    });
    this.enAttente = [];
  }

  terminer() {
    const trait = this.trait;
    this.annuler();
    return trait && trait.empreintes.length > 0 ? trait : null;
  }

  annuler() {
    this.trait = null;
    this.dernier = null;
    this.dernierEcran = null;
    this.enAttente = [];
  }
}
