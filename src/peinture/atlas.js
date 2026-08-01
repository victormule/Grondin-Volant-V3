// The overlay atlas: one texture per capture, holding every paint layer.
//
// Layers store strokes, never pixels. Twenty layers at 2048² of RGBA would be
// 320 MB; here the cost is a handful of render targets whatever the number of
// layers, and the strokes stay editable — colour, opacity and order can all be
// changed after the fact because nothing was ever baked.
//
// ONE ATLAS PER CAPTURE, and this is not an optimisation detail. Each capture
// has its own UV unwrap: a texel at (u, v) is one place on session 1 and a
// completely different place on session 3. A single shared atlas bound to all
// three meshes — which is what this did at first — puts the paint in the right
// place on the reference capture and smears it anywhere at all on the others.
// Invisible while one session is shown alone, glaring in « toutes les
// sessions ». So the same 3D strokes are rasterised once per capture, into that
// capture's own UV space, which is exactly the property the whole design was
// built around.

import * as THREE from 'three';
import {
  EMPREINTES_PAR_PASSE, creerMateriauEmpreintes, creerMateriauComposition,
  creerMateriauCopie, creerMateriauDilatation,
} from './rasteriseur.js';
import { creerMateriauRegion } from './regions.js';

function cible(taille) {
  const rt = new THREE.WebGLRenderTarget(taille, taille, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  return rt;
}

export class AtlasPeinture {
  constructor(renderer, config) {
    this.renderer = renderer;
    this.taille = config.peinture.resolutionAtlas;
    this.dilatations = config.peinture.dilatations;

    // Scratch targets, shared by every capture: they only ever hold one
    // intermediate result at a time.
    this.masque = cible(this.taille);
    this.dessous = cible(this.taille);
    this.dessus = cible(this.taille);
    this.tampon = cible(this.taille);

    this.matEmpreintes = creerMateriauEmpreintes();
    this.matComposition = creerMateriauComposition();
    this.matCopie = creerMateriauCopie();
    this.matDilatation = creerMateriauDilatation();
    this.matDilatation.uniforms.pas.value.set(1 / this.taille, 1 / this.taille);

    // Full-atlas quad, used by every pass that is not a mesh rasterisation.
    this.sceneQuad = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.sceneQuad.add(this.quad);
    this.cameraNulle = new THREE.Camera();

    // Regions are filled with their own triangles rather than with dabs.
    this.matRegion = creerMateriauRegion();
    this.sceneRegion = new THREE.Scene();
    this.meshRegion = new THREE.Mesh(new THREE.BufferGeometry(), this.matRegion);
    this.meshRegion.frustumCulled = false;
    this.sceneRegion.add(this.meshRegion);
    // Set by the application: gives the region geometry of a layer, in the UV
    // space of the capture named by `cle`.
    this.fournirRegion = null;

    this.captures = new Map();
    this.actives = [];
    this.enTrait = false;
    this.calqueActif = null;
    this.opaciteCalqueActif = 1;
    this.apercuCalque = null;
  }

  /* ------------------------------------------------------------ captures */

  // One entry per loaded capture: its own output atlas, and proxy meshes
  // sharing the capture's geometry — rendering those with the UV vertex shader
  // is what fills the atlas. Sharing means no extra geometry in memory.
  enregistrerCapture(cle, racine, session = null) {
    let capture = this.captures.get(cle);
    if (capture && capture.racine === racine) {
      capture.session = session;
      return capture;
    }
    if (capture) capture.sortie.dispose();

    const scene = new THREE.Scene();
    racine.updateMatrixWorld(true);
    racine.traverse((objet) => {
      if (!objet.isMesh || !objet.geometry?.attributes.uv) return;
      const proxy = new THREE.Mesh(objet.geometry, this.matEmpreintes);
      proxy.frustumCulled = false;
      proxy.matrixAutoUpdate = false;
      proxy.matrixWorldAutoUpdate = false;
      proxy.matrix.copy(objet.matrixWorld);
      proxy.matrixWorld.copy(objet.matrixWorld);
      scene.add(proxy);
    });

    capture = {
      cle, racine, session, scene, sortie: cible(this.taille), revisionComposee: null,
    };
    this.captures.set(cle, capture);
    this._brancher(capture);
    return capture;
  }

  // The captures on screen, in stacking order. The first one is where the
  // brush writes: in composite mode that is the reference capture, the frame
  // all the others were aligned onto.
  definirActives(cles) {
    this.actives = cles.map((cle) => this.captures.get(cle)).filter(Boolean);
  }

  get capturePeinture() {
    return this.actives[0] ?? null;
  }

  capture(cle) {
    return this.captures.get(cle) ?? null;
  }

  /* ------------------------------------------------------------- passes */

  // The renderer already clears to transparent black; touching the clear
  // colour here would leak into the main render.
  _viderCible(rt) {
    this.renderer.setRenderTarget(rt);
    this.renderer.clear(true, false, false);
  }

  _quad(materiau, rt, effacer = false) {
    this.quad.material = materiau;
    this.renderer.setRenderTarget(rt);
    if (effacer) this.renderer.clear(true, false, false);
    this.renderer.render(this.sceneQuad, this.cameraNulle);
  }

  // Rasterises a batch of dabs into the currently bound target.
  _passeEmpreintes(capture, rt, empreintes, debut, options) {
    const u = this.matEmpreintes.uniforms;
    const nombre = Math.min(EMPREINTES_PAR_PASSE, empreintes.length - debut);

    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < nombre; i++) {
      const e = empreintes[debut + i];
      u.empreintes.value[i].set(e[0], e[1], e[2], e[6]);
      u.normales.value[i].set(e[3], e[4], e[5]);
      if (e[0] < minX) minX = e[0];
      if (e[0] > maxX) maxX = e[0];
      if (e[1] < minY) minY = e[1];
      if (e[1] > maxY) maxY = e[1];
      if (e[2] < minZ) minZ = e[2];
      if (e[2] > maxZ) maxZ = e[2];
    }
    u.nombre.value = nombre;

    // The batch's bounding sphere, padded by each dab's own radius. The shader
    // rejects everything outside it with a single test; batches are runs of
    // consecutive dabs along one stroke, so the sphere is tight and the
    // rejection throws away almost the whole atlas.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    let rayon = 0;
    for (let i = 0; i < nombre; i++) {
      const e = empreintes[debut + i];
      rayon = Math.max(rayon, Math.hypot(e[0] - cx, e[1] - cy, e[2] - cz) + e[6]);
    }
    u.sphereLot.value.set(cx, cy, cz, rayon);
    u.durete.value = options.durete;
    u.seuilNormale.value = options.seuilNormale;
    u.efface.value = options.efface ? 1 : 0;

    // MAX unions the dabs into the mask, MIN carves them out of it. Strokes
    // are replayed in order, so an eraser only affects what was painted before
    // it — exactly like a layer of paint and a layer of solvent.
    this.matEmpreintes.blendEquation = options.efface ? THREE.MinEquation : THREE.MaxEquation;

    this.renderer.setRenderTarget(rt);
    this.renderer.render(capture.scene, this.cameraNulle);
  }

  // Coverage of one layer, in one capture's UV space. Public because the
  // measurements read it back: an area is the integral of exactly this.
  rasteriserCalque(capture, calque, rt = this.masque, effacer = true) {
    if (effacer) this._viderCible(rt);
    if (!capture) return rt;

    if (calque.type === 'region') {
      const geometrie = this.fournirRegion?.(calque, capture.cle);
      if (!geometrie) return rt;
      this.meshRegion.geometry = geometrie;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.sceneRegion, this.cameraNulle);
      return rt;
    }

    let lot = [];
    let optionsLot = null;
    const viderLot = () => {
      if (!optionsLot || lot.length === 0) return;
      for (let debut = 0; debut < lot.length; debut += EMPREINTES_PAR_PASSE) {
        this._passeEmpreintes(capture, rt, lot, debut, optionsLot);
      }
      lot = [];
    };

    for (const trait of calque.donnees?.elements ?? []) {
      const empreintes = trait.empreintes;
      if (!empreintes || empreintes.length === 0) continue;
      const options = {
        durete: trait.durete ?? 0.5,
        seuilNormale: trait.seuilNormale ?? 0,
        efface: trait.efface === true,
      };
      const memesOptions = optionsLot
        && optionsLot.durete === options.durete
        && optionsLot.seuilNormale === options.seuilNormale
        && optionsLot.efface === options.efface;
      if (!memesOptions) {
        viderLot();
        optionsLot = options;
      }
      // Consecutive strokes with the same brush settings have the same MAX or
      // MIN result whether submitted separately or in batches of 64. Grouping
      // them removes one full mesh draw call per short stroke when an atlas is
      // restored, without changing a single stored dab.
      for (const empreinte of empreintes) lot.push(empreinte);
    }
    viderLot();
    return rt;
  }

  _composerCalque(calque, rt, opacite = calque.opacite) {
    this.matComposition.uniforms.masque.value = this.masque.texture;
    this.matComposition.uniforms.couleur.value.set(calque.couleur);
    this.matComposition.uniforms.opacite.value = opacite;
    this._quad(this.matComposition, rt);
  }

  /* -------------------------------------------------------- composition */

  // Paint and region layers share the atlas: both end up as colour on the
  // surface, and their stacking order has to be the document's.
  //
  // The scope filter uses the capture's own session, not « the session on
  // screen ». In composite mode that is what makes a layer restricted to
  // session 2 appear on capture 2 and nowhere else, instead of on all three.
  calquesPeinture(doc, capture) {
    return doc.aplatir()
      .map(({ calque }) => calque)
      .filter((calque) => (calque.type === 'peinture' || calque.type === 'region')
        && doc.visibleEffectivement(calque.id)
        && doc.concerneSession(calque, capture.session)
        && (calque.donnees?.elements.length ?? 0) > 0);
  }

  // Full recomposition of every capture on screen, bottom layer to top.
  recomposer(doc, revision = null) {
    // A full recomposition ends any stroke in progress by definition. Without
    // this, a missed terminerTrait() would silently freeze the atlas.
    this.enTrait = false;
    this.calqueActif = null;
    this.opaciteCalqueActif = 1;
    this.apercuCalque = null;

    for (const capture of this.actives) {
      if (revision !== null && capture.revisionComposee === revision) continue;
      this._recomposerCapture(doc, capture);
      capture.revisionComposee = revision;
    }
    this.renderer.setRenderTarget(null);
  }

  _recomposerCapture(doc, capture) {
    this._viderCible(capture.sortie);
    for (const calque of this.calquesPeinture(doc, capture)) {
      this.rasteriserCalque(capture, calque, this.masque);
      this._composerCalque(calque, capture.sortie, doc.opaciteEffective(calque.id));
    }
    this._dilater(capture.sortie);
  }

  // While a stroke is being drawn, only the active layer changes. Everything
  // below and above it is rendered once, up front, and reused every frame —
  // otherwise each new dab would cost a full recomposition of every layer.
  //
  // Only the painting capture is kept live; the others catch up in one go when
  // the stroke ends. In composite mode that means a stroke shows at a third of
  // its final strength while the button is down. Paying three rasterisations
  // per dab to avoid that would be the wrong trade.
  debuterTrait(doc, idCalque) {
    const capture = this.capturePeinture;
    if (!capture) return;
    const calques = this.calquesPeinture(doc, capture);
    const actif = doc.trouver(idCalque);
    const index = calques.findIndex((c) => c.id === idCalque);
    this.apercuCalque = null;

    this._viderCible(this.dessous);
    this._viderCible(this.dessus);

    calques.forEach((calque, i) => {
      if (calque.id === idCalque) return;
      const destination = (index === -1 || i > index) ? this.dessus : this.dessous;
      this.rasteriserCalque(capture, calque, this.masque);
      this._composerCalque(calque, destination, doc.opaciteEffective(calque.id));
    });

    this._viderCible(this.masque);
    if (actif) this.rasteriserCalque(capture, actif, this.masque, false);

    this.calqueActif = actif;
    this.opaciteCalqueActif = actif ? doc.opaciteEffective(actif.id) : 1;
    this.enTrait = true;
    this.renderer.setRenderTarget(null);
  }

  // Adds new dabs to the active layer's mask and rebuilds the atlas from the
  // three pre-rendered parts. One rasterisation pass per frame, not one per
  // layer per frame.
  ajouterEmpreintes(empreintes, options) {
    const capture = this.capturePeinture;
    if (!this.enTrait || !capture || empreintes.length === 0) return;

    for (let debut = 0; debut < empreintes.length; debut += EMPREINTES_PAR_PASSE) {
      this._passeEmpreintes(capture, this.masque, empreintes, debut, options);
    }

    this._viderCible(capture.sortie);
    this.matCopie.uniforms.source.value = this.dessous.texture;
    this._quad(this.matCopie, capture.sortie);
    if (this.calqueActif) {
      this._composerCalque(this.calqueActif, capture.sortie, this.opaciteCalqueActif);
    }
    this.matCopie.uniforms.source.value = this.dessus.texture;
    this._quad(this.matCopie, capture.sortie);

    // One seam pass is enough while the hand moves; the committed atlas gets
    // the configured quality immediately after pointer-up.
    this._dilater(capture.sortie, Math.min(1, this.dilatations));
    capture.revisionComposee = null;
    this.renderer.setRenderTarget(null);
  }

  // Lightweight live opacity preview. The selected layer is rasterised once;
  // everything below and above it is flattened once into the two scratch
  // targets. Further slider movements only blend three already-ready textures
  // instead of replaying every brush stroke at 2048².
  previsualiserOpacite(doc, idCalque) {
    const capture = this.capturePeinture;
    if (!capture) return false;
    const calques = this.calquesPeinture(doc, capture);
    const actif = doc.trouver(idCalque);
    const index = calques.findIndex((calque) => calque.id === idCalque);
    if (!actif || index < 0 || (actif.type !== 'peinture' && actif.type !== 'region')) return false;

    const cle = `${capture.cle}:${idCalque}`;
    if (this.apercuCalque?.cle !== cle) {
      this._viderCible(this.dessous);
      this._viderCible(this.dessus);
      calques.forEach((calque, i) => {
        if (i === index) return;
        const destination = i > index ? this.dessus : this.dessous;
        this.rasteriserCalque(capture, calque, this.masque);
        this._composerCalque(calque, destination, doc.opaciteEffective(calque.id));
      });
      this.rasteriserCalque(capture, actif, this.masque);
      this.apercuCalque = { cle };
    }

    this._viderCible(capture.sortie);
    this.matCopie.uniforms.source.value = this.dessous.texture;
    this._quad(this.matCopie, capture.sortie);
    this._composerCalque(actif, capture.sortie, doc.opaciteEffective(actif.id));
    this.matCopie.uniforms.source.value = this.dessus.texture;
    this._quad(this.matCopie, capture.sortie);
    this._dilater(capture.sortie, Math.min(1, this.dilatations));
    capture.revisionComposee = null;
    this.renderer.setRenderTarget(null);
    return true;
  }

  terminerTrait(doc, recomposer = true) {
    this.enTrait = false;
    this.calqueActif = null;
    this.opaciteCalqueActif = 1;
    if (recomposer) this.recomposer(doc);
  }

  _dilater(sortie, passages = this.dilatations) {
    for (let n = 0; n < passages; n++) {
      this.matCopie.uniforms.source.value = sortie.texture;
      this._quad(this.matCopie, this.tampon, true);
      this.matDilatation.uniforms.source.value = this.tampon.texture;
      this._quad(this.matDilatation, sortie);
    }
  }

  /* ------------------------------------------------------------ matériau */

  // Blends the capture's own atlas over the base colour of each of its
  // materials. USE_UV is forced so `vUv` exists whatever textures the glTF
  // happens to carry, rather than relying on the varying of one particular map.
  _brancher(capture) {
    const texture = capture.sortie.texture;
    capture.racine.traverse((objet) => {
      if (!objet.material) return;
      for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) {
        if (m.userData.__atlasBranche) {
          m.userData.__atlasUniforme.value = texture;
          continue;
        }
        m.userData.__atlasBranche = true;
        m.userData.__atlasUniforme = { value: texture };
        m.userData.__opaciteMateriauUniforme ??= { value: m.opacity };
        m.userData.__opaciteModeleUniforme ??= { value: 1 };
        m.defines = { ...m.defines, USE_UV: '' };

        m.onBeforeCompile = (nuanceur) => {
          nuanceur.uniforms.atlasAnnotation = m.userData.__atlasUniforme;
          nuanceur.uniforms.opaciteMateriau = m.userData.__opaciteMateriauUniforme;
          nuanceur.uniforms.opaciteModele = m.userData.__opaciteModeleUniforme;
          const ancre = '#include <color_fragment>';
          if (!nuanceur.fragmentShader.includes(ancre)) {
            // Silent failure here would mean paint that never appears, with
            // nothing in the console to say why.
            console.warn('Atlas non branché : le chunk', ancre, 'est absent du nuanceur.');
            return;
          }
          nuanceur.fragmentShader = nuanceur.fragmentShader
            .replace('#include <common>', `#include <common>
              uniform sampler2D atlasAnnotation;
              uniform float opaciteMateriau;
              uniform float opaciteModele;`)
            .replace(ancre, `${ancre}
              vec4 peintureAnnotation = texture2D(atlasAnnotation, vUv);
              float alphaPeinture = clamp(peintureAnnotation.a, 0.0, 1.0);
              float alphaModele = clamp(diffuseColor.a * opaciteMateriau * opaciteModele, 0.0, 1.0);
              float alphaComposee = alphaPeinture + alphaModele * (1.0 - alphaPeinture);
              float partPeinture = alphaComposee > 0.00001 ? alphaPeinture / alphaComposee : 0.0;
              diffuseColor.rgb = mix(diffuseColor.rgb, peintureAnnotation.rgb, partPeinture);
              diffuseColor.a = alphaComposee;
            `);
        };
        m.needsUpdate = true;
      }
    });
  }

  dispose() {
    for (const rt of [this.masque, this.dessous, this.dessus, this.tampon]) rt.dispose();
    for (const capture of this.captures.values()) capture.sortie.dispose();
    this.captures.clear();
    this.actives = [];
  }
}
