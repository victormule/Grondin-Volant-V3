// Loading and material handling for the photogrammetry meshes.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const chargeur = new GLTFLoader();

export function chargerModele(url, surProgression) {
  return new Promise((resoudre, rejeter) => {
    chargeur.load(
      url,
      (gltf) => {
        const racine = gltf.scene;
        const boite = new THREE.Box3().setFromObject(racine);

        // LA TAILLE D'UN POINT.
        //
        // Un relevé peut arriver en nuage de points plutôt qu'en maillage —
        // c'est la forme honnête d'un LiDAR, qui mesure des points et ne
        // reconstruit une surface qu'en devinant. Le GLTFLoader crée alors un
        // PointsMaterial d'un pixel, sans atténuation, comme le prescrit la
        // spécification glTF : à l'écran, une poussière que le zoom ne fait pas
        // grossir, et l'objet reste illisible de près.
        //
        // On repasse en taille du MONDE, calée sur la diagonale : chaque point
        // couvre alors à peu près le volume qu'il représente, la surface se
        // referme quand on approche et le nuage s'éclaircit quand on recule —
        // ce qui est exactement ce qu'un nuage doit montrer de sa densité.
        const diagonale = boite.getSize(new THREE.Vector3()).length();
        racine.traverse((objet) => {
          if (!objet.isPoints || !objet.material) return;
          objet.material.sizeAttenuation = true;
          objet.material.size = diagonale / 700;
        });

        resoudre({ racine, boite });
      },
      (evenement) => {
        if (!surProgression || !evenement.lengthComputable) return;
        surProgression(evenement.loaded / evenement.total);
      },
      rejeter,
    );
  });
}

// Roughness and metalness are applied on the fly, so the .glb files never need
// regenerating after a change — same behaviour as before.
export function appliquerMatiere(racine, { rugosite, metal, opacite = 1, anisotropie }) {
  const facteurOpacite = THREE.MathUtils.clamp(Number(opacite), 0, 1);
  racine.traverse((objet) => {
    if (!objet.material) return;
    for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) {
      // Un nuage de points n'est pas branché sur l'atlas : son opacité ne
      // transite par aucun nuanceur, elle s'applique directement. Sans ce cas,
      // le curseur « opacité du modèle » resterait sans effet sur lui.
      if (!objet.isMesh) {
        m.opacity = facteurOpacite;
        m.transparent = facteurOpacite < 1;
        continue;
      }
      if (m.roughness !== undefined) m.roughness = rugosite;
      if (m.metalness !== undefined) m.metalness = metal;

      // Keep both opacity factors as shader uniforms. The atlas compositor can
      // then fade the photographic model underneath without fading paint and
      // region layers that live on the same mesh.
      if (m.userData.__opaciteModeleOrigine === undefined) {
        m.userData.__opaciteModeleOrigine = m.opacity;
        m.userData.__transparenceModeleOrigine = m.transparent;
        m.userData.__opaciteMateriauUniforme = { value: m.opacity };
        m.userData.__opaciteModeleUniforme = { value: facteurOpacite };
      }
      m.userData.__opaciteModeleUniforme.value = facteurOpacite;
      const transparenteAvant = m.transparent;
      // The custom shader applies the original material alpha and the model
      // slider separately; leaving opacity here at 1 avoids multiplying the
      // annotation atlas a second time in three.js' ordinary alpha path.
      m.opacity = 1;
      m.transparent = m.userData.__transparenceModeleOrigine || facteurOpacite < 1;
      if (m.transparent !== transparenteAvant) m.needsUpdate = true;

      if (anisotropie === undefined) continue;
      // Photogrammetry textures are large and viewed at grazing angles all the
      // time; without anisotropic filtering the scales turn to mush.
      for (const carte of [m.map, m.normalMap, m.aoMap, m.roughnessMap]) {
        if (carte && carte.anisotropy !== anisotropie) {
          carte.anisotropy = anisotropie;
          carte.needsUpdate = true;
        }
      }
    }
  });
}
