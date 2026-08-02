// Screen-space annotation labels connected to their exact 3D anchor.
//
// The dot stays on the specimen. Labels are laid out around the projected
// body, with dotted leaders, so a dense annotation set remains readable
// without turning the fish itself into a wall of text.

import * as THREE from 'three';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BUDGET_RAYONS = 3;
const MARGE_ECRAN = 10;
const ECART_MODELE = 14;
const ECART_ETIQUETTES = 6;
const DESCRIPTION_MAX = 180;
const INTERVALLE_DISPOSITION = 85;
const HYSTERESE_COTE = 0.7;
const COTES = ['gauche', 'droite', 'haut', 'bas'];

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
  return `${coupe.slice(0, fin > DESCRIPTION_MAX * 0.65 ? fin : DESCRIPTION_MAX).trim()}\u2026`;
}

export class CoucheEpingles {
  constructor(conteneur, scene3d, pointeur, options = {}) {
    this.conteneur = conteneur;
    this.scene3d = scene3d;
    this.pointeur = pointeur;
    this.doc = options.document;
    this.surSelection = options.surSelection;

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

    window.addEventListener('resize', () => this._planifierDisposition());
    for (const panneau of document.querySelectorAll('.panel')) {
      panneau.addEventListener('transitionend', () => this._planifierDisposition());
    }
    this.observateurInterface = new MutationObserver(() => this._planifierDisposition());
    for (const reglages of document.querySelectorAll('.reglages-outil')) {
      this.observateurInterface.observe(reglages, {
        attributes: true,
        attributeFilter: ['hidden'],
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
      const selectionnee = entree.epingle.id === id;
      entree.point.classList.toggle('selectionnee', selectionnee);
      entree.etiquette.classList.toggle('selectionnee', selectionnee);
    }
  }

  reconstruire() {
    this.etatsPlacement.clear();
    for (const entree of this.entrees) {
      clearTimeout(entree.fermeture);
      this.etatsPlacement.set(entree.epingle.id, {
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
      if (calque.type !== 'annotation' || !calque.donnees) continue;
      if (!this.doc.visibleEffectivement(calque.id)) continue;
      if (!this.doc.concerneSession(calque, this.sessionActive)) continue;

      const opacite = this.doc.opaciteEffective(calque.id);
      for (const epingle of calque.donnees.elements) {
        this.entrees.push(this._entree(epingle, calque, opacite));
      }
    }

    this.occlusionsRestantes = this.entrees.length;
    this.majPositions();
  }

  _entree(epingle, calque, opacite) {
    const couleur = calque.couleur;
    const groupe = this._groupeParent(calque);
    const etat = this.etatsPlacement.get(epingle.id);

    const ligne = document.createElementNS(SVG_NS, 'path');
    ligne.classList.add('epingle-liaison');
    ligne.style.setProperty('--couleur', couleur);
    ligne.style.opacity = String(opacite);
    this.liaisons.appendChild(ligne);

    // The dot carries how firmly the statement is made. A solid ring is a
    // certainty, a dashed one a hypothesis — read at a glance, on the specimen,
    // without opening anything. It is the cheapest way to stop a reader taking
    // « probable » for « measured ».
    const confiance = epingle.confiance ?? 'certain';
    const point = document.createElement('button');
    point.type = 'button';
    point.className = 'epingle-point';
    point.dataset.confiance = confiance;
    point.dataset.nature = epingle.nature ?? 'constat';
    point.style.setProperty('--couleur', couleur);
    point.style.opacity = String(opacite);
    const qualite = confiance === 'certain' ? '' : ` (${confiance})`;
    point.title = `${epingle.titre || 'Annotation sans titre'}${qualite}`;
    point.setAttribute('aria-label', `Ouvrir : ${epingle.titre || 'annotation sans titre'}${qualite}`);

    const etiquette = document.createElement('button');
    etiquette.type = 'button';
    etiquette.className = 'epingle-etiquette';
    etiquette.dataset.confiance = confiance;
    etiquette.style.setProperty('--couleur', couleur);
    etiquette.style.setProperty('--texte-etiquette', couleurTexte(couleur));
    etiquette.style.opacity = String(opacite);
    if (groupe) {
      etiquette.classList.add('dans-groupe');
      etiquette.style.setProperty('--couleur-groupe', groupe.couleur);
      etiquette.dataset.groupe = groupe.nom || 'Groupe';
    }

    const titre = document.createElement('span');
    titre.className = 'epingle-etiquette-titre';
    titre.textContent = epingle.titre || 'Sans titre';
    etiquette.appendChild(titre);

    const description = resumer(epingle.texte);
    if (description) {
      const detail = document.createElement('span');
      detail.className = 'epingle-description';
      detail.textContent = description;
      etiquette.appendChild(detail);
      etiquette.setAttribute('aria-expanded', 'false');
    }

    const entree = {
      epingle,
      calque,
      point,
      etiquette,
      ligne,
      description,
      position: new THREE.Vector3(...epingle.position),
      normale: new THREE.Vector3(...epingle.normale),
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
      this.surSelection?.(epingle.id, calque.id);
    };
    point.addEventListener('click', ouvrir);
    etiquette.addEventListener('click', ouvrir);

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
      if (!description || entree.depliee === actif) return;
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
    if (epingle.id === this.selection) {
      point.classList.add('selectionnee');
      etiquette.classList.add('selectionnee');
    }
    return entree;
  }

  _groupeParent(calque) {
    const parent = this.doc?.parentDe(calque.id);
    return parent && parent !== this.doc.racine && parent.type === 'groupe' ? parent : null;
  }

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

      this._versCamera.copy(camera.position).sub(entree.position).normalize();
      const orientation = this._normale.copy(entree.normale).dot(this._versCamera);
      // Two thresholds prevent an annotation on the silhouette from flashing
      // on and off when the camera moves by a fraction of a degree.
      entree.faceVisible = orientation > (entree.faceVisible ? -0.24 : -0.06);
      const dansLeCadre = entree.x >= 0 && entree.x <= largeur && entree.y >= 0 && entree.y <= hauteur;
      entree.visible = !derriere && entree.faceVisible && dansLeCadre && !entree.occulte;
      entree.profondeur = this._position.z;
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
    const obstaclesInterface = [...document.querySelectorAll(
      '.barre-outils, .reglages-outil:not([hidden]), .hint, .viewer-status.visible',
    )].map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const visibles = this.entrees.filter((entree) => entree.visible);

    for (const entree of this.entrees) {
      const cachee = !entree.visible;
      entree.point.classList.toggle('cachee', cachee);
      entree.etiquette.classList.toggle('cachee', cachee);
      entree.ligne.classList.toggle('cachee', cachee);
      if (cachee) continue;
      entree.point.style.transform = `translate3d(${entree.x.toFixed(1)}px, ${entree.y.toFixed(1)}px, 0)`;
      entree.point.style.zIndex = String(1200 - Math.round(entree.profondeur * 500));
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
      || String(a.epingle.id).localeCompare(String(b.epingle.id)));

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
