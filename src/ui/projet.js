// The project record.
//
// Everything else in this application describes a spot on a specimen. This
// describes the work itself — and it is the part that decides whether any of
// the rest can be believed later. « Fissure du rayon III, probable » is not a
// finding until you know which specimen, held where, examined by whom, when,
// how and to what end. Twenty years on, that header is the only thing left
// that can answer those questions, because nobody involved will be reachable.
//
// THREE DECISIONS SHAPE THIS SCREEN.
//
// It opens over the view rather than in a panel. Filling a dossier is a mode of
// its own: you stop looking at the specimen and you look at the record. A panel
// wide enough for a paragraph of objectives would have to steal the view
// anyway, and a panel narrow enough not to would turn twenty fields into a
// hundred lines of scrolling.
//
// It is not the layer card. The card was hard-won ground — one subject, one
// statement — and pouring the project header into it would put « this is a
// crack » and « this is a museum » in the same box under the same title. They
// are different kinds of claim and they get different furniture.
//
// And part of it cannot be typed. The frame stamp, the scale and its
// calibration, the session times, the counts: the application knows them
// exactly, and a field a machine can fill is a field a human can get wrong.
// Those sit at the bottom, greyed, stated rather than asked.


// The fields without which a record cannot be traced back to anything. Not the
// ones that matter most to read — the ones whose absence makes the rest
// unusable, which is a different list and a shorter one.
const ESSENTIELS = [
  ['titre', (p) => p.titre],
  ['objectif', (p) => p.objectif],
  ['designation', (p) => p.objet?.designation],
  ['conservation', (p) => p.objet?.conservation],
  ['intervenant', (p) => (p.intervenants ?? []).some((i) => String(i.nom ?? '').trim())],
  ['lieu', (p) => p.campagne?.lieu],
  ['date', (p) => p.campagne?.debut],
  ['technique', (p) => p.methode?.technique],
];

const ROLES = [
  'Responsable scientifique', 'Conservateur-restaurateur', 'Opérateur',
  'Photographe', 'Régisseur', 'Commanditaire',
];

const rempli = (valeur) => (typeof valeur === 'boolean'
  ? valeur
  : String(valeur ?? '').trim().length > 0);

export class FicheProjet {
  constructor(hote, options = {}) {
    this.hote = hote;
    // Loading a document REPLACES the DocumentAnnotation instance rather than
    // filling the old one, so holding a reference here would leave this screen
    // editing a document nobody else can see. It asks for the current one every
    // time instead.
    this._document = options.document;
    this.surMutation = options.surMutation ?? ((nom, mutation) => mutation());
    // A function, not a value: the facts change as sessions load and as layers
    // are added, and this screen must never show a stale one.
    this.faits = options.faits ?? (() => []);
    this.ouverte = false;
    this.sectionsOuvertes = new Set(['projet', 'objet']);

    hote.addEventListener('click', (evenement) => {
      if (evenement.target === hote) this.fermer();
    });
  }

  get doc() {
    return typeof this._document === 'function' ? this._document() : this._document;
  }

  get projet() {
    return this.doc.projet;
  }

  basculer() {
    if (this.ouverte) this.fermer();
    else this.ouvrir();
  }

  ouvrir() {
    this.ouverte = true;
    this.hote.hidden = false;
    this.rendre();
    // The title first: on an empty record it is the field everything else
    // hangs off, and on a filled one it is what you came to check.
    this.hote.querySelector('.projet-titre')?.focus();
  }

  fermer() {
    this.ouverte = false;
    this.hote.hidden = true;
    this.surFermeture?.();
  }

  // Commits a single field. One undo entry per field rather than per keystroke,
  // which is why every input commits on `change` and not on `input`.
  _ecrire(nomAction, appliquer) {
    this.surMutation(nomAction, () => {
      appliquer(this.doc.projet);
      this.doc.projet.modifie = new Date().toISOString();
    });
    this._majJauge();
  }

  /* ------------------------------------------------------------- rendu */

  rendre() {
    if (!this.ouverte) return;
    const feuille = document.createElement('div');
    feuille.className = 'projet-feuille';
    feuille.setAttribute('role', 'dialog');
    feuille.setAttribute('aria-modal', 'true');
    feuille.setAttribute('aria-label', 'Fiche du projet');

    feuille.append(this._entete(), this._corps());
    this.hote.replaceChildren(feuille);
  }

