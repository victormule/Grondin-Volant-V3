// Screen-space labels connected to their exact 3D anchor.
//
// ONE LABEL PER LAYER, whatever the layer holds. A pin, a painted zone, a
// region and a measurement are four ways of pointing at a thing on the
// specimen; they used to be labelled by four unrelated pieces of code, of which
// only one — the pins — actually put a name on screen. So a painted lesion was
// a coloured smear with its name locked away in a panel, and the panel was the
// only place two of them could be told apart.
//
// The anchor stays on the specimen. Labels are laid out around the projected
// body, with dotted leaders, so a dense annotation set remains readable without
// turning the fish itself into a wall of text.
//
// What a label does NOT do is say what kind of layer it belongs to in words.
// Every label looks the same — same shape, same weight, same leader — because
// they are all the same act, naming a thing. The one discreet difference is a
// small glyph, and it is there for the reader who wonders how a figure was
// obtained rather than for the reader who just wants the name.

import * as THREE from 'three';
import {
  GENRES, TYPES_CALQUE, NATURES, CONFIANCES, genresDuCalque, elementsDuGenre, ficheRenseignee,
} from '../document/modele.js';
import { tracesSilhouette } from '../ui/glyphes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BUDGET_RAYONS = 3;
const MARGE_ECRAN = 10;
const ECART_MODELE = 14;
const ECART_ETIQUETTES = 6;
const DESCRIPTION_MAX = 180;
// Cf. regions.js : la même exigence, pour la même raison. Un tracé qui déborde
// sur l'autre face ne doit pas emmener son étiquette avec lui.
const ACCORD_ANCRAGE = 0.35;
// Combien de valeurs mesurées une étiquette dépliée affiche avant de compter
// le reste. Au-delà, elle cesse d'être une étiquette : c'est la fiche.
const PROPRIETES_ETIQUETTE = 3;
const INTERVALLE_DISPOSITION = 85;
const HYSTERESE_COTE = 0.7;
const COTES = ['gauche', 'droite', 'haut', 'bas'];

// Dabs are sampled rather than summed: a long stroke can carry tens of
// thousands, and the centre of a cloud of points is not a figure that needs
// every one of them.
const ECHANTILLON_EMPREINTES = 240;

function borner(valeur, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, valeur));
}

function aireIntersection(a, b) {
  const largeur = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const hauteur = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return largeur * hauteur;
}

function arrondirDemiPixel(valeur) {
  return Math.round(valeur * 2) / 2;
}

