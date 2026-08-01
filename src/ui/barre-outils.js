// The tool rail, pinned to the inner edge of the right-hand panel.
//
// It stays put when the panel folds away, so annotating full screen is
// possible. « Naviguer » is deliberately the tool selected on load: a visitor
// who clicks the specimen must turn it, never mark it.
//
// Settings panels behave like menus, and there are two kinds of menu because
// there are two kinds of pointer:
//
//   • with a mouse or a pen, the panel follows the hover — it appears while
//     the pointer is on the tool or on the panel itself, and goes away
//     otherwise, including for the tool currently in use;
//   • with a finger there is no hover at all, so the panel is pinned open by
//     the tap that selects the tool, and closed by a tap anywhere else.
//
// Without the second rule the settings are simply unreachable on a tablet,
// which is how they were.

const ICONES = {
  naviguer: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3 15.5 9.2 10.4 10.6 8.3 15.6Z"/></svg>',
  epingle: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.6a4.6 4.6 0 0 0-4.6 4.6c0 3.4 4.6 10.2 4.6 10.2s4.6-6.8 4.6-10.2A4.6 4.6 0 0 0 10 2.6Z"/><circle cx="10" cy="7.2" r="1.7"/></svg>',
  pinceau: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 3.4a1.7 1.7 0 0 0-2.4 0L7.9 8.9l2.6 2.6 5.5-5.5a1.7 1.7 0 0 0-.2-2.6Z"/><path d="M7.4 10.2c-1.5 0-2.7 1.2-2.7 2.7 0 1-.6 1.8-1.4 2.3 1 .9 2.2 1.4 3.5 1.4 1.9 0 3.4-1.5 3.4-3.4 0-1.5-1.2-3-2.8-3Z"/></svg>',
  gomme: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.2 16.4h8.3"/><path d="m3.9 12.6 5-5a1.6 1.6 0 0 1 2.3 0l3.4 3.4a1.6 1.6 0 0 1 0 2.3l-3.1 3.1H7.2l-3.3-3.3a1.6 1.6 0 0 1 0-2.3Z"/><path d="m7.6 9 5.7 5.7"/></svg>',
  baguette: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.2 16.8 12 8l-.8-.8-8.8 8.8Z"/><path d="M13.4 3v2.6M17.6 5.1 15.8 7M18 10.4h-2.6M9.6 3.4 11 5.3"/></svg>',
  lasso: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.4c3.9 0 7 2 7 4.6s-3.1 4.6-7 4.6-7-2-7-4.6S6.1 3.4 10 3.4Z"/><path d="M7 12.3c-.5 1.4-.2 2.6.6 3.3.9.8 1.5.2 1.2-.6-.2-.7-1-.9-1.6-.3"/></svg>',
  mesure: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.2 12.4 12.4 3.2l4.4 4.4-9.2 9.2z"/><path d="M6.1 9.6 7.6 11.1M8.5 7.2 10 8.7M10.9 4.8l1.5 1.5"/></svg>',
};

export const OUTILS = [
  { nom: 'naviguer', libelle: 'Naviguer', touche: 'v' },
  { nom: 'epingle', libelle: 'Annotation', touche: 'a' },
  { nom: 'pinceau', libelle: 'Pinceau', touche: 'b' },
  { nom: 'gomme', libelle: 'Gomme', touche: 'e' },
  { nom: 'baguette', libelle: 'Baguette magique', touche: 'w' },
  { nom: 'lasso', libelle: 'Lasso', touche: 'l' },
  { nom: 'mesure', libelle: 'Mesure', touche: 'm' },
];

const DELAI_FERMETURE = 220;