  _entete() {
    const entete = document.createElement('header');
    entete.className = 'projet-entete';

    const groupe = document.createElement('div');
    groupe.className = 'projet-identite';

    const surtitre = document.createElement('span');
    surtitre.className = 'projet-surtitre';
    surtitre.textContent = 'Fiche du projet';

    const titre = document.createElement('input');
    titre.className = 'projet-titre';
    titre.type = 'text';
    titre.value = this.projet.titre ?? '';
    titre.placeholder = 'Intitulé de l’étude';
    titre.setAttribute('aria-label', 'Intitulé du projet');
    titre.addEventListener('change', () => {
      this._ecrire('Intitulé du projet', (p) => { p.titre = titre.value.trim(); });
    });

    groupe.append(surtitre, titre);

    const fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'projet-fermer';
    fermer.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    fermer.title = 'Fermer (Échap)';
    fermer.setAttribute('aria-label', 'Fermer la fiche du projet');
    fermer.addEventListener('click', () => this.fermer());

    entete.append(groupe, this._jauge(), fermer);
    return entete;
  }

  // How much of the record can be traced. Shown as a count and a ring rather
  // than as a warning: an unfinished header is normal while you work and only
  // becomes a problem when the document leaves your hands.
  _jauge() {
    const jauge = document.createElement('div');
    jauge.className = 'projet-jauge';
    jauge.appendChild(Object.assign(document.createElement('span'),
      { className: 'projet-jauge-anneau' }));
    jauge.appendChild(Object.assign(document.createElement('span'),
      { className: 'projet-jauge-texte' }));
    this._jaugeElement = jauge;
    this._majJauge(jauge);
    return jauge;
  }

  _majJauge(jauge = this._jaugeElement) {
    if (!jauge) return;
    const projet = this.projet;
    const faits = ESSENTIELS.filter(([, lire]) => rempli(lire(projet))).length;
    const part = faits / ESSENTIELS.length;
    jauge.style.setProperty('--part', String(part));
    jauge.querySelector('.projet-jauge-texte').textContent = `${faits}/${ESSENTIELS.length}`;
    jauge.dataset.complet = String(faits === ESSENTIELS.length);
    jauge.title = faits === ESSENTIELS.length
      ? 'Tous les repères essentiels sont renseignés.'
      : `${ESSENTIELS.length - faits} repère(s) essentiel(s) manquant(s) : `
        + ESSENTIELS.filter(([, lire]) => !rempli(lire(projet)))
          .map(([nom]) => nom).join(', ');
  }

