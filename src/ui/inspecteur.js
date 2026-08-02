// Properties of the selected layer, at the foot of the right-hand panel.

import { TYPES_CALQUE, NATURES, CONFIANCES, ficheRenseignee } from '../document/modele.js';
import { creerPalette } from './palette.js';

export class Inspecteur {
  constructor(conteneur, {
    document: doc, surMutation, surApercu, sessions, couleurs, mesures, surConversionRegion,
    surLissageRegion, surOuvrirFiche, comparaison,
  }) {
    this.conteneur = conteneur;
    this.doc = doc;
    this.surMutation = surMutation;
    this.surApercu = surApercu;
    this.sessions = sessions || [];
    this.couleurs = couleurs || [];
    // Set by the application: what this layer measures, already formatted.
    // The inspector deliberately knows nothing about how it was obtained.
    this.mesures = mesures || null;
    // Same contract for the per-capture comparison: already computed, already
    // formatted, caveats included.
    this.comparaison = comparaison || null;
    this.surConversionRegion = surConversionRegion || null;
    this.surLissageRegion = surLissageRegion || null;
    this.surOuvrirFiche = surOuvrirFiche || null;
    this.sessionActive = null;
    this.id = null;
  }

  definirSessionActive(id) {
    this.sessionActive = id;
  }

  definirDocument(doc) {
    this.doc = doc;
    this.rendre();
  }

  definirSessions(sessions) {
    this.sessions = sessions;
    this.rendre();
  }

  afficher(id) {
    this.id = id;
    this.rendre();
  }

  rendre() {
    const calque = this.id ? this.doc.trouver(this.id) : null;
    this.conteneur.replaceChildren();

    if (!calque) {
      const vide = document.createElement('p');
      vide.className = 'inspecteur-vide';
      vide.textContent = 'Sélectionnez un calque pour voir ses propriétés.';
      this.conteneur.appendChild(vide);
      return;
    }

    const modele = TYPES_CALQUE[calque.type] || TYPES_CALQUE.annotation;

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = modele.libelle;
    this.conteneur.appendChild(titre);

    this.conteneur.appendChild(this._champTexte('Nom', calque.nom, (valeur) => {
      if (valeur && valeur !== calque.nom) this.surMutation('Renommer', () => { calque.nom = valeur; });
    }));

    const opaciteAvant = calque.opacite;
    this.conteneur.appendChild(this._curseur('Opacité', opaciteAvant, (valeur, definitif) => {
      if (!definitif) {
        calque.opacite = valeur;
        this.surApercu?.({ type: 'opacite', idCalque: calque.id });
        return;
      }
      // Restore the true "before" value so the snapshot command records one
      // meaningful undo step after the live slider preview.
      calque.opacite = opaciteAvant;
      if (valeur !== opaciteAvant) {
        this.surMutation('Opacité', () => { calque.opacite = valeur; });
      } else {
        this.surApercu?.({ type: 'opacite', idCalque: calque.id });
      }
    }));

    const etiquetteCouleur = calque.type === 'groupe' ? 'Couleur du repère' : 'Couleur';
    this.conteneur.appendChild(this._couleur(etiquetteCouleur, calque.couleur, (valeur) => {
      this.surMutation('Couleur', () => { calque.couleur = valeur; });
    }));

    this.conteneur.appendChild(this._fiche(calque));

    const releve = this.mesures?.(calque);
    if (releve) this.conteneur.appendChild(this._releve(releve));

    const comparaison = this.comparaison?.(calque);
    if (comparaison) this.conteneur.appendChild(this._comparaison(comparaison));

    if (calque.type === 'peinture' && (calque.donnees?.elements.length ?? 0) > 0
      && !this.doc.verrouilleEffectivement(calque.id)) {
      this.conteneur.appendChild(this._conversionRegion(calque));
    }
    if (calque.type === 'region' && (calque.donnees?.elements.length ?? 0) > 0
      && !this.doc.verrouilleEffectivement(calque.id)) {
      this.conteneur.appendChild(this._lissageRegion(calque));
    }

    this.conteneur.appendChild(this._portee(calque));

    // Kept apart: sitting flush under the scope checkboxes, it reads as one of
    // them.
    const fin = document.createElement('div');
    fin.className = 'inspecteur-fin';
    fin.appendChild(this._case('Verrouillé', calque.verrouille, (valeur) => {
      this.surMutation(valeur ? 'Verrouiller' : 'Déverrouiller', () => { calque.verrouille = valeur; });
    }));
    this.conteneur.appendChild(fin);
  }

  /* ------------------------------------------------------------- champs */

  _bloc(etiquette, contenu, valeurAffichee) {
    const bloc = document.createElement('div');
    bloc.className = 'field';
    const legende = document.createElement('span');
    legende.className = 'field-label';
    const texte = document.createElement('label');
    texte.textContent = etiquette;
    legende.appendChild(texte);
    if (valeurAffichee) legende.appendChild(valeurAffichee);
    bloc.append(legende, contenu);
    return bloc;
  }

