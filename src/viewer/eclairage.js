// Lighting. Two modes, same as before:
//   "fixe"   — a neutral studio environment, identical from every viewpoint.
//   "souris" — a procedural equirectangular environment with one bright key
//              light, redrawn as the pointer moves.
// Both are image-based: there is no punctual light in the scene, which is why
// the specimen keeps the soft, even look of the original viewer.

import * as THREE from 'three';
import { construireEnvironnementNeutre } from './environnement-neutre.js';

// The scene below is model-viewer's, to the number. Its *shape* therefore
// matches exactly — the calibration sweep showed the error was a pure scale,
// identical over the whole specimen. It comes from the conversion: model-viewer
// renders the scene into a cube map and blurs it itself before three turns it
// into a radiance map, where we hand the scene straight to three. At 1.29 the
// difference against the old viewer falls to 0.4 on 255, i.e. nothing.
// Applies to the fixed environment only; the cursor one is drawn by hand.
const INTENSITE_ENV_NEUTRE = 1.29;

export class Eclairage {
  constructor(renderer, scene, config) {
    this.renderer = renderer;
    this.scene = scene;
    this.config = config;
    this.mode = 'fixe';

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    // The neutral environment is generated once and kept: it never changes.
    // Sigma 0.04 is the blur model-viewer applies to the same scene.
    this.envNeutre = this.pmrem.fromScene(construireEnvironnementNeutre(), 0.04).texture;

    // Canvas the cursor environment is painted into, then read as an
    // equirectangular map.
    this.toile = document.createElement('canvas');
    this.toile.width = 512;
    this.toile.height = 256;
    this.ctx = this.toile.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.toile);
    this.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.cibleSouris = null;
    this.surChangement = null;

    this.azimut = 35;
    this.elevation = 60;
    this._miseAJourEnAttente = false;

    window.addEventListener('pointermove', (evenement) => {
      if (this.mode !== 'souris') return;
      this.azimut = (evenement.clientX / window.innerWidth) * 360;
      this.elevation = 85 - (evenement.clientY / window.innerHeight) * 70;
      this._planifier();
    });
  }

  setMode(mode) {
    this.mode = mode === 'souris' ? 'souris' : 'fixe';
    if (this.mode === 'fixe') {
      this.scene.environmentIntensity = INTENSITE_ENV_NEUTRE;
      this.scene.environment = this.envNeutre;
    } else {
      this.scene.environmentIntensity = 1;
      this._dessiner();
    }
    this.surChangement?.();
  }

  _planifier() {
    if (this._miseAJourEnAttente) return;
    this._miseAJourEnAttente = true;
    requestAnimationFrame(() => {
      this._miseAJourEnAttente = false;
      if (this.mode === 'souris') this._dessiner();
    });
  }

  _gris(fraction) {
    const v = Math.round(Math.max(0, Math.min(1, fraction)) * 255);
    return `rgb(${v},${v},${v})`;
  }

  _dessiner() {
    const { width, height } = this.toile;
    const ambiance = this.config.light.souris.ambiance;

    const ciel = this.ctx.createLinearGradient(0, 0, 0, height);
    ciel.addColorStop(0, this._gris(ambiance * 1.25));
    ciel.addColorStop(0.5, this._gris(ambiance * 0.95));
    ciel.addColorStop(1, this._gris(ambiance * 0.6));
    this.ctx.fillStyle = ciel;
    this.ctx.fillRect(0, 0, width, height);

    const x = (this.azimut / 360) * width;
    const y = ((90 - this.elevation) / 180) * height;
    const rayon = width * this.config.light.souris.tailleSource;
    const force = this.config.light.souris.intensiteSource;

    // Drawn three times so the highlight wraps seamlessly across the seam.
    for (const xx of [x - width, x, x + width]) {
      const halo = this.ctx.createRadialGradient(xx, y, 0, xx, y, rayon);
      halo.addColorStop(0, `rgba(255,253,247,${force})`);
      halo.addColorStop(0.35, `rgba(255,250,240,${force * 0.65})`);
      halo.addColorStop(1, 'rgba(255,248,235,0)');
      this.ctx.fillStyle = halo;
      this.ctx.fillRect(0, 0, width, height);
    }

    this.texture.needsUpdate = true;
    // Reusing the same render target keeps the pointer-move path free of
    // allocations: without it, every mouse move would leak a cube map.
    this.cibleSouris = this.pmrem.fromEquirectangular(this.texture, this.cibleSouris);
    this.scene.environment = this.cibleSouris.texture;
    this.surChangement?.();
  }
}