  _corps() {
    const corps = document.createElement('div');
    corps.className = 'projet-corps';
    corps.append(
      this._bloc('projet', 'Le projet', 'Pourquoi cette étude a été faite', [
        this._zone('Objectif', this.projet.objectif,
          'Ce que l’examen cherchait à établir.',
          (v) => this._ecrire('Objectif', (p) => { p.objectif = v; })),
        this._grille([
          this._champ('Commanditaire', this.projet.commanditaire, 'Institution, service…',
            (v) => this._ecrire('Commanditaire', (p) => { p.commanditaire = v; })),
        ]),
      ]),

      this._bloc('objet', 'L’objet', 'Ce dont il est question', [
        this._grille([
          this._champ('Désignation', this.projet.objet.designation, 'Nom de l’objet',
            (v) => this._ecrire('Désignation', (p) => { p.objet.designation = v; })),
          this._champ('Taxon / attribution', this.projet.objet.taxon, 'Dactylopterus volitans',
            (v) => this._ecrire('Taxon', (p) => { p.objet.taxon = v; })),
          this._champ('N° d’inventaire', this.projet.objet.inventaire, 'MNHN-…',
            (v) => this._ecrire('Numéro d’inventaire', (p) => { p.objet.inventaire = v; })),
          this._champ('Matériaux', this.projet.objet.materiaux, 'Spécimen naturalisé, socle bois',
            (v) => this._ecrire('Matériaux', (p) => { p.objet.materiaux = v; })),
          this._champ('Dimensions', this.projet.objet.dimensions, 'L × l × h',
            (v) => this._ecrire('Dimensions', (p) => { p.objet.dimensions = v; })),
          this._champ('Lieu de conservation', this.projet.objet.conservation,
            'Établissement, salle, réserve',
            (v) => this._ecrire('Lieu de conservation', (p) => { p.objet.conservation = v; })),
        ]),
      ]),

      this._bloc('intervenants', 'Les intervenants', 'Qui a fait quoi',
        [this._intervenants()]),

      this._bloc('campagne', 'La campagne', 'Où et quand', [
        this._grille([
          this._champ('Lieu de la prise de vue', this.projet.campagne.lieu,
            'Salle, atelier, site',
            (v) => this._ecrire('Lieu de la campagne', (p) => { p.campagne.lieu = v; })),
          this._champ('Début', this.projet.campagne.debut, '',
            (v) => this._ecrire('Début de campagne', (p) => { p.campagne.debut = v; }), 'date'),
          this._champ('Fin', this.projet.campagne.fin, '',
            (v) => this._ecrire('Fin de campagne', (p) => { p.campagne.fin = v; }), 'date'),
        ]),
      ]),

      // The block people skip, and the one that decides whether a figure in
      // this document means anything. A length is a claim about a scale, and a
      // scale is a claim about a method.
      this._bloc('methode', 'La méthode', 'Comment les mesures ont été obtenues', [
        this._grille([
          this._champ('Technique', this.projet.methode.technique,
            'Photogrammétrie, lasergrammétrie…',
            (v) => this._ecrire('Technique', (p) => { p.methode.technique = v; })),
          this._champ('Matériel', this.projet.methode.materiel, 'Boîtier, objectif, éclairage',
            (v) => this._ecrire('Matériel', (p) => { p.methode.materiel = v; })),
          this._champ('Logiciels', this.projet.methode.logiciels, 'Acquisition, traitement',
            (v) => this._ecrire('Logiciels', (p) => { p.methode.logiciels = v; })),
        ]),
        this._zone('Note sur l’échelle et les incertitudes', this.projet.methode.echelle,
          'Comment la mise à l’échelle a été établie, et ce qu’elle vaut.',
          (v) => this._ecrire('Note d’échelle', (p) => { p.methode.echelle = v; })),
      ]),

      this._bloc('references', 'Références', 'Documents liés', [
        this._zone('Bibliographie et pièces jointes', this.projet.references,
          'Une entrée par ligne.',
          (v) => this._ecrire('Références', (p) => { p.references = v; })),
      ]),

      this._faits(),
    );
    return corps;
  }

  /* ------------------------------------------------------------ briques */

  _bloc(cle, titre, sous, contenus) {
    const bloc = document.createElement('details');
    bloc.className = 'projet-bloc';
    bloc.open = this.sectionsOuvertes.has(cle);
    bloc.addEventListener('toggle', () => {
      if (bloc.open) this.sectionsOuvertes.add(cle);
      else this.sectionsOuvertes.delete(cle);
    });

    const resume = document.createElement('summary');
    resume.className = 'projet-bloc-titre';
    const nom = document.createElement('span');
    nom.textContent = titre;
    const aide = document.createElement('span');
    aide.className = 'projet-bloc-aide';
    aide.textContent = sous;
    resume.append(nom, aide);

    const corps = document.createElement('div');
    corps.className = 'projet-bloc-corps';
    corps.append(...contenus);

    bloc.append(resume, corps);
    return bloc;
  }

  _grille(champs) {
    const grille = document.createElement('div');
    grille.className = 'projet-grille';
    grille.append(...champs);
    return grille;
  }

  _champ(etiquette, valeur, indice, surValidation, type = 'text', liste = null) {
    const bloc = document.createElement('label');
    bloc.className = 'projet-champ';

    const nom = document.createElement('span');
    nom.className = 'projet-champ-nom';
    nom.textContent = etiquette;

    const saisie = document.createElement('input');
    saisie.type = type;
    saisie.value = valeur ?? '';
    saisie.placeholder = indice;
    if (liste) saisie.setAttribute('list', liste);
    saisie.addEventListener('change', () => surValidation(saisie.value.trim()));

    bloc.append(nom, saisie);
    return bloc;
  }

