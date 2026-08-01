// The render layer. Replaces <model-viewer>: same picture, but we own the
// three.js scene, which is what every annotation tool below depends on
// (ray casting into the geometry, custom shaders, render passes).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TONEMAPPINGS = {
  neutre: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  aucun: THREE.NoToneMapping,
};

// OrbitControls counts one full turn as 60 frames × autoRotateSpeed / 6.
// Expressed per second that is 6° per unit, so a speed in degrees per second
// divides by 6.
const DEG_PAR_SECONDE = 6;

// Draws one captured layer over the canvas. Deliberately a bare pass-through:
// the pixels come straight out of the canvas, already tone mapped and already
// in display space, so any conversion three would normally add on the way in
// or out would be one conversion too many. A built-in material cannot be
// talked out of those; four lines of shader can.
//
// The layer's weight is a GL blend constant rather than a material opacity, so
// it scales the image after tone mapping — exactly where CSS used to apply it.
function creerMateriauQuad() {
  return new THREE.ShaderMaterial({
    uniforms: { image: { value: null } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D image;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(image, vUv);
      }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ConstantAlphaFactor,
    blendDst: THREE.OneMinusConstantAlphaFactor,
    blendSrcAlpha: THREE.ConstantAlphaFactor,
    blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
  });
}

// Smallest distance at which the eight corners of the bounding box all fall
// inside the frustum, seen from `direction`. Unlike a bounding-sphere fit it
// takes the shape of the model and of the window into account: a portrait
// window pulls back on its own, a wide one does not waste space.
function distanceDeCadrage(boite, cible, direction, camera) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanH = tanV * camera.aspect;

  const droite = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction);
  if (droite.lengthSq() < 1e-8) droite.set(1, 0, 0);
  droite.normalize();
  const haut = new THREE.Vector3().crossVectors(direction, droite).normalize();

  const coin = new THREE.Vector3();
  let distance = 0;
  for (const x of [boite.min.x, boite.max.x]) {
    for (const y of [boite.min.y, boite.max.y]) {
      for (const z of [boite.min.z, boite.max.z]) {
        coin.set(x, y, z).sub(cible);
        const profondeur = coin.dot(direction);
        distance = Math.max(
          distance,
          profondeur + Math.abs(coin.dot(droite)) / tanH,
          profondeur + Math.abs(coin.dot(haut)) / tanV,
        );
      }
    }
  }
  return distance;
}

export class Scene3D {
  constructor(conteneur, config) {
    this.config = config;
    this.conteneur = conteneur;
    this.couches = [];
    this.mode = 'simple';
    this._dernierTemps = performance.now();
    this._renduDemande = true;

    this.renderer = new THREE.WebGLRenderer({
      antialias: config.rendu.lissage !== false,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.rendu.densitePixelsMax));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = TONEMAPPINGS[config.rendu.tonemapping] ?? THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = config.light.intensity;
    // We clear by hand: the composite mode needs the depth buffer cleared
    // between layers while the colour buffer is kept.
    this.renderer.autoClear = false;
    conteneur.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(config.camera.champVision, 1, 0.01, 200);
    this.camera.position.set(0, 0, 3);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = config.camera.amortissement;
    this.controls.minDistance = config.camera.distanceMin;
    this.controls.maxDistance = config.camera.distanceMax;
    this.controls.autoRotateSpeed = config.affichage.vitesseRotation / DEG_PAR_SECONDE;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.demanderRendu());

    this._redimensionner();
    window.addEventListener('resize', () => this._redimensionner());

