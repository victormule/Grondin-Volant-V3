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

// Scratch objects for the turntable, so a rotation costs no allocation per
// frame.
const _quaternion = new THREE.Quaternion();
const _decalage = new THREE.Vector3();
const _hautMonde = new THREE.Vector3(0, 1, 0);

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
    // Comment les captures se mélangent quand elles sont toutes à l'écran, et
    // le poids de chacune. Voir definirMelange.
    this.melangeComposite = 'moyenne';
    this.poidsComposite = [];
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
  // the manifest, whatever order the user happened to load them in.
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

  // Runs `action` with every loaded capture visible, then puts the visibility
  // back as it was.
  //
  // For the contact shadow, which is cast by photographing the scene from
  // below. In composite mode that pass would come back empty: the three
  // captures are made visible one at a time inside the frame and all left
  // hidden between frames, so anything looking at the scene from outside the
  // render loop sees nothing at all.
  avecToutesLesCouches(action) {
    const etats = this.couches.map((couche) => couche?.visible);
    for (const couche of this.couches) if (couche) couche.visible = true;
    try {
      action();
    } finally {
      this.couches.forEach((couche, i) => { if (couche) couche.visible = etats[i]; });
    }
  }

  /* -------------------------------------------------------------- caméra */

  // The opening view, and the one « Recentrer » comes back to.
  //
  // Aimed at the centre of the bounding box, from an azimuth and an elevation
  // set in the settings. Angles rather than a stored camera position: the
  // framing distance still has to be computed from the bounding box, so that
  // the specimen fills the same share of the frame whatever its size and
  // whatever the window it is shown in.
  cadrer(boite) {
    const vue = this.config.affichage.vueInitiale ?? {};
    const azimut = Number.isFinite(vue.azimut) ? vue.azimut : 0;
    // Given as a height above the horizon, which is how one describes a
    // viewpoint; three counts its polar angle down from the vertical.
    const elevation = Number.isFinite(vue.elevation) ? vue.elevation : 15;
    const marge = (Number.isFinite(vue.marge) ? vue.marge : 1) * this.config.camera.marge;

    const cible = boite.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3().setFromSpherical(new THREE.Spherical(
      1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimut),
    ));
    // The elevation is measured from up, so it has to be tilted into the
    // specimen's own up — otherwise the opening view is the only one in the
    // application still framed on the capture's accidental horizon.
    if (this.aplomb) {
      direction.applyQuaternion(_quaternion.setFromUnitVectors(_hautMonde, this.aplomb));
    }
    const distance = distanceDeCadrage(boite, cible, direction, this.camera) * marge;

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

  // The current viewpoint, written as the settings that would reproduce it.
  //
  // Choosing an opening view by editing three numbers and reloading is a slow
  // way to work; placing the specimen by hand and reading the numbers off is
  // not. Exposed on window.DURAIR for exactly that.
  vueActuelle() {
    const decalage = this.camera.position.clone().sub(this.controls.target);
    if (this.aplomb) {
      decalage.applyQuaternion(_quaternion.setFromUnitVectors(this.aplomb, _hautMonde));
    }
    const spherique = new THREE.Spherical().setFromVector3(decalage);
    const boite = new THREE.Box3();
    for (const couche of this.couches) if (couche) boite.expandByObject(couche);
    const reference = distanceDeCadrage(boite, boite.getCenter(new THREE.Vector3()),
      decalage.clone().normalize(), this.camera) * this.config.camera.marge;
    return {
      azimut: Math.round(THREE.MathUtils.radToDeg(spherique.theta) * 10) / 10,
      elevation: Math.round((90 - THREE.MathUtils.radToDeg(spherique.phi)) * 10) / 10,
      marge: Math.round((spherique.radius / reference) * 1000) / 1000,
    };
  }

  // Which way is up for THIS specimen: the normal of its own base plate.
  //
  // The captures were made on a phone held in the hand, so the frame they came
  // back in is level to nothing in particular — the little rectangular plinth
  // sits about 2,3° off horizontal, and the whole mount reads as tilted from
  // every viewpoint. The fix is not to rewrite the meshes: the pins, the paint
  // dabs and the measurement points are all stored as coordinates in that same
  // frame, and turning the geometry under them would tear every annotation off
  // the specimen — and silently misplace any draft already saved in a browser.
  //
  // Nothing moves. What changes is which direction the camera calls up, so
  // orbiting sweeps around the plinth's own vertical instead of the capture's.
  // The specimen sits level, the fish keeps the slight forward lean it really
  // has, and all three captures inherit it at once because they share one frame.
  definirAplomb(normale) {
    const haut = normale ? new THREE.Vector3(...normale) : null;
    if (!haut || haut.lengthSq() < 1e-12) {
      this.aplomb = null;
      this.camera.up.copy(_hautMonde);
    } else {
      this.aplomb = haut.normalize();
      this.camera.up.copy(this.aplomb);
    }
    this.demanderRendu();
  }

  // The axis the turntable spins about: a point it passes through, and a
  // direction. Null falls back to OrbitControls' own auto-rotation, which is
  // world-Y through the target.
  definirAxeRotation(axe) {
    if (!axe?.point || !axe?.direction) { this.axeRotation = null; return; }
    const direction = new THREE.Vector3(...axe.direction);
    if (direction.lengthSq() < 1e-12) { this.axeRotation = null; return; }
    this.axeRotation = {
      point: new THREE.Vector3(...axe.point),
      direction: direction.normalize(),
    };
  }

  // Turning about the mounting rod rather than about the middle of the scene.
  //
  // OrbitControls can only spin about world Y through its target, and neither
  // half of that is what this specimen needs. The target is the centre of the
  // bounding box — which here is the middle of the DRAPED TABLE, the fish
  // being a small thing perched above and to one side — so the specimen swung
  // around a distant axis like a fairground ride instead of turning on itself.
  // And the rod leans 2,3° off vertical, so even a target moved onto it would
  // still have left the fish wobbling once per revolution.
  //
  // What rotates is the camera, never the model: the pins, the paint atlas and
  // the measurements are all anchored in world space, and turning the meshes
  // under them would tear every annotation off the specimen. Rotating the eye
  // and its target together about the rod is the same picture, and costs
  // nothing.
  set rotationAuto(actif) {
    this._rotationAuto = Boolean(actif);
    // Only hand the job back to OrbitControls when no axis was measured.
    this.controls.autoRotate = this._rotationAuto && !this.axeRotation;
    this.demanderRendu();
  }

  get rotationAuto() {
    return this._rotationAuto ?? false;
  }

  _tournerAutourDeLAxe(delta) {
    if (!this._rotationAuto || !this.axeRotation || delta <= 0) return false;
    const angle = THREE.MathUtils.degToRad(this.config.affichage.vitesseRotation) * delta;
    const { point, direction } = this.axeRotation;

    _quaternion.setFromAxisAngle(direction, angle);
    for (const vecteur of [this.camera.position, this.controls.target]) {
      _decalage.subVectors(vecteur, point).applyQuaternion(_quaternion);
      vecteur.copy(point).add(_decalage);
    }
    return true;
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
    // Before the controls settle: they read the camera and the target, so the
    // turn has to be in place by the time they do, or damping spends the frame
    // undoing it.
    const tourne = this._tournerAutourDeLAxe(delta);
    const controleChange = this.controls.update(delta) || tourne;
    if (!this._renduDemande && !controleChange) return;
    this._renduDemande = false;
    // Anything expressed relative to the camera — the directed key light — has
    // to be rebuilt here, once the controls have settled and before the frame
    // is drawn, or it trails the view by one image.
    this.avantRendu?.();
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

  // DEUX FAÇONS D'EMPILER, UN SEUL JEU DE POIDS.
  //
  // « Moyenne » : chaque capture pèse pareil dans l'image finale — c'est le
  // mode d'origine, celui qui sert à voir ce que trois relevés du même objet
  // ont en commun et où ils divergent. Les opacités 1, 1/2, 1/3 … donnent
  // exactement ça : la n-ième posée à 1/n sur la moyenne des précédentes.
  //
  // « Superposition » : chaque capture recouvre celle du dessous à l'opacité
  // qu'on lui donne, la première tout en bas, la dernière tout en haut. C'est
  // le calque au sens ordinaire — poser le LiDAR à 40 % sur la photogrammétrie
  // pour voir l'un à travers l'autre.
  //
  // Les deux lisent le même tableau de poids. Avec des poids tous à un, la
  // moyenne pondérée redonne 1/(index+1) : le comportement d'avant, au bit près.
  definirMelange(mode, poids) {
    this.melangeComposite = mode === 'pile' ? 'pile' : 'moyenne';
    if (Array.isArray(poids)) this.poidsComposite = poids.slice();
    if (this.mode === 'composite') this.demanderRendu();
  }

  _poidsCouche(index) {
    const p = this.poidsComposite?.[index];
    return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1;
  }

  _opaciteCouche(index) {
    const forcee = this.config.affichage.opaciteComposite;
    if (typeof forcee === 'number') return forcee;
    const poids = this._poidsCouche(index);
    if (this.melangeComposite === 'pile') return poids;
    // Moyenne pondérée : la couche pèse sa part de tout ce qui est déjà posé.
    // Les couches absentes ne comptent pas — sinon la première capture chargée
    // d'un objet à trous serait posée à un demi sur du vide.
    let cumul = 0;
    for (let i = 0; i <= index; i += 1) if (this.couches[i]) cumul += this._poidsCouche(i);
    return cumul > 0 ? poids / cumul : 0;
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