export class BarreOutils {
  constructor(conteneur, options = {}) {
    this.conteneur = conteneur;
    this.surChangement = options.surChangement ?? null;
    this.panneaux = options.panneaux ?? {};
    this.actif = 'naviguer';
    this.boutons = new Map();
    this.survole = null;
    // Pinned panels stay put: no hover means no way to close them by leaving.
    this.epingle = false;
    this._minuteur = null;
    document.body.dataset.outil = this.actif;

    for (const outil of OUTILS) {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'outil';
      bouton.innerHTML = ICONES[outil.nom] ?? '';
      bouton.title = `${outil.libelle} (${outil.touche.toUpperCase()})`;
      bouton.dataset.tooltip = outil.libelle;
      bouton.dataset.raccourci = outil.touche.toUpperCase();
      bouton.setAttribute('aria-label', outil.libelle);
      bouton.setAttribute('aria-keyshortcuts', outil.touche);
      bouton.setAttribute('aria-pressed', String(outil.nom === this.actif));

      bouton.addEventListener('pointerdown', (e) => { this._tactile = e.pointerType === 'touch'; });
      bouton.addEventListener('click', () => {
        const dejaActif = this.actif === outil.nom;
        this.choisir(outil.nom);
        // On a touch screen the tap that picks the tool also opens its
        // settings; tapping the same tool again puts them away.
        if (!this._tactile) return;
        if (dejaActif && this.survole === outil.nom) this.fermerPanneau();
        else this.montrerPanneau(outil.nom, bouton, true);
      });
      bouton.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        this.montrerPanneau(outil.nom, bouton);
      });
      bouton.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') return;
        this.planifierFermeture();
      });
      bouton.addEventListener('focus', () => this.montrerPanneau(outil.nom, bouton));

      conteneur.appendChild(bouton);
      this.boutons.set(outil.nom, bouton);
    }

    for (const panneau of new Set(Object.values(this.panneaux))) {
      if (!panneau) continue;
      panneau.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        clearTimeout(this._minuteur);
      });
      panneau.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') return;
        this.planifierFermeture();
      });
    }

    // A pinned panel closes on a tap outside it. Capture phase, so it still
    // works when the tap lands on something that stops propagation.
    document.addEventListener('pointerdown', (e) => {
      if (!this.epingle || !this.survole) return;
      const panneau = this.panneaux[this.survole];
      if (panneau?.contains(e.target) || this.conteneur.contains(e.target)) return;
      this.fermerPanneau();
    }, true);

    window.addEventListener('keydown', (evenement) => {
      const cible = evenement.target;
      if (cible instanceof HTMLInputElement || cible instanceof HTMLTextAreaElement
        || cible instanceof HTMLSelectElement || cible?.isContentEditable) return;
      if (evenement.ctrlKey || evenement.metaKey || evenement.altKey) return;

      const outil = OUTILS.find((o) => o.touche === evenement.key.toLowerCase());
      if (outil) this.choisir(outil.nom);
      if (evenement.key === 'Escape') this.choisir('naviguer');
    });
  }

  choisir(nom) {
    if (!this.boutons.has(nom) || nom === this.actif) return;
    this.actif = nom;
    for (const [cle, bouton] of this.boutons) {
      bouton.setAttribute('aria-pressed', String(cle === nom));
    }
    document.body.dataset.outil = nom;
    this.surChangement?.(nom);
  }

  /* ------------------------------------------------------------ panneaux */

  montrerPanneau(nom, bouton, epingler = false) {
    clearTimeout(this._minuteur);
    if (this.survole && this.panneaux[this.survole] !== this.panneaux[nom]) {
      this._masquer(this.survole);
    }

    const panneau = this.panneaux[nom];
    if (!panneau) { this.survole = null; this.epingle = false; return; }

    panneau.hidden = false;
    this.survole = nom;
    this.epingle = epingler;
    this._placer(panneau, bouton);
  }

  // Vertically centred on its tool, then nudged back inside the window. On a
  // short window the panel is taller than the space beside the rail, so it is
  // allowed to scroll rather than to run off the bottom.
  _placer(panneau, bouton) {
    const boite = bouton.getBoundingClientRect();
    const marge = 8;
    const disponible = window.innerHeight - marge * 2;
    panneau.style.maxHeight = `${disponible}px`;

    const hauteur = Math.min(panneau.offsetHeight, disponible);
    const haut = Math.min(
      Math.max(marge, boite.top + boite.height / 2 - hauteur / 2),
      window.innerHeight - hauteur - marge,
    );
    panneau.style.top = `${haut}px`;
    panneau.style.right = `${window.innerWidth - boite.left + marge}px`;
  }

  planifierFermeture() {
    if (this.epingle) return;
    clearTimeout(this._minuteur);
    // Long enough to cross the gap between the rail and the panel.
    this._minuteur = setTimeout(() => this.fermerPanneau(), DELAI_FERMETURE);
  }

  fermerPanneau() {
    clearTimeout(this._minuteur);
    if (this.survole) this._masquer(this.survole);
    this.survole = null;
    this.epingle = false;
  }

  _masquer(nom) {
    const panneau = this.panneaux[nom];
    if (panneau) panneau.hidden = true;
  }

  rafraichirPanneau() {
    if (!this.survole) return;
    const panneau = this.panneaux[this.survole];
    const bouton = this.boutons.get(this.survole);
    if (panneau && bouton) this._placer(panneau, bouton);
  }
}