  _champTexte(etiquette, valeur, surValidation) {
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'champ';
    champ.value = valeur;
    champ.addEventListener('change', () => surValidation(champ.value.trim()));
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') champ.blur();
    });
    return this._bloc(etiquette, champ);
  }

  // Live while dragging, one undo entry when the drag ends: a slider must not
  // bury the undo stack under a hundred intermediate values.
  _curseur(etiquette, valeur, surChangement) {
    const champ = document.createElement('input');
    champ.type = 'range';
    champ.min = 0;
    champ.max = 100;
    champ.value = Math.round(valeur * 100);
    const affichage = document.createElement('span');
    affichage.textContent = `${champ.value} %`;

    champ.addEventListener('input', () => {
      affichage.textContent = `${champ.value} %`;
      surChangement(Number(champ.value) / 100, false);
    });
    champ.addEventListener('change', () => surChangement(Number(champ.value) / 100, true));
    return this._bloc(etiquette, champ, affichage);
  }

  _couleur(etiquette, valeur, surChangement) {
    const palette = creerPalette(this.couleurs, surChangement);
    palette.marquer(valeur);
    return this._bloc(etiquette, palette);
  }

  // What the layer measures, on the capture currently on screen. A read-out,
  // not a setting: nothing here can be edited, and the caveats travel with the
  // figures rather than living in a manual nobody opens.
  _releve({ lignes, note }) {
    const bloc = document.createElement('div');
    bloc.className = 'group releve';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'Mesures';
    bloc.appendChild(titre);

    for (const { etiquette, valeur, aide } of lignes) {
      const ligne = document.createElement('div');
      ligne.className = 'releve-ligne';
      const nom = document.createElement('span');
      nom.textContent = etiquette;
      const chiffre = document.createElement('strong');
      chiffre.textContent = valeur;
      if (aide) ligne.title = aide;
      ligne.append(nom, chiffre);
      bloc.appendChild(ligne);
    }

    if (note) {
      const texte = document.createElement('p');
      texte.className = 'reglages-note';
      texte.textContent = note;
      bloc.appendChild(texte);
    }
    return bloc;
  }

  // The layer's own card, or the offer to open one.
  //
  // Deliberately above the measurements: what the layer *is* comes before how
  // much of it there is. A group with a card is an observed entity — the fin,
  // this varnish loss — and the paint and pins under it are its facets rather
  // than its namesakes.
  _fiche(calque) {
    const bloc = document.createElement('div');
    bloc.className = 'group inspecteur-fiche';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = calque.type === 'groupe' ? 'Entité' : 'Fiche';
    bloc.appendChild(titre);

    if (!ficheRenseignee(calque.fiche)) {
      const note = document.createElement('p');
      note.className = 'reglages-note';
      note.textContent = calque.type === 'groupe'
        ? 'Décrivez ici ce que ce groupe désigne : la peinture, les épingles et les '
          + 'mesures qu’il contient en deviennent les facettes.'
        : 'Une description, une nature d’énoncé, des valeurs — attachées à ce calque.';
      bloc.appendChild(note);

      const ouvrir = document.createElement('button');
      ouvrir.type = 'button';
      ouvrir.className = 'inspecteur-action';
      ouvrir.textContent = calque.type === 'groupe' ? 'Décrire cette entité' : 'Décrire ce calque';
      ouvrir.addEventListener('click', () => this.surOuvrirFiche?.(calque.id));
      bloc.appendChild(ouvrir);
      return bloc;
    }

    const fiche = calque.fiche;
    const marque = document.createElement('div');
    marque.className = 'fiche-marque';
    marque.dataset.confiance = fiche.confiance ?? 'certain';
    const nature = document.createElement('span');
    nature.className = 'fiche-etiquette-nature';
    nature.dataset.nature = fiche.nature ?? 'constat';
    nature.textContent = NATURES[fiche.nature]?.libelle ?? 'Constat';
    const confiance = document.createElement('span');
    confiance.className = 'fiche-etiquette-confiance';
    confiance.textContent = CONFIANCES[fiche.confiance]?.libelle ?? 'Certain';
    marque.append(nature, confiance);
    bloc.appendChild(marque);

    const resume = String(fiche.texte ?? '').replace(/\s+/g, ' ').trim();
    if (resume) {
      const apercu = document.createElement('p');
      apercu.className = 'reglages-note fiche-apercu';
      apercu.textContent = resume.length > 140 ? `${resume.slice(0, 140).trim()}…` : resume;
      bloc.appendChild(apercu);
    }

    const details = [];
    if (fiche.methode?.trim()) details.push(fiche.methode.trim());
    if (fiche.vue) details.push('vue mémorisée');
    const nombreProprietes = (fiche.proprietes ?? []).filter((p) => p.cle || p.valeur).length;
    if (nombreProprietes > 0) details.push(`${nombreProprietes} propriété${nombreProprietes > 1 ? 's' : ''}`);
    if (fiche.medias?.length) details.push(`${fiche.medias.length} média${fiche.medias.length > 1 ? 's' : ''}`);
    if (details.length > 0) {
      const ligne = document.createElement('p');
      ligne.className = 'fiche-signature';
      ligne.textContent = details.join(' · ');
      bloc.appendChild(ligne);
    }

    const ouvrir = document.createElement('button');
    ouvrir.type = 'button';
    ouvrir.className = 'inspecteur-action';
    ouvrir.textContent = 'Ouvrir la fiche';
    ouvrir.addEventListener('click', () => this.surOuvrirFiche?.(calque.id));
    bloc.appendChild(ouvrir);

    return bloc;
  }

  // The same quantity measured on each capture. Three captures of one specimen
  // taken within the hour are not three states of the object: they are three
  // measurements of one state, and their spread is the only honest estimate of
  // what a figure from this pipeline is worth.
  _comparaison({ lignes, dispersion, note }) {
    const bloc = document.createElement('div');
    bloc.className = 'group releve comparaison';

    const titre = document.createElement('span');
    titre.className = 'group-title';
    titre.textContent = 'D’une capture à l’autre';
    bloc.appendChild(titre);

    for (const { etiquette, valeur, absent, courante } of lignes) {
      const ligne = document.createElement('div');
      ligne.className = 'releve-ligne';
      if (absent) ligne.classList.add('comparaison-absente');
      if (courante) ligne.classList.add('comparaison-courante');
      ligne.append(
        Object.assign(document.createElement('span'), { textContent: etiquette }),
        Object.assign(document.createElement('strong'), { textContent: valeur }),
      );
      bloc.appendChild(ligne);
    }

    if (dispersion) {
      const ligne = document.createElement('div');
      ligne.className = 'releve-ligne comparaison-dispersion';
      ligne.append(
        Object.assign(document.createElement('span'), { textContent: dispersion.etiquette }),
        Object.assign(document.createElement('strong'), { textContent: dispersion.valeur }),
      );
      if (dispersion.aide) ligne.title = dispersion.aide;
      bloc.appendChild(ligne);
    }

    if (note) {
      const texte = document.createElement('p');
      texte.className = 'reglages-note';
      texte.textContent = note;
      bloc.appendChild(texte);
    }
    return bloc;
  }

  _case(etiquette, valeur, surChangement) {
    const ligne = document.createElement('label');
    ligne.className = 'case';
    const champ = document.createElement('input');
    champ.type = 'checkbox';
    champ.checked = valeur;
    champ.addEventListener('change', () => surChangement(champ.checked));
    ligne.append(champ, document.createTextNode(etiquette));
    return ligne;
  }

  _conversionRegion(calque) {
    const bloc = document.createElement('div');
    bloc.className = 'inspecteur-conversion';

    const note = document.createElement('p');
    note.className = 'reglages-note';
    note.textContent = 'Transforme cette couleur en faces du maillage pour obtenir un contour et un volume.';

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'inspecteur-action';
    bouton.textContent = 'Convertir cette couleur en région';
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      bouton.textContent = 'Conversion…';
      try {
        await this.surConversionRegion?.(calque);
      } finally {
        if (bouton.isConnected) {
          bouton.disabled = false;
          bouton.textContent = 'Convertir cette couleur en région';
        }
      }
    });

    bloc.append(note, bouton);
    return bloc;
  }

  _lissageRegion(calque) {
    const bloc = document.createElement('div');
    bloc.className = 'inspecteur-conversion';

    const note = document.createElement('p');
    note.className = 'reglages-note';
    note.textContent = 'Comble les petits trous et régularise le contour. L’action peut être répétée si nécessaire.';

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'inspecteur-action';
    bouton.textContent = 'Lisser la région';
    bouton.addEventListener('click', () => this.surLissageRegion?.(calque));

    bloc.append(note, bouton);
    return bloc;
  }

  // Scope. Layers live in the shared frame, so they apply to the three captures
  // by default; restricting one is for what genuinely belongs to a single pass.
  _portee(calque) {
    const bloc = document.createElement('div');
    bloc.className = 'group';

    const titre = document.createElement('span');
    titre.className = 'field-label';
    titre.appendChild(Object.assign(document.createElement('label'), { textContent: 'Portée' }));
    bloc.appendChild(titre);

    const toutes = !calque.portee || calque.portee === 'toutes';
    bloc.appendChild(this._case('Toutes les sessions', toutes, (valeur) => {
      this.surMutation('Portée', () => {
        if (valeur) { calque.portee = 'toutes'; return; }
        // Restricting means restricting to what is on screen — ticking all
        // three back would say exactly the same thing as « toutes ».
        calque.portee = this.sessionActive
          ? [this.sessionActive]
          : this.sessions.map((s) => s.id);
      });
    }));

    if (toutes || this.sessions.length === 0) return bloc;

    for (const session of this.sessions) {
      const actif = Array.isArray(calque.portee) && calque.portee.includes(session.id);
      bloc.appendChild(this._case(session.label, actif, (valeur) => {
        this.surMutation('Portée', () => {
          const liste = new Set(Array.isArray(calque.portee) ? calque.portee : []);
          if (valeur) liste.add(session.id); else liste.delete(session.id);
          calque.portee = [...liste];
        });
      }));
    }

    return bloc;
  }
}