  _zone(etiquette, valeur, indice, surValidation) {
    const bloc = document.createElement('label');
    bloc.className = 'projet-champ projet-champ-large';

    const nom = document.createElement('span');
    nom.className = 'projet-champ-nom';
    nom.textContent = etiquette;

    const saisie = document.createElement('textarea');
    saisie.rows = 3;
    saisie.value = valeur ?? '';
    saisie.placeholder = indice;
    saisie.addEventListener('change', () => surValidation(saisie.value.trim()));

    bloc.append(nom, saisie);
    return bloc;
  }

  // A list rather than an « author » field: an examination is rarely one
  // person, and « who did what » is exactly the question a later reader has.
  _intervenants() {
    const bloc = document.createElement('div');
    bloc.className = 'projet-intervenants';

    const liste = document.createElement('datalist');
    liste.id = 'projetRoles';
    for (const role of ROLES) {
      liste.appendChild(Object.assign(document.createElement('option'), { value: role }));
    }
    bloc.appendChild(liste);

    (this.projet.intervenants ?? []).forEach((intervenant, index) => {
      const ligne = document.createElement('div');
      ligne.className = 'projet-intervenant';

      const nom = document.createElement('input');
      nom.type = 'text';
      nom.value = intervenant.nom ?? '';
      nom.placeholder = 'Nom';
      nom.setAttribute('aria-label', `Nom de l’intervenant ${index + 1}`);
      nom.addEventListener('change', () => {
        this._ecrire('Intervenant', (p) => { p.intervenants[index].nom = nom.value.trim(); });
      });

      const role = document.createElement('input');
      role.type = 'text';
      role.value = intervenant.role ?? '';
      role.placeholder = 'Rôle';
      role.setAttribute('list', 'projetRoles');
      role.setAttribute('aria-label', `Rôle de l’intervenant ${index + 1}`);
      role.addEventListener('change', () => {
        this._ecrire('Rôle', (p) => { p.intervenants[index].role = role.value.trim(); });
      });

      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'projet-retirer';
      retirer.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      retirer.title = 'Retirer cet intervenant';
      retirer.setAttribute('aria-label', 'Retirer cet intervenant');
      retirer.addEventListener('click', () => {
        this._ecrire('Retirer un intervenant', (p) => { p.intervenants.splice(index, 1); });
        this.rendre();
      });

      ligne.append(nom, role, retirer);
      bloc.appendChild(ligne);
    });

    const ajouter = document.createElement('button');
    ajouter.type = 'button';
    ajouter.className = 'projet-ajouter';
    ajouter.textContent = '+ Ajouter un intervenant';
    ajouter.addEventListener('click', () => {
      this._ecrire('Ajouter un intervenant', (p) => {
        p.intervenants = [...(p.intervenants ?? []), { nom: '', role: '' }];
      });
      this.rendre();
      const lignes = this.hote.querySelectorAll('.projet-intervenant input');
      lignes[lignes.length - 2]?.focus();
    });
    bloc.appendChild(ajouter);

    return bloc;
  }

  // Stated, never asked. These are the things the application knows exactly —
  // the frame the coordinates were authored in, the scale every length went
  // through, what the sessions actually were. Offering them as fields would be
  // inviting a transcription error into the one part of the record that cannot
  // afford one.
  _faits() {
    const faits = this.faits() ?? [];
    if (faits.length === 0) return document.createDocumentFragment();

    const bloc = document.createElement('section');
    bloc.className = 'projet-bloc projet-bloc-faits';

    const titre = document.createElement('h2');
    titre.className = 'projet-bloc-titre';
    const nom = document.createElement('span');
    nom.textContent = 'Constaté par l’outil';
    const aide = document.createElement('span');
    aide.className = 'projet-bloc-aide';
    aide.textContent = 'Relevé automatiquement · non modifiable';
    titre.append(nom, aide);
    bloc.appendChild(titre);

    const table = document.createElement('dl');
    table.className = 'projet-faits';
    for (const fait of faits) {
      const cle = document.createElement('dt');
      cle.textContent = fait.cle;
      const valeur = document.createElement('dd');
      valeur.textContent = fait.valeur;
      if (fait.aide) {
        cle.title = fait.aide;
        valeur.title = fait.aide;
      }
      table.append(cle, valeur);
    }
    bloc.appendChild(table);
    return bloc;
  }
}