function couleurTexte(couleur) {
  const hex = String(couleur || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return '#ffffff';
  const complet = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const r = parseInt(complet.slice(0, 2), 16) / 255;
  const v = parseInt(complet.slice(2, 4), 16) / 255;
  const b = parseInt(complet.slice(4, 6), 16) / 255;
  const lineariser = (canal) => (canal <= 0.04045
    ? canal / 12.92
    : ((canal + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lineariser(r) + 0.7152 * lineariser(v) + 0.0722 * lineariser(b);
  return luminance > 0.43 ? '#151719' : '#ffffff';
}

function texteSimple(markdown) {
  return String(markdown ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`#>*_~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resumer(markdown) {
  const texte = texteSimple(markdown);
  if (texte.length <= DESCRIPTION_MAX) return texte;
  const coupe = texte.slice(0, DESCRIPTION_MAX + 1);
  const fin = coupe.lastIndexOf(' ');
  return `${coupe.slice(0, fin > DESCRIPTION_MAX * 0.65 ? fin : DESCRIPTION_MAX).trim()}…`;
}

export class CoucheEtiquettes {
  constructor(conteneur, scene3d, pointeur, options = {}) {
    this.conteneur = conteneur;
    this.scene3d = scene3d;
    this.pointeur = pointeur;
    this.doc = options.document;
    this.surSelection = options.surSelection;
    // Set by the application: where a layer's regions sit on the capture
    // currently on screen. Region faces are indices into a mesh this file has
    // no business knowing about.
    this.ancrageRegion = options.ancrageRegion ?? null;
    // The media library, so an unfolded label can show what it is talking
    // about. Optional: without it labels simply stay wordy.
    this.medias = options.medias ?? null;

    this.selection = null;
    this.sessionActive = null;
    this.entrees = [];
    this.curseurOcclusion = 0;
    this.occlusionsRestantes = 0;
    this.dispositionEnAttente = false;
    this.dernierPlacement = 0;
    this.etatsPlacement = new Map();

    this._position = new THREE.Vector3();
    this._normale = new THREE.Vector3();
    this._versCamera = new THREE.Vector3();
    this._projection = new THREE.Vector3();

    window.addEventListener('resize', () => this._planifierDisposition());
    for (const panneau of document.querySelectorAll('.panel')) {
      panneau.addEventListener('transitionend', () => this._planifierDisposition());
    }
    this.observateurInterface = new MutationObserver(() => this._planifierDisposition());
    for (const reglages of document.querySelectorAll('.reglages-outil, .fiche-flottante')) {
      this.observateurInterface.observe(reglages, {
        attributes: true,
        attributeFilter: ['hidden', 'class'],
      });
    }
  }

  definirDocument(doc) {
    this.doc = doc;
    this.reconstruire();
  }

  definirSessionActive(id) {
    this.sessionActive = id;
    this.reconstruire();
  }

  selectionner(id) {
    this.selection = id;
    for (const entree of this.entrees) {
      const selectionnee = entree.calque.id === id;
      entree.point.classList.toggle('selectionnee', selectionnee);
      entree.etiquette.classList.toggle('selectionnee', selectionnee);
      for (const secondaire of entree.pointsSecondaires) {
        secondaire.element.classList.toggle('selectionnee', selectionnee);
      }
    }
  }

  /* ----------------------------------------------------------- l'ancrage */

  // Where a layer's name belongs on the specimen, and which way that spot
  // faces. Content decides, in the order a reader would expect: a pin is a
  // point someone chose, so it wins over a centre of mass nobody did.
  ancrageDe(calque) {
    return calque ? this._ancrage(calque) : null;
  }

  _ancrage(calque) {
    const epingles = elementsDuGenre(calque, 'epingle');
    if (epingles.length > 0) {
      const premiere = epingles[0];
      return {
        position: new THREE.Vector3(...premiere.position),
        normale: new THREE.Vector3(...premiere.normale),
      };
    }

    const traces = elementsDuGenre(calque, 'trace');
    if (traces.length > 0) {
      const centre = this._centreDesEmpreintes(traces);
      if (centre) return centre;
    }

    if (this.ancrageRegion && elementsDuGenre(calque, 'region').length > 0) {
      const ancrage = this.ancrageRegion(calque);
      if (ancrage?.position) {
        return {
          position: ancrage.position.clone(),
          normale: ancrage.normale ? ancrage.normale.clone() : null,
        };
      }
    }

    const mesures = elementsDuGenre(calque, 'mesure');
    for (const mesure of mesures) {
      const points = mesure.points ?? [];
      if (points.length === 0) continue;
      // The stored points are the ones that were clicked; the walked path is
      // rebuilt per capture and is not this file's to ask for. The middle
      // vertex of the polyline is close enough to the middle of the line for a
      // name to hang off it.
      const milieu = points[Math.floor(points.length / 2)];
      return { position: new THREE.Vector3(...milieu), normale: null };
    }

    return null;
  }

  // The unfolded body of a label: thumbnail, description, figures, standing.
  // Returns null when there is nothing worth unfolding for — a named zone with
  // an empty card should stay a name and not grow an empty box under it.
  _detail(calque, fiche, description) {
    const proprietes = (fiche?.proprietes ?? [])
      .filter((p) => String(p.cle ?? '').trim() && String(p.valeur ?? '').trim());
    const vignette = this._vignette(fiche);
    const qualifie = ficheRenseignee(fiche);
    if (!description && !vignette && proprietes.length === 0 && !qualifie) return null;

    const detail = document.createElement('span');
    detail.className = 'epingle-detail';
    if (vignette) detail.appendChild(vignette);

    if (description) {
      const texte = document.createElement('span');
      texte.className = 'epingle-description';
      texte.textContent = description;
      detail.appendChild(texte);
    }

    // The figures, not a count of them. « 3 propriétés » tells a reader they
    // are missing something; « épaisseur 2 mm » tells them the thing.
    if (proprietes.length > 0) {
      const chiffres = document.createElement('span');
      chiffres.className = 'epingle-chiffres';
      for (const propriete of proprietes.slice(0, PROPRIETES_ETIQUETTE)) {
        const puce = document.createElement('span');
        puce.className = 'epingle-chiffre';
        const cle = document.createElement('span');
        cle.className = 'epingle-chiffre-cle';
        cle.textContent = propriete.cle;
        puce.append(cle, document.createTextNode(
          ` ${propriete.valeur}${propriete.unite ? ` ${propriete.unite}` : ''}`,
        ));
        chiffres.appendChild(puce);
      }
      if (proprietes.length > PROPRIETES_ETIQUETTE) {
        const reste = document.createElement('span');
        reste.className = 'epingle-chiffre epingle-chiffre-reste';
        reste.textContent = `+${proprietes.length - PROPRIETES_ETIQUETTE}`;
        chiffres.appendChild(reste);
      }
      detail.appendChild(chiffres);
    }

    // How firmly it is said. The anchor ring already carries it as a shape,
    // which is enough to warn but not enough to name — and « probable » and
    // « vérifié » are not a nuance you want a reader to have to decode.
    if (qualifie) {
      const standing = document.createElement('span');
      standing.className = 'epingle-qualification';
      standing.textContent = `${NATURES[fiche.nature]?.libelle ?? 'Constat'} · `
        + `${(CONFIANCES[fiche.confiance]?.libelle ?? 'Certain').toLowerCase()}`;
      detail.appendChild(standing);
    }

    return detail;
  }

  // The first image attached to the card. Loading is asynchronous and the
  // label may well have been rebuilt by the time it lands, so the result is
  // dropped unless the element is still in the document.
  _vignette(fiche) {
    if (!this.medias || !this.doc) return null;
    for (const id of fiche?.medias ?? []) {
      const media = this.doc.medias.find((m) => m.id === id);
      if (!media || media.genre !== 'image') continue;
      const image = document.createElement('img');
      image.className = 'epingle-vignette';
      image.alt = '';
      image.decoding = 'async';
      this.medias.url(media).then((url) => {
        if (url && image.isConnected) image.src = url;
      }).catch(() => {});
      return image;
    }
    return null;
  }

  _centreDesEmpreintes(traces) {
    let total = 0;
    for (const trace of traces) total += trace.empreintes?.length ?? 0;
    if (total === 0) return null;
    const pas = Math.max(1, Math.floor(total / ECHANTILLON_EMPREINTES));

    const position = new THREE.Vector3();
    const normale = new THREE.Vector3();
    let n = 0;
    let index = 0;
    for (const trace of traces) {
      // An eraser subtracts paint; taking its dabs into the centre of the zone
      // would pull the name towards what is no longer there.
      if (trace.efface === true) { index += trace.empreintes?.length ?? 0; continue; }
      for (const empreinte of trace.empreintes ?? []) {
        if (index++ % pas !== 0) continue;
        position.x += empreinte[0];
        position.y += empreinte[1];
        position.z += empreinte[2];
        normale.x += empreinte[3];
        normale.y += empreinte[4];
        normale.z += empreinte[5];
        n += 1;
      }
    }
    if (n === 0) return null;
    position.divideScalar(n);

    // …and the mean of a set of dabs is not one of them. On a curved flank it
    // falls under the surface, where the occlusion ray finds the specimen's own
    // shell in front of it and the label flickers off with every rotation. So
    // the mean only says WHERE the zone is centred; the anchor returned is a
    // sampled dab near it — an actual point of the surface, with the normal
    // recorded when the brush laid it down.
    //
    // « Near it » is not enough on its own: a zone that wraps over a flank has
    // dabs on both sides, and the one closest to the middle of the volume can
    // be on the far one. The mean normal gives the zone's dominant facing, and
    // the anchor is chosen among the dabs that share it.
    const dominante = normale.lengthSq() > 1e-9
      ? normale.clone().normalize()
      : null;

    const choisir = (accordMinimum) => {
      let meilleure = null;
      let ecartMin = Infinity;
      let curseur = 0;
      for (const trace of traces) {
        if (trace.efface === true) { curseur += trace.empreintes?.length ?? 0; continue; }
        for (const empreinte of trace.empreintes ?? []) {
          if (curseur++ % pas !== 0) continue;
          if (accordMinimum !== null) {
            const accord = dominante.x * empreinte[3]
              + dominante.y * empreinte[4] + dominante.z * empreinte[5];
            if (accord < accordMinimum) continue;
          }
          const dx = empreinte[0] - position.x;
          const dy = empreinte[1] - position.y;
          const dz = empreinte[2] - position.z;
          const ecart = dx * dx + dy * dy + dz * dz;
          if (ecart < ecartMin) { ecartMin = ecart; meilleure = empreinte; }
        }
      }
      return meilleure;
    };

    const meilleure = (dominante && choisir(ACCORD_ANCRAGE)) || choisir(null);
    if (!meilleure) {
      return { position, normale: dominante };
    }

    const normaleLocale = new THREE.Vector3(meilleure[3], meilleure[4], meilleure[5]);
    return {
      position: new THREE.Vector3(meilleure[0], meilleure[1], meilleure[2]),
      normale: normaleLocale.lengthSq() > 1e-9 ? normaleLocale.normalize() : null,
    };
  }

  // Whether a layer has anything to say, and permission to say it.
  //
  // An annotation always speaks: putting a pin down IS asking for a name on the
  // specimen, even before anything has been written about it — a pin with no
  // label would be an unmarked dot nobody could identify. Everything else waits
  // until it has been described, so that a trial brush stroke does not plant a
  // name in the view.
  _parle(calque) {
    if (calque.enfants) return false;
    if (calque.etiquette === false) return false;
    if (!this.doc.etiquetteEffective(calque.id)) return false;
    if (!this.doc.visibleEffectivement(calque.id)) return false;
    if (!this.doc.concerneSession(calque, this.sessionActive)) return false;
    return elementsDuGenre(calque, 'epingle').length > 0 || ficheRenseignee(calque.fiche);
  }

  /* ------------------------------------------------------- construction */

  reconstruire() {
    this.etatsPlacement.clear();
    for (const entree of this.entrees) {
      clearTimeout(entree.fermeture);
      this.etatsPlacement.set(entree.calque.id, {
        cote: entree.cote,
        rect: entree.rectEtiquette ? { ...entree.rectEtiquette } : null,
      });
    }
    this.conteneur.replaceChildren();
    this.entrees = [];
    if (!this.doc) return;

    this.liaisons = document.createElementNS(SVG_NS, 'svg');
    this.liaisons.classList.add('epingle-liaisons');
    this.liaisons.setAttribute('aria-hidden', 'true');
    this.conteneur.appendChild(this.liaisons);

    for (const { calque } of this.doc.aplatir()) {
      if (!this._parle(calque)) continue;
      const ancrage = this._ancrage(calque);
      if (!ancrage) continue;
      this.entrees.push(this._entree(calque, ancrage));
    }

    this.occlusionsRestantes = this.entrees.length;
    this.majPositions();
  }

  _entree(calque, ancrage) {
    const couleur = calque.couleur;
    const opacite = this.doc.opaciteEffective(calque.id);
    const groupe = this.doc.groupeExterieur(calque.id);
    const etat = this.etatsPlacement.get(calque.id);
    const fiche = calque.fiche;
    const confiance = fiche?.confiance ?? 'certain';
    const genres = genresDuCalque(calque);
    const genre = genres[0] ?? TYPES_CALQUE[calque.type]?.genre ?? 'epingle';

    const ligne = document.createElementNS(SVG_NS, 'path');
    ligne.classList.add('epingle-liaison');
    ligne.style.setProperty('--couleur', couleur);
    ligne.style.opacity = String(opacite);
    this.liaisons.appendChild(ligne);

    // The anchor carries how firmly the statement is made. A solid ring is a
    // certainty, a dashed one a hypothesis — read at a glance, on the specimen,
    // without opening anything. It is the cheapest way to stop a reader taking
    // « probable » for « measured ».
    const point = this._pastille(calque, couleur, opacite, confiance, fiche);

    const etiquette = document.createElement('button');
    etiquette.type = 'button';
    etiquette.className = 'epingle-etiquette';
    etiquette.dataset.confiance = confiance;
    etiquette.dataset.genre = genre;
    etiquette.style.setProperty('--couleur', couleur);
    etiquette.style.setProperty('--texte-etiquette', couleurTexte(couleur));
    etiquette.style.opacity = String(opacite);
    // The dot of the OUTERMOST group, not of the one immediately above. Three
    // labels of one entity, sitting at three different depths of the tree, have
    // to wear the same mark or the mark says nothing about belonging.
    if (groupe) {
      etiquette.classList.add('dans-groupe');
      etiquette.style.setProperty('--couleur-groupe', groupe.couleur);
      etiquette.dataset.groupe = groupe.nom || 'Groupe';
    }

    // The same silhouettes as the layer panel, in ink rather than in colour:
    // on the specimen the label's own colour already says which layer it is,
    // so the mark only has to say what kind of thing it is.
    const marque = document.createElement('span');
    marque.className = 'epingle-etiquette-genre';
    marque.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${tracesSilhouette(genre)}</svg>`;
    marque.setAttribute('aria-hidden', 'true');
    etiquette.appendChild(marque);

    const titre = document.createElement('span');
    titre.className = 'epingle-etiquette-titre';
    titre.textContent = calque.nom || 'Sans titre';
    etiquette.appendChild(titre);

    etiquette.title = `${calque.nom || 'Sans titre'} · ${GENRES[genre]?.libelle ?? ''}`
      + (groupe ? ` · ${groupe.nom || 'Groupe'}` : '');

    // What unfolds under the pointer.
    //
    // The label at rest is a name — that is all it should be, forty of them on
    // a specimen is already a lot of ink. But hovering one is a question, and
    // the answer used to be the description alone. What a reader actually
    // wants at that moment is the same thing they want from the card: what is
    // claimed, how firmly, on what figures, and what it looks like. The
    // thumbnail earns its place here more than anywhere: a photograph of a
    // crack settles in a glance what a sentence about it argues.
    const description = resumer(fiche?.texte);
    const detail = this._detail(calque, fiche, description);
    if (detail) {
      etiquette.appendChild(detail);
      etiquette.setAttribute('aria-expanded', 'false');
    }

    const entree = {
      calque,
      point,
      pointsSecondaires: this._pointsSecondaires(calque, couleur, opacite, confiance),
      etiquette,
      ligne,
      description,
      detail,
      position: ancrage.position,
      normale: ancrage.normale,
      visible: true,
      depliee: false,
      appui: false,
      fermeture: null,
      cote: etat?.cote ?? null,
      rectEtiquette: etat?.rect ?? null,
      faceVisible: true,
      occulte: false,
      candidatOcclusion: false,
      repetitionsOcclusion: 0,
    };

    const ouvrir = (evenement) => {
      evenement.stopPropagation();
      this.surSelection?.(calque.id);
    };
    point.addEventListener('click', ouvrir);
    etiquette.addEventListener('click', ouvrir);
    for (const secondaire of entree.pointsSecondaires) {
      secondaire.element.addEventListener('click', ouvrir);
    }

    // Keep the same hit target for the whole gesture. The label layout may be
    // recomputed while a description expands, but pointer capture guarantees
    // that pointerup — and therefore click — still belongs to this label.
    etiquette.addEventListener('pointerdown', (evenement) => {
      if (evenement.button !== undefined && evenement.button !== 0) return;
      entree.appui = true;
      etiquette.setPointerCapture?.(evenement.pointerId);
    });
    const finirAppui = (evenement) => {
      if (etiquette.hasPointerCapture?.(evenement.pointerId)) {
        etiquette.releasePointerCapture(evenement.pointerId);
      }
      setTimeout(() => { entree.appui = false; }, 0);
    };
    etiquette.addEventListener('pointerup', finirAppui);
    etiquette.addEventListener('pointercancel', finirAppui);

    const deplier = (actif) => {
      // Gated on the body, not on the description: a zone can now unfold for a
      // photograph or a measured value with no sentence written at all.
      if (!detail || entree.depliee === actif) return;
      entree.depliee = actif;
      etiquette.classList.toggle('depliee', actif);
      etiquette.setAttribute('aria-expanded', String(actif));
      this._planifierDisposition();
    };
    etiquette.addEventListener('pointerenter', (evenement) => {
      // A touch has no hover. Expanding on pointerdown moved the label before
      // pointerup, so the browser cancelled the click that should open it.
      if (evenement.pointerType === 'touch') return;
      clearTimeout(entree.fermeture);
      deplier(true);
    });
    etiquette.addEventListener('pointerleave', (evenement) => {
      if (evenement.pointerType === 'touch') return;
      clearTimeout(entree.fermeture);
      entree.fermeture = setTimeout(() => deplier(false), 140);
    });
    etiquette.addEventListener('focus', () => deplier(true));
    etiquette.addEventListener('blur', () => deplier(false));

    this.conteneur.append(point, etiquette);
    for (const secondaire of entree.pointsSecondaires) {
      this.conteneur.appendChild(secondaire.element);
    }
    if (calque.id === this.selection) {
      point.classList.add('selectionnee');
      etiquette.classList.add('selectionnee');
    }
    return entree;
  }

  _pastille(calque, couleur, opacite, confiance, fiche) {
    const point = document.createElement('button');
    point.type = 'button';
    point.className = 'epingle-point';
    point.dataset.confiance = confiance;
    point.dataset.nature = fiche?.nature ?? 'constat';
    point.style.setProperty('--couleur', couleur);
    point.style.opacity = String(opacite);
    const qualite = confiance === 'certain' ? '' : ` (${confiance})`;
    point.title = `${calque.nom || 'Sans titre'}${qualite}`;
    point.setAttribute('aria-label', `Ouvrir : ${calque.nom || 'sans titre'}${qualite}`);
    return point;
  }

  // An annotation is one pin, so this is normally empty. It exists for the
  // documents that predate that rule and reach the migration with a layer whose
  // pins could not be separated: they keep their dots, and share one name.
  _pointsSecondaires(calque, couleur, opacite, confiance) {
    const epingles = elementsDuGenre(calque, 'epingle');
    return epingles.slice(1).map((epingle) => {
      const element = this._pastille(calque, couleur, opacite, confiance, calque.fiche);
      element.classList.add('secondaire');
      return {
        element,
        position: new THREE.Vector3(...epingle.position),
        normale: new THREE.Vector3(...epingle.normale),
        visible: true,
      };
    });
  }

  /* ------------------------------------------------------------ positions */

  // Called after an actual 3D render: anchors follow the camera, then labels
  // are repacked around the newly projected specimen bounds.
  majPositions(retesterOcclusions = false) {
    if (this.entrees.length === 0) return false;
    if (retesterOcclusions) this.occlusionsRestantes = this.entrees.length;

    const camera = this.scene3d.camera;
    const toile = this.scene3d.renderer.domElement;
    const largeur = toile.clientWidth;
    const hauteur = toile.clientHeight;

    for (const entree of this.entrees) {
      this._position.copy(entree.position).project(camera);
      const derriere = this._position.z > 1;
      entree.x = (this._position.x * 0.5 + 0.5) * largeur;
      entree.y = (-this._position.y * 0.5 + 0.5) * hauteur;

      // A region's centre of area and a measurement's midpoint have no surface
      // normal — they are not points ON the surface, they stand for a whole
      // extent. Only the occlusion ray decides for those.
      if (entree.normale) {
        this._versCamera.copy(camera.position).sub(entree.position).normalize();
        const orientation = this._normale.copy(entree.normale).dot(this._versCamera);
        // Two thresholds prevent an annotation on the silhouette from flashing
        // on and off when the camera moves by a fraction of a degree.
        entree.faceVisible = orientation > (entree.faceVisible ? -0.24 : -0.06);
      } else {
        entree.faceVisible = true;
      }

      const dansLeCadre = entree.x >= 0 && entree.x <= largeur && entree.y >= 0 && entree.y <= hauteur;
      entree.visible = !derriere && entree.faceVisible && dansLeCadre && !entree.occulte;
      entree.profondeur = this._position.z;

      for (const secondaire of entree.pointsSecondaires) {
        this._projection.copy(secondaire.position).project(camera);
        secondaire.x = (this._projection.x * 0.5 + 0.5) * largeur;
        secondaire.y = (-this._projection.y * 0.5 + 0.5) * hauteur;
        this._versCamera.copy(camera.position).sub(secondaire.position).normalize();
        const oriente = this._normale.copy(secondaire.normale).dot(this._versCamera);
        secondaire.visible = this._projection.z <= 1 && oriente > -0.06;
        secondaire.profondeur = this._projection.z;
      }
    }

    this._testerOcclusions();
    const maintenant = performance.now();
    const placementComplet = !retesterOcclusions || maintenant - this.dernierPlacement >= INTERVALLE_DISPOSITION
      || this.entrees.some((entree) => entree.visible && !entree.rectEtiquette);
    this._disposer(placementComplet);
    if (placementComplet) this.dernierPlacement = maintenant;
    return this.occlusionsRestantes > 0;
  }

  _testerOcclusions() {
    const total = this.entrees.length;
    if (total === 0 || this.occlusionsRestantes === 0) return;
    const nombre = Math.min(BUDGET_RAYONS, total, this.occlusionsRestantes);
    for (let n = 0; n < nombre; n++) {
      const entree = this.entrees[this.curseurOcclusion % total];
      this.curseurOcclusion = (this.curseurOcclusion + 1) % total;
      const mesure = this.pointeur.occulte(entree.position);
      if (mesure === entree.candidatOcclusion) entree.repetitionsOcclusion += 1;
      else {
        entree.candidatOcclusion = mesure;
        entree.repetitionsOcclusion = 1;
      }
      if (entree.repetitionsOcclusion >= 2) entree.occulte = mesure;
      if (entree.occulte) entree.visible = false;
    }
    this.occlusionsRestantes -= nombre;
  }

  _planifierDisposition() {
    if (this.dispositionEnAttente) return;
    this.dispositionEnAttente = true;
    requestAnimationFrame(() => {
      this.dispositionEnAttente = false;
      this._disposer();
    });
  }

  _zoneDisponible(largeur, hauteur) {
    const zone = {
      left: MARGE_ECRAN,
      right: largeur - MARGE_ECRAN,
      top: MARGE_ECRAN,
      bottom: hauteur - MARGE_ECRAN,
    };
    for (const panneau of document.querySelectorAll('.panel:not(.collapsed)')) {
      const rect = panneau.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < largeur / 2) zone.left = Math.max(zone.left, rect.right + MARGE_ECRAN);
      else zone.right = Math.min(zone.right, rect.left - MARGE_ECRAN);
    }
    // On a narrow mobile view an open full-width panel leaves no scene to lay
    // labels into; retain the viewport bounds until that panel is collapsed.
    if (zone.right - zone.left < 120) {
      zone.left = MARGE_ECRAN;
      zone.right = largeur - MARGE_ECRAN;
    }
    return zone;
  }

  _disposer(placementComplet = true) {
    const toile = this.scene3d.renderer.domElement;
    const largeur = toile.clientWidth;
    const hauteur = toile.clientHeight;
    if (largeur <= 0 || hauteur <= 0) return;

    const zone = this._zoneDisponible(largeur, hauteur);
    const modele = this.pointeur.rectangleModelePrincipal(ECART_MODELE);
    // The card now sits at the foot of the view rather than inside a panel, so
    // it is an obstacle labels have to be laid out around like any other.
    const obstaclesInterface = [...document.querySelectorAll(
      '.barre-outils, .reglages-outil:not([hidden]), .hint, .viewer-status.visible,'
      + ' .fiche-flottante:not([hidden])',
    )].map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const visibles = this.entrees.filter((entree) => entree.visible);

    for (const entree of this.entrees) {
      const cachee = !entree.visible;
      entree.point.classList.toggle('cachee', cachee);
      entree.etiquette.classList.toggle('cachee', cachee);
      entree.ligne.classList.toggle('cachee', cachee);
      if (!cachee) {
        entree.point.style.transform = `translate3d(${entree.x.toFixed(1)}px, ${entree.y.toFixed(1)}px, 0)`;
        entree.point.style.zIndex = String(1200 - Math.round(entree.profondeur * 500));
      }
      for (const secondaire of entree.pointsSecondaires) {
        const masque = cachee || !secondaire.visible;
        secondaire.element.classList.toggle('cachee', masque);
        if (masque) continue;
        secondaire.element.style.transform =
          `translate3d(${secondaire.x.toFixed(1)}px, ${secondaire.y.toFixed(1)}px, 0)`;
        secondaire.element.style.zIndex = String(1200 - Math.round(secondaire.profondeur * 500));
      }
    }

    if (!placementComplet) {
      for (const entree of visibles) this._positionnerLiaison(entree, entree.rectEtiquette);
      return;
    }

    const cadre = modele ?? {
      left: largeur / 2,
      right: largeur / 2,
      top: hauteur / 2,
      bottom: hauteur / 2,
    };
    const rails = Object.fromEntries(COTES.map((cote) => [cote, []]));
    const charges = Object.fromEntries(COTES.map((cote) => [cote, 0]));

    // Measuring once per layout avoids repeatedly forcing browser reflow while
    // sides are being selected.
    for (const entree of visibles) {
      entree.largeurEtiquette = Math.min(entree.etiquette.offsetWidth, zone.right - zone.left);
      entree.hauteurEtiquette = entree.etiquette.offsetHeight;
    }

    // Expanded labels choose first and then stay on their rail. Other labels
    // retain their previous side until another one is clearly preferable.
    const aRepartir = [...visibles].sort((a, b) => Number(b.depliee) - Number(a.depliee));
    for (const entree of aRepartir) {
      const cote = this._choisirCote(entree, zone, cadre, charges, obstaclesInterface);
      rails[cote].push(entree);
      charges[cote] += this._tailleSurRail(entree, cote) + ECART_ETIQUETTES;
    }

    for (const cote of COTES) this._disposerRail(rails[cote], cote, zone, cadre);
  }

  _positionnerLiaison(entree, rect) {
    if (!rect) return;
    const marge = 5;
    let x2;
    let y2;
    if (entree.cote === 'gauche') {
      x2 = rect.right;
      y2 = borner(entree.y, rect.top + marge, rect.bottom - marge);
    } else if (entree.cote === 'droite') {
      x2 = rect.left;
      y2 = borner(entree.y, rect.top + marge, rect.bottom - marge);
    } else if (entree.cote === 'haut') {
      x2 = borner(entree.x, rect.left + marge, rect.right - marge);
      y2 = rect.bottom;
    } else {
      x2 = borner(entree.x, rect.left + marge, rect.right - marge);
      y2 = rect.top;
    }

    const x1 = entree.x;
    const y1 = entree.y;
    let c1x;
    let c1y;
    let c2x;
    let c2y;
    if (entree.cote === 'gauche' || entree.cote === 'droite') {
      c1x = x1 + (x2 - x1) * 0.55;
      c1y = y1;
      c2x = x1 + (x2 - x1) * 0.84;
      c2y = y2;
    } else {
      c1x = x1;
      c1y = y1 + (y2 - y1) * 0.55;
      c2x = x2;
      c2y = y1 + (y2 - y1) * 0.84;
    }
    const n = (valeur) => arrondirDemiPixel(valeur);
    entree.ligne.setAttribute(
      'd',
      `M ${n(x1)} ${n(y1)} C ${n(c1x)} ${n(c1y)}, ${n(c2x)} ${n(c2y)}, ${n(x2)} ${n(y2)}`,
    );
  }

  _tailleSurRail(entree, cote) {
    return cote === 'gauche' || cote === 'droite'
      ? entree.hauteurEtiquette
      : entree.largeurEtiquette;
  }

  _bornesRail(cote, zone, modele) {
    if (cote === 'gauche' || cote === 'droite') {
      return { minimum: zone.top, maximum: zone.bottom };
    }
    // Horizontal rails stay over the model's span. This leaves the upper-left,
    // upper-right and lower corners free for the two vertical rails, so labels
    // from perpendicular sides cannot overlap each other.
    const minimum = Math.max(zone.left, modele.left);
    const maximum = Math.min(zone.right, modele.right);
    if (maximum - minimum >= 120) return { minimum, maximum };
    return { minimum: zone.left, maximum: zone.right };
  }

  _longueurRail(cote, zone, modele) {
    const bornes = this._bornesRail(cote, zone, modele);
    return bornes.maximum - bornes.minimum;
  }

  _espaceExterieur(cote, zone, modele) {
    if (cote === 'gauche') return modele.left - zone.left;
    if (cote === 'droite') return zone.right - modele.right;
    if (cote === 'haut') return modele.top - zone.top;
    return zone.bottom - modele.bottom;
  }

  _rectSurRail(entree, cote, position, zone, modele) {
    const largeur = entree.largeurEtiquette;
    const hauteur = entree.hauteurEtiquette;
    let x;
    let y;
    if (cote === 'gauche') {
      x = modele.left - ECART_MODELE - largeur;
      y = position;
    } else if (cote === 'droite') {
      x = modele.right + ECART_MODELE;
      y = position;
    } else if (cote === 'haut') {
      x = position;
      y = modele.top - ECART_MODELE - hauteur;
    } else {
      x = position;
      y = modele.bottom + ECART_MODELE;
    }
    x = borner(x, zone.left, zone.right - largeur);
    y = borner(y, zone.top, zone.bottom - hauteur);
    return { left: x, top: y, right: x + largeur, bottom: y + hauteur };
  }

  _choisirCote(entree, zone, modele, charges, obstacles) {
    if (entree.depliee && COTES.includes(entree.cote)) return entree.cote;

    const centreX = (modele.left + modele.right) / 2;
    const centreY = (modele.top + modele.bottom) / 2;
    const demiLargeur = Math.max((modele.right - modele.left) / 2, 40);
    const demiHauteur = Math.max((modele.bottom - modele.top) / 2, 40);
    const directions = {
      gauche: (centreX - entree.x) / demiLargeur,
      droite: (entree.x - centreX) / demiLargeur,
      haut: (centreY - entree.y) / demiHauteur,
      bas: (entree.y - centreY) / demiHauteur,
    };
    const scores = {};

    for (const cote of COTES) {
      const profondeurRequise = cote === 'gauche' || cote === 'droite'
        ? entree.largeurEtiquette
        : entree.hauteurEtiquette;
      const espace = this._espaceExterieur(cote, zone, modele) - ECART_MODELE;
      const ajustement = espace / Math.max(profondeurRequise, 1);
      const taille = this._tailleSurRail(entree, cote) + ECART_ETIQUETTES;
      const longueur = Math.max(this._longueurRail(cote, zone, modele), 1);
      const occupation = (charges[cote] + taille) / longueur;
      const position = cote === 'gauche' || cote === 'droite'
        ? entree.y - entree.hauteurEtiquette / 2
        : entree.x - entree.largeurEtiquette / 2;
      const rect = this._rectSurRail(entree, cote, position, zone, modele);
      const ratioObstacle = obstacles.reduce(
        (somme, obstacle) => somme + aireIntersection(rect, obstacle),
        0,
      ) / Math.max(entree.largeurEtiquette * entree.hauteurEtiquette, 1);

      scores[cote] = directions[cote] * 1.15
        + Math.min(ajustement, 1) * 0.75
        - Math.max(0, 0.78 - ajustement) * 4.5
        - occupation * 0.75
        - Math.max(0, occupation - 1) * 8
        - ratioObstacle * 6;
    }

    const meilleur = COTES.reduce((a, b) => (scores[b] > scores[a] ? b : a));
    if (!COTES.includes(entree.cote)) return meilleur;

    const tailleCourante = this._tailleSurRail(entree, entree.cote) + ECART_ETIQUETTES;
    const debordement = charges[entree.cote] + tailleCourante
      > this._longueurRail(entree.cote, zone, modele) * 0.98;
    if (!debordement && scores[entree.cote] >= scores[meilleur] - HYSTERESE_COTE) {
      return entree.cote;
    }
    return meilleur;
  }

  _disposerRail(entrees, cote, zone, modele) {
    if (entrees.length === 0) return;
    const vertical = cote === 'gauche' || cote === 'droite';
    const coordonnee = (entree) => (vertical ? entree.y : entree.x);
    entrees.sort((a, b) => coordonnee(a) - coordonnee(b)
      || String(a.calque.id).localeCompare(String(b.calque.id)));

    const { minimum, maximum } = this._bornesRail(cote, zone, modele);
    const tailles = entrees.map((entree) => this._tailleSurRail(entree, cote));
    const souhaitees = entrees.map((entree, index) => coordonnee(entree) - tailles[index] / 2);
    const indexFixe = entrees.findIndex((entree) => (entree.appui || entree.depliee)
      && entree.cote === cote && entree.rectEtiquette);
    const positions = this._repartirSurAxe(
      tailles,
      souhaitees,
      minimum,
      maximum,
      indexFixe,
      indexFixe >= 0
        ? (vertical ? entrees[indexFixe].rectEtiquette.top : entrees[indexFixe].rectEtiquette.left)
        : null,
    );

    for (let index = 0; index < entrees.length; index++) {
      const entree = entrees[index];
      entree.cote = cote;
      const rect = this._rectSurRail(entree, cote, positions[index], zone, modele);
      entree.rectEtiquette = rect;
      const x = arrondirDemiPixel(rect.left);
      const y = arrondirDemiPixel(rect.top);
      entree.etiquette.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      entree.etiquette.style.zIndex = entree.depliee ? '1600' : '1100';
      this._positionnerLiaison(entree, rect);
    }
  }

  _repartirSurAxe(tailles, souhaitees, minimum, maximum, indexFixe, positionFixe) {
    const positions = new Array(tailles.length);
    if (tailles.length === 0) return positions;
    const sommeTailles = tailles.reduce((somme, taille) => somme + taille, 0);
    const espace = maximum - minimum;
    const ecart = tailles.length > 1
      ? Math.max(1, Math.min(ECART_ETIQUETTES, (espace - sommeTailles) / (tailles.length - 1)))
      : 0;
    const placeAvant = (index) => tailles.slice(0, index)
      .reduce((somme, taille) => somme + taille + ecart, 0);
    const placeApres = (index) => tailles.slice(index + 1)
      .reduce((somme, taille) => somme + taille + ecart, 0);

    if (indexFixe >= 0 && sommeTailles + ecart * (tailles.length - 1) <= espace) {
      const minFixe = minimum + placeAvant(indexFixe);
      const maxFixe = maximum - tailles[indexFixe] - placeApres(indexFixe);
      positions[indexFixe] = borner(positionFixe, minFixe, maxFixe);
      for (let i = indexFixe - 1; i >= 0; i--) {
        positions[i] = Math.min(
          Math.max(minimum, souhaitees[i]),
          positions[i + 1] - ecart - tailles[i],
        );
      }
      for (let i = indexFixe + 1; i < tailles.length; i++) {
        positions[i] = Math.max(
          Math.min(maximum - tailles[i], souhaitees[i]),
          positions[i - 1] + tailles[i - 1] + ecart,
        );
      }
      return positions;
    }

    positions[0] = Math.max(minimum, souhaitees[0]);
    for (let i = 1; i < tailles.length; i++) {
      positions[i] = Math.max(souhaitees[i], positions[i - 1] + tailles[i - 1] + ecart);
    }
    const debordement = positions.at(-1) + tailles.at(-1) - maximum;
    if (debordement > 0) positions[positions.length - 1] -= debordement;
    for (let i = positions.length - 2; i >= 0; i--) {
      positions[i] = Math.min(positions[i], positions[i + 1] - ecart - tailles[i]);
    }
    if (positions[0] < minimum) {
      const correction = minimum - positions[0];
      for (let i = 0; i < positions.length; i++) positions[i] += correction;
    }
    return positions;
  }
}
