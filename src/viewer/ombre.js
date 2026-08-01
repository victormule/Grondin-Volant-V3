// Ground shadow, the equivalent of model-viewer's shadow-intensity /
// shadow-softness. There is no punctual light in the scene (the lighting is
// purely image-based), so the shadow cannot come from a shadow map: it is
// rendered on its own.
//
// The model is photographed from below by an orthographic camera; each
// fragment writes an alpha proportional to how close it is to the ground.
// The result is blurred twice and laid on a plane under the specimen — a
// contact shadow, dark and tight under the body, fading out with height.

import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

const RESOLUTION = 512;

// model-viewer's shadow-intensity does not translate one to one onto this
// technique: at an equal setting ours came out darker. The factor below was
// calibrated against the old viewer, measured on the band of pixels under the
// specimen, so that the value in config.js keeps meaning what it used to.
// (The blur scale needed no such correction: at config's douceur 0.8 the two
// shadows already spread the same, and the measurement is flat around there.)
const FACTEUR_INTENSITE = 0.43;
const FLOU_MIN = 0.3;
const FLOU_AMPLITUDE = 2.5;

export class OmbreContact {
  constructor(renderer, scene, config) {
    this.renderer = renderer;
    this.scene = scene;
    this.config = config;
    this.taille = 1;
    this.surChangement = null;

    this.groupe = new THREE.Group();
    scene.add(this.groupe);

    this.cible = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION);
    this.cible.texture.generateMipmaps = false;
    this.cibleFlou = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION);
    this.cibleFlou.texture.generateMipmaps = false;

    const geometrie = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);

    this.plan = new THREE.Mesh(geometrie, new THREE.MeshBasicMaterial({
      map: this.cible.texture,
      opacity: config.ombre.intensite * FACTEUR_INTENSITE,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }));
    this.plan.renderOrder = 1;
    this.plan.scale.y = -1; // the texture comes out flipped on this axis
    this.groupe.add(this.plan);

    // Used only as a full-screen quad for the two blur passes.
    this.planFlou = new THREE.Mesh(geometrie);
    this.planFlou.visible = false;
    this.groupe.add(this.planFlou);

    this.cameraOmbre = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    this.cameraOmbre.rotation.x = Math.PI / 2; // look straight up
    this.groupe.add(this.cameraOmbre);

    this.materiauProfondeur = new THREE.ShaderMaterial({
      uniforms: { noirceur: { value: 1 } },
      vertexShader: /* glsl */`
        varying float vProfondeur;
        void main() {
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p;
          vProfondeur = p.z * 0.5 + 0.5;
        }`,
      fragmentShader: /* glsl */`
        uniform float noirceur;
        varying float vProfondeur;
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - clamp(vProfondeur, 0.0, 1.0)) * noirceur);
        }`,
      side: THREE.DoubleSide,
      // No blending and depth testing on: only the lowest surface above each
      // point contributes, so overlapping geometry cannot stack up into an
      // artificially dark blob.
      blending: THREE.NoBlending,
      depthTest: true,
      depthWrite: true,
    });

    this.flouH = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.flouH.depthTest = false;
    this.flouV = new THREE.ShaderMaterial(VerticalBlurShader);
    this.flouV.depthTest = false;
  }

  set visible(valeur) {
    this.groupe.visible = valeur;
    this.surChangement?.();
  }

  set intensite(valeur) {
    this.plan.material.opacity = valeur * FACTEUR_INTENSITE;
    this.surChangement?.();
  }

  // Sizes the shadow to the model and places it on its lowest point.
  ajuster(boite) {
    const dimensions = boite.getSize(new THREE.Vector3());
    const centre = boite.getCenter(new THREE.Vector3());
    const taille = Math.max(dimensions.x, dimensions.z) * this.config.ombre.taillePlan;
    const hauteur = Math.max(dimensions.y * this.config.ombre.hauteur, 1e-4);

    this.taille = taille;
    this.groupe.position.set(centre.x, boite.min.y, centre.z);
    this.plan.scale.set(taille, -1, taille);
    this.planFlou.scale.set(taille, 1, taille);

    this.cameraOmbre.left = -taille / 2;
    this.cameraOmbre.right = taille / 2;
    this.cameraOmbre.top = taille / 2;
    this.cameraOmbre.bottom = -taille / 2;
    this.cameraOmbre.far = hauteur;
    this.cameraOmbre.updateProjectionMatrix();
  }

  // Called when the model changes, not every frame: nothing here moves.
  rafraichir() {
    this.plan.visible = false;
    this.scene.overrideMaterial = this.materiauProfondeur;

    this.renderer.setRenderTarget(this.cible);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cameraOmbre);

    this.scene.overrideMaterial = null;

    const flou = FLOU_MIN + this.config.ombre.douceur * FLOU_AMPLITUDE;
    this._flouter(flou);
    this._flouter(flou * 0.4);

    this.renderer.setRenderTarget(null);
    this.plan.visible = true;
    this.surChangement?.();
  }

  _flouter(quantite) {
    this.planFlou.visible = true;

    this.planFlou.material = this.flouH;
    this.flouH.uniforms.tDiffuse.value = this.cible.texture;
    this.flouH.uniforms.h.value = quantite / RESOLUTION;
    this.renderer.setRenderTarget(this.cibleFlou);
    this.renderer.clear();
    this.renderer.render(this.planFlou, this.cameraOmbre);

    this.planFlou.material = this.flouV;
    this.flouV.uniforms.tDiffuse.value = this.cibleFlou.texture;
    this.flouV.uniforms.v.value = quantite / RESOLUTION;
    this.renderer.setRenderTarget(this.cible);
    this.renderer.clear();
    this.renderer.render(this.planFlou, this.cameraOmbre);

    this.planFlou.visible = false;
  }
}