    this._boucle = this._boucle.bind(this);
    this.renderer.setAnimationLoop(this._boucle);
  }

  /* ------------------------------------------------------------- couches */

  // One layer per session. All of them live in the same scene and the same
  // coordinate frame (the meshes were aligned onto session 1), so switching
  // sessions is just a visibility swap — no reframing, no camera jump.
  // Indexed by session so the composite stack keeps the order of
  // sessions.json, whatever order the user happened to load them in.
  definirCouche(index, objet) {
    objet.visible = false;
    this.scene.add(objet);
    this.couches[index] = objet;
    this.demanderRendu();
  }

  afficherCouche(index) {
    this.mode = 'simple';
    this.couches.forEach((couche, i) => { couche.visible = i === index; });
    this.demanderRendu();
  }

  afficherComposite() {
    this.mode = 'composite';
    this.demanderRendu();
  }

  /* -------------------------------------------------------------- caméra */

  // Frames the model the way model-viewer did: aimed at the centre of the
  // bounding box, azimuth 0 (front), polar 75°.
  cadrer(boite) {
    const cible = boite.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(1, THREE.MathUtils.degToRad(75), 0),
    );
    const distance = distanceDeCadrage(boite, cible, direction, this.camera)
      * this.config.camera.marge;

    this.controls.target.copy(cible);
    this.camera.position.copy(cible).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 500, 0.001);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.saveState();
    this.demanderRendu();
  }

  recentrer() {
    this.controls.reset();
    this.demanderRendu();
  }

  set rotationAuto(actif) {
    this.controls.autoRotate = actif;
    this.demanderRendu();
  }

  get rotationAuto() {
    return this.controls.autoRotate;
  }

  set exposition(valeur) {
    this.renderer.toneMappingExposure = valeur;
    this.demanderRendu();
  }

  /* --------------------------------------------------------------- rendu */

  _redimensionner() {
    const largeur = this.conteneur.clientWidth || window.innerWidth;
    const hauteur = this.conteneur.clientHeight || window.innerHeight;
    this.renderer.setSize(largeur, hauteur, false);
    this.camera.aspect = largeur / hauteur;
    this.camera.updateProjectionMatrix();
    this.demanderRendu();
  }

  // Most views are static most of the time. Keeping the browser animation
  // callback is useful for damping, auto-rotation and XR, but the expensive
  // WebGL passes only run after a real scene/camera change.
  demanderRendu() {
    this._renduDemande = true;
  }

  _boucle() {
    const maintenant = performance.now();
    // Capped so a backgrounded tab does not come back with a huge jump.
    const delta = Math.min((maintenant - this._dernierTemps) / 1000, 0.1);
    this._dernierTemps = maintenant;
    const controleChange = this.controls.update(delta);
    if (!this._renduDemande && !controleChange) return;
    this._renduDemande = false;
    this.renderer.clear();
    if (this.mode === 'composite') this._rendreComposite();
    else this.renderer.render(this.scene, this.camera);
    if (this.apresRendu?.(controleChange)) this.demanderRendu();
  }

  // Composite mode stacks the three captures the way the old version did:
  // three <model-viewer> elements superimposed with CSS opacities 1, 1/2, 1/3,
  // so that each capture weighs exactly 1/3.
  //
  // What CSS stacked were three *finished images*. That matters more than it
  // sounds: inside one capture, material_fringe is translucent (d 0.45 in the
  // .mtl), so the white webbing lets the real fin rays show through before the
  // layer is stacked at all. Any scheme that touches the materials to apply
  // the layer opacity destroys that — the webbing comes out opaque and hides
  // the texture behind it.
  //
  // So each capture is rendered exactly as it is on its own, straight to the
  // canvas — same materials, same transparency, same tone mapping — then the
  // finished image is copied out. Rendering to an off-screen target instead
  // would not do: three disables tone mapping there, and the layers would
  // blend in linear light rather than in the display space CSS used.
  _rendreComposite() {
    this._preparerCaptures();

    for (const couche of this.couches) if (couche) couche.visible = false;

    this.couches.forEach((couche, i) => {
      if (!couche) return;
      couche.visible = true;
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.copyFramebufferToTexture(this._captures[i]);
      couche.visible = false;
    });

    // Stacking proper: dst = k × couche + (1 − k) × dst, with k as a GL blend
    // constant. Colour and alpha get the same factor, which keeps the buffer's
    // premultiplied alpha consistent over the transparent page background.
    this.renderer.clear();
    this.couches.forEach((couche, i) => {
      if (!couche) return;
      const materiau = this._materiauxQuad[i];
      materiau.uniforms.image.value = this._captures[i];
      materiau.blendAlpha = this._opaciteCouche(i);
      this._quad.material = materiau;
      this.renderer.render(this._sceneQuad, this._cameraQuad);
    });
  }

  // Opacities 1, 1/2, 1/3 … 1/n give every capture the same weight. A single
  // opacity for every layer would let the background bleed through and wash
  // the colours out instead.
  _opaciteCouche(index) {
    const forcee = this.config.affichage.opaciteComposite;
    if (typeof forcee === 'number') return forcee;
    return 1 / (index + 1);
  }

  _preparerCaptures() {
    const taille = this.renderer.getDrawingBufferSize(this._tailleTampon
      || (this._tailleTampon = new THREE.Vector2()));

    if (!this._sceneQuad) {
      this._sceneQuad = new THREE.Scene();
      this._cameraQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
      this._quad.frustumCulled = false;
      this._sceneQuad.add(this._quad);
      this._materiauxQuad = [];
      this._captures = [];
    }

    for (let i = 0; i < this.couches.length; i++) {
      if (!this._materiauxQuad[i]) this._materiauxQuad[i] = creerMateriauQuad();

      const capture = this._captures[i];
      if (capture && capture.image.width === taille.x && capture.image.height === taille.y) continue;
      if (capture) capture.dispose();
      // Deliberately left in the default colour space. Tagging it sRGB would
      // make three allocate an SRGB8_ALPHA8 texture, which the driver refuses
      // to copy an ordinary RGBA8 framebuffer into.
      this._captures[i] = new THREE.FramebufferTexture(taille.x, taille.y);
    }
  }
}
