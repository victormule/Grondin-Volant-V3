// Rendu de gaussiennes (3D Gaussian Splatting) dans la scène three.js.
//
// Le fichier est au format « .splat » : 32 octets par gaussienne, dans l'ordre
//   position  3 × float32      (mètres, déjà dans le repère de l'objet)
//   échelle   3 × float32      (écarts-types, linéaires)
//   couleur   4 × uint8        (RGBA, alpha = opacité de la gaussienne)
//   rotation  4 × uint8        (quaternion w, x, y, z, codé q·128 + 128)
// C'est le format que l'ingestion écrit (outils/ingerer.mjs).
//
// UNE GAUSSIENNE EST UNE TACHE, PAS UN POINT. Chacune est un quadrilatère
// instancié que le nuanceur de sommets étire selon la projection de sa
// covariance 3D à l'écran, et que le nuanceur de fragments estompe en
// exp(−r²). Les taches se mélangent par-dessus le fond, de la plus lointaine à
// la plus proche : c'est ce tri, refait quand la caméra tourne, qui fait la
// différence entre un rendu et un tas de pastilles.
//
// Une couche splat se comporte comme les autres couches de Scene3D : un objet
// à poser dans la scène, une opacité réglable (uniforme « uOpacite »), et rien
// qui prétende être un maillage — on ne la peint pas, on ne la mesure pas.

import * as THREE from 'three';

const SPLATS_PAR_LIGNE = 1024;
const TEXELS_PAR_SPLAT = 3;

