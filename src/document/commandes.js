// Undo stack. Every change to the document goes through here — that is the
// promise the panel rests on: nothing a visitor does is destructive, because
// everything can be walked back.

export class PileCommandes {
  constructor(limite = 200) {
    this.limite = limite;
    this.passe = [];
    this.futur = [];
    this.auditeurs = new Set();
  }

  ecouter(fn) {
    this.auditeurs.add(fn);
    return () => this.auditeurs.delete(fn);
  }

  _prevenir() {
    for (const fn of this.auditeurs) fn(this);
  }

  // A command is { nom, faire, defaire }. `faire` runs immediately.
  executer(commande) {
    commande.faire();
    this.passe.push(commande);
    if (this.passe.length > this.limite) this.passe.shift();
    this.futur.length = 0;
    this._prevenir();
  }

  annuler() {
    const commande = this.passe.pop();
    if (!commande) return false;
    commande.defaire();
    this.futur.push(commande);
    this._prevenir();
    return true;
  }

  retablir() {
    const commande = this.futur.pop();
    if (!commande) return false;
    commande.faire();
    this.passe.push(commande);
    this._prevenir();
    return true;
  }

  get nomAnnulation() {
    return this.passe.at(-1)?.nom ?? null;
  }

  get nomRetablissement() {
    return this.futur.at(-1)?.nom ?? null;
  }

  vider() {
    this.passe.length = 0;
    this.futur.length = 0;
    this._prevenir();
  }
}

// Snapshot command: records the document before and after `mutation`, and
// restores whichever side is needed.
//
// Wasteful in principle, exact in practice, and at this scale — a few dozen
// layers of metadata — a snapshot costs nothing. Painting will need finer
// commands (one snapshot per brush stroke would not do), which is why the
// stack above takes any { faire, defaire } pair rather than only these.
export function commandeInstantane(document_, nom, mutation) {
  const avant = document_.serialiser();
  mutation();
  const apres = document_.serialiser();

  const restaurer = (etat) => {
    const copie = structuredClone(etat);
    document_.version = copie.version;
    document_.sessionReference = copie.sessionReference;
    document_.racine = copie.racine;
    document_.medias = copie.medias;
  };

  return {
    nom,
    faire: () => restaurer(apres),
    defaire: () => restaurer(avant),
  };
}
