// Lighting. Two modes:
//   « fixe »    — a neutral studio environment, identical from every viewpoint.
//   « dirigée » — that same environment dimmed to a fill, plus one key light
//                 you aim yourself and that stays where you put it.
//
// The cursor mode this replaces painted an equirectangular environment into a
// canvas and ran PMREM over it on every pointer move: a canvas redraw, a
// texture upload and a seven-level prefilter, sixty times a second. That is
// what made it heavy, and it could not do the one thing it was wanted for.
//
// A prefiltered environment is diffuse by construction — it is an average of
// everything around the specimen. Raking light is the opposite: a single source
// almost parallel to the surface, whose whole value is that it is NOT averaged.
// No amount of blurred image-based lighting produces it. A directional light
// does, costs nothing to move, and drives the normal map the captures carry,
// which is where the relief of the scales and the fin rays actually lives.
//
// The key light is aimed in CAMERA SPACE, not world space. That is deliberate:
// a raking angle found in world space stops raking the moment you orbit, and
// the point of the tool is to hold a grazing look while you turn the specimen
// to choose the view.

import * as THREE from 'three';
import { construireEnvironnementNeutre } from './environnement-neutre.js';

// The scene below is model-viewer's, to the number. Its *shape* therefore
// matches exactly — the calibration sweep showed the error was a pure scale,
// identical over the whole specimen. It comes from the conversion: model-viewer
// renders the scene into a cube map and blurs it itself before three turns it
// into a radiance map, where we hand the scene straight to three. At 1.29 the
// difference against the old viewer falls to 0.4 on 255, i.e. nothing.
const INTENSITE_ENV_NEUTRE = 1.29;

const _base = new THREE.Matrix4();
const _direction = new THREE.Vector3();

export class Eclairage {
  constructor(renderer, scene, config, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.config = config;
    this.camera = camera;
    this.mode = 'fixe';
    this.surChangement = null;

    const reglages = config.light.dirigee ?? {};
    this.ambiance = reglages.ambiance ?? 0.32;
    this.angleMax = reglages.angleMax ?? 110;
    // Where the light sits on the disc: centre is straight down the lens,
    // the rim is fully grazing.
    this.x = reglages.x ?? -0.55;
    this.y = reglages.y ?? 0.5;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    // Generated once and kept: it never changes, in either mode. Sigma 0.04 is
    // the blur model-viewer applies to the same scene.
    this.envNeutre = this.pmrem.fromScene(construireEnvironnementNeutre(), 0.04).texture;
    this.scene.environment = this.envNeutre;
    this.scene.environmentIntensity = INTENSITE_ENV_NEUTRE;

    this.cle = new THREE.DirectionalLight(0xfff6ea, reglages.intensite ?? 3.6);
    this.cle.visible = false;
    // A directional light points from its position at its target, and the
    // target has to be in the scene for its world matrix to be computed.
    this.cle.target.position.set(0, 0, 0);

    // NO SHADOW MAP, and that was measured rather than assumed.
    //
    // Adding one looks like the obvious way to give a grazing light its drama,
    // and on this specimen it did the exact opposite. A surface lit at eighty
    // degrees is nearly parallel to the beam, which is the worst case a shadow
    // map has: the depth gradient across a single texel is enormous, and no
    // bias setting separates « behind something » from « very nearly edge-on ».
    // The whole flank fell into shadow at once, in a flat black with a hard
    // edge. The pectoral fin — every ray separated, the membrane glowing, the
    // one genuinely beautiful thing the raking light produces here — was
    // completely swallowed. Without the shadow map it comes back.
    //
    // What is left is the plain N·L falloff, and it is enough, because that is
    // where the relief actually lives: the base mesh is coarse, but the normal
    // map the captures carry modulates it exactly where the light grazes.
    this.scene.add(this.cle, this.cle.target);

    this.centre = new THREE.Vector3();
    this.rayon = 1;
  }

  // The specimen's bounding box, so the light sits outside it whatever the
  // scale of the capture.
  cadrer(boite) {
    boite.getCenter(this.centre);
    this.rayon = Math.max(boite.getSize(new THREE.Vector3()).length() * 0.5, 1e-3);
    this.orienter();
  }

  setMode(mode) {
    this.mode = mode === 'dirigee' ? 'dirigee' : 'fixe';
    const dirige = this.mode === 'dirigee';
    this.cle.visible = dirige;
    // In directed mode the environment stops being the light and becomes the
    // fill: dimming it is what lets the key light carve anything at all.
    this.scene.environmentIntensity = dirige
      ? INTENSITE_ENV_NEUTRE * this.ambiance
      : INTENSITE_ENV_NEUTRE;
    this.orienter();
    this.surChangement?.();
  }

  // Disc coordinates, both in [-1, 1]. The radius is the angle away from the
  // camera axis: 0 at the centre (flat frontal light, no relief at all), 1 at
  // the rim (grazing, maximum relief).
  definirDirection(x, y) {
    this.x = x;
    this.y = y;
    this.orienter();
    this.surChangement?.();
  }

  definirAmbiance(valeur) {
    this.ambiance = Math.max(0, Math.min(1, valeur));
    if (this.mode === 'dirigee') {
      this.scene.environmentIntensity = INTENSITE_ENV_NEUTRE * this.ambiance;
    }
    this.surChangement?.();
  }

  definirIntensite(valeur) {
    this.cle.intensity = valeur;
    this.surChangement?.();
  }

  // Called before every frame: the direction is expressed relative to the
  // camera, so it has to be rebuilt whenever the camera has moved.
  orienter() {
    if (this.mode !== 'dirigee') return;

    const r = Math.min(1, Math.hypot(this.x, this.y));
    const theta = THREE.MathUtils.degToRad(r * this.angleMax);
    const sin = Math.sin(theta);
    // At the exact centre there is no direction to speak of; straight down the
    // lens is the honest answer and avoids a division by zero.
    const ux = r > 1e-6 ? this.x / r : 0;
    const uy = r > 1e-6 ? this.y / r : 0;

    // Camera space: x right, y up, z towards the viewer. Past 90° the light
    // passes behind the specimen and rims the translucent fin webbing, which
    // is why the disc is allowed to go a little beyond its grazing ring.
    _direction.set(ux * sin, uy * sin, Math.cos(theta));
    this.camera.updateMatrixWorld();
    _base.extractRotation(this.camera.matrixWorld);
    _direction.applyMatrix4(_base).normalize();

    this.cle.target.position.copy(this.centre);
    this.cle.position.copy(this.centre).addScaledVector(_direction, this.rayon * 4);
    this.cle.target.updateMatrixWorld();
  }

  // How grazing the current direction is, for the read-out. 0° is straight
  // down the lens, 90° is exactly grazing.
  get angle() {
    return Math.min(1, Math.hypot(this.x, this.y)) * this.angleMax;
  }
}