const SOMMETS = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform highp sampler2D uDonnees;
  uniform vec2 uViewport;
  uniform vec2 uFocale;
  attribute float indice;

  varying vec4 vCouleur;
  varying vec2 vPosition;

  void main() {
    uint i = uint(indice);
    int x = int(i & 1023u) * 3;
    int y = int(i >> 10u);
    vec4 t0 = texelFetch(uDonnees, ivec2(x, y), 0);
    vec4 t1 = texelFetch(uDonnees, ivec2(x + 1, y), 0);
    vec4 t2 = texelFetch(uDonnees, ivec2(x + 2, y), 0);

    vec4 cam = modelViewMatrix * vec4(t0.xyz, 1.0);
    vec4 clip = projectionMatrix * cam;
    float marge = 1.3 * clip.w;
    if (cam.z > -0.0001 || clip.x < -marge || clip.x > marge || clip.y < -marge || clip.y > marge) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    // Covariance 3D (symétrique) puis sa projection : Σ' = J·W·Σ·Wᵀ·Jᵀ.
    mat3 sigma = mat3(t1.x, t1.y, t1.z,
                      t1.y, t1.w, t2.x,
                      t1.z, t2.x, t2.y);
    mat3 J = mat3(
      uFocale.x / -cam.z, 0.0, 0.0,
      0.0, uFocale.y / -cam.z, 0.0,
      uFocale.x * cam.x / (cam.z * cam.z), uFocale.y * cam.y / (cam.z * cam.z), 0.0);
    mat3 W = mat3(modelViewMatrix);
    mat3 T = J * W;
    mat3 cov = T * sigma * transpose(T);
    // Filtre passe-bas d'un demi-pixel : une gaussienne plus fine qu'un pixel
    // scintillerait au lieu de s'éteindre.
    float a = cov[0][0] + 0.3;
    float b = cov[0][1];
    float d = cov[1][1] + 0.3;

    float milieu = 0.5 * (a + d);
    float rayon = length(vec2(0.5 * (a - d), b));
    float l1 = milieu + rayon;
    float l2 = milieu - rayon;
    if (l2 <= 0.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    vec2 diag = normalize(vec2(b, l1 - a));
    vec2 grand = min(sqrt(2.0 * l1), 1024.0) * diag;
    vec2 petit = min(sqrt(2.0 * l2), 1024.0) * vec2(diag.y, -diag.x);

    float rg = t0.w;
    float ba = t2.z;
    vCouleur = vec4(floor(rg / 256.0), mod(rg, 256.0), floor(ba / 256.0), mod(ba, 256.0)) / 255.0;
    vPosition = position.xy;

    vec2 decalage = (position.x * grand + position.y * petit) * 2.0 / uViewport;
    gl_Position = vec4(clip.xy / clip.w + decalage, clip.z / clip.w, 1.0);
  }
`;

const FRAGMENTS = /* glsl */ `
  precision highp float;
  uniform float uOpacite;
  varying vec4 vCouleur;
  varying vec2 vPosition;

  void main() {
    float A = -dot(vPosition, vPosition);
    if (A < -4.0) discard;
    float alpha = exp(A) * vCouleur.a * uOpacite;
    if (alpha < 1.0 / 255.0) discard;
    // Prémultiplié : le canevas l'est, et le fond de la page est transparent.
    gl_FragColor = vec4(vCouleur.rgb * alpha, alpha);
  }
`;

// Matrice de covariance Σ = M·Mᵀ avec M = R·diag(s), rangée en six valeurs.
function covariance(echelle, q, sortie) {
  let [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const m = [];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) m.push(r[i * 3 + j] * echelle[j]);
  const s = (i, j) => m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2];
  sortie[0] = s(0, 0); sortie[1] = s(0, 1); sortie[2] = s(0, 2);
  sortie[3] = s(1, 1); sortie[4] = s(1, 2); sortie[5] = s(2, 2);
}

export class CoucheSplat extends THREE.Mesh {
  constructor(tampon) {
    const n = Math.floor(tampon.byteLength / 32);
    const octets = new Uint8Array(tampon);
    const flottants = new Float32Array(tampon, 0, n * 8);

    const lignes = Math.ceil(n / SPLATS_PAR_LIGNE);
    const donnees = new Float32Array(SPLATS_PAR_LIGNE * lignes * TEXELS_PAR_SPLAT * 4);
    const positions = new Float32Array(n * 3);
    const cov = new Float32Array(6);
    const boite = new THREE.Box3();

    for (let i = 0; i < n; i += 1) {
      const f = i * 8;
      const o = i * 32;
      const px = flottants[f]; const py = flottants[f + 1]; const pz = flottants[f + 2];
      positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
      covariance(
        [flottants[f + 3], flottants[f + 4], flottants[f + 5]],
        [(octets[o + 28] - 128) / 128, (octets[o + 29] - 128) / 128,
          (octets[o + 30] - 128) / 128, (octets[o + 31] - 128) / 128],
        cov,
      );
      const t = i * TEXELS_PAR_SPLAT * 4;
      donnees[t] = px; donnees[t + 1] = py; donnees[t + 2] = pz;
      donnees[t + 3] = octets[o + 24] * 256 + octets[o + 25];
      donnees[t + 4] = cov[0]; donnees[t + 5] = cov[1]; donnees[t + 6] = cov[2]; donnees[t + 7] = cov[3];
      donnees[t + 8] = cov[4]; donnees[t + 9] = cov[5];
      donnees[t + 10] = octets[o + 26] * 256 + octets[o + 27];
      boite.expandByPoint(_v.set(px, py, pz));
    }

    const texture = new THREE.DataTexture(
      donnees, SPLATS_PAR_LIGNE * TEXELS_PAR_SPLAT, lignes, THREE.RGBAFormat, THREE.FloatType,
    );
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const geometrie = new THREE.InstancedBufferGeometry();
    geometrie.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-2, -2, 0, 2, -2, 0, -2, 2, 0, 2, 2, 0]), 3));
    geometrie.setIndex([0, 1, 2, 2, 1, 3]);
    const ordre = new Float32Array(n);
    for (let i = 0; i < n; i += 1) ordre[i] = i;
    const attributOrdre = new THREE.InstancedBufferAttribute(ordre, 1);
    attributOrdre.setUsage(THREE.DynamicDrawUsage);
    geometrie.setAttribute('indice', attributOrdre);
    geometrie.instanceCount = n;

    const materiau = new THREE.ShaderMaterial({
      uniforms: {
        uDonnees: { value: texture },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uFocale: { value: new THREE.Vector2(1, 1) },
        uOpacite: { value: 1 },
      },
      vertexShader: SOMMETS,
      fragmentShader: FRAGMENTS,
      transparent: true,
      // Les deux axes de l'ellipse forment une base d'orientation quelconque :
      // selon la gaussienne, le quad sort de l'écran retourné, et three le
      // prendrait pour une face arrière.
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });

    super(geometrie, materiau);
    this.frustumCulled = false;
    this.userData.splat = true;
    this.nombre = n;
    this.boite = boite;
    this._positions = positions;
    this._ordre = ordre;
    this._attributOrdre = attributOrdre;
    this._derniereDirection = new THREE.Vector3(NaN, 0, 0);
    this._tampons = { cles: new Uint32Array(n), compte: new Uint32Array(65536), sortie: new Float32Array(n) };
  }

  // Ni lancer de rayon, ni mesure : une gaussienne n'est pas une surface.
  raycast() {}

  definirOpacite(valeur) {
    this.material.uniforms.uOpacite.value = THREE.MathUtils.clamp(Number(valeur), 0, 1);
  }

  // Appelé par three juste avant de dessiner la couche, avec la caméra de la
  // passe en cours : c'est là que le viewport, la focale et le tri se règlent.
  onBeforeRender(renderer, scene, camera) {
    const uniforms = this.material.uniforms;
    const taille = renderer.getDrawingBufferSize(_taille);
    uniforms.uViewport.value.copy(taille);
    // Focale en pixels : la hauteur de l'écran sous le champ vertical.
    const f = taille.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    uniforms.uFocale.value.set(f, f);
    this._trier(camera);
  }

  _trier(camera) {
    camera.getWorldDirection(_direction);
    camera.getWorldPosition(_position);
    if (this._derniereDirection.distanceToSquared(_direction) < 1e-6
      && this._dernierePosition?.distanceToSquared(_position) < 1e-10) return;
    this._derniereDirection.copy(_direction);
    this._dernierePosition = (this._dernierePosition ?? new THREE.Vector3()).copy(_position);

    const { cles, compte, sortie } = this._tampons;
    const p = this._positions;
    const n = this.nombre;
    const dx = _direction.x; const dy = _direction.y; const dz = _direction.z;

    // Tri par comptage sur la profondeur quantifiée en 16 bits : linéaire, et
    // assez fin pour des objets que la caméra enveloppe de près.
    let mini = Infinity; let maxi = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = p[i * 3] * dx + p[i * 3 + 1] * dy + p[i * 3 + 2] * dz;
      cles[i] = 0;
      sortie[i] = d;
      if (d < mini) mini = d;
      if (d > maxi) maxi = d;
    }
    const echelle = 65535 / (maxi - mini || 1);
    compte.fill(0);
    for (let i = 0; i < n; i += 1) {
      const c = ((sortie[i] - mini) * echelle) | 0;
      cles[i] = c;
      compte[c] += 1;
    }
    // Du plus lointain au plus proche : les clés grandes d'abord.
    let cumul = 0;
    for (let c = 65535; c >= 0; c -= 1) {
      const k = compte[c];
      compte[c] = cumul;
      cumul += k;
    }
    for (let i = 0; i < n; i += 1) {
      this._ordre[compte[cles[i]]++] = i;
    }
    this._attributOrdre.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();
const _taille = new THREE.Vector2();
const _direction = new THREE.Vector3();
const _position = new THREE.Vector3();

export async function chargerSplat(url, surProgression) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error(`Gaussiennes illisibles (${reponse.status}) : ${url}`);
  const total = Number(reponse.headers.get('content-length')) || 0;
  let tampon;
  if (reponse.body && total) {
    const lecteur = reponse.body.getReader();
    const morceaux = [];
    let recu = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      recu += value.length;
      surProgression?.(recu / total);
    }
    const tout = new Uint8Array(recu);
    let o = 0;
    for (const m of morceaux) { tout.set(m, o); o += m.length; }
    tampon = tout.buffer;
  } else {
    tampon = await reponse.arrayBuffer();
  }
  const couche = new CoucheSplat(tampon);
  // La couche est posée telle quelle ; son objet racine est elle-même.
  return { racine: couche, boite: couche.boite };
}
