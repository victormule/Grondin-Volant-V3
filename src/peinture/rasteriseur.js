// Painting happens in UV space, not on screen.
//
// The trick is the vertex shader: instead of projecting the mesh through the
// camera, it outputs each vertex *at its own UV coordinate*. Rendering the
// model then fills the texture atlas, and each fragment knows the 3D point it
// corresponds to. A brush dab is therefore a distance test in metres, done on
// the GPU — the stroke keeps its real size on the surface whatever the zoom,
// and wraps around curvature by construction.

import * as THREE from 'three';

// Dabs handled per pass. GLSL ES 1.0 needs a constant loop bound, so a long
// stroke is drawn in batches rather than in one call.
export const EMPREINTES_PAR_PASSE = 64;

const ENTETE = `#define NB ${EMPREINTES_PAR_PASSE}`;

export function creerMateriauEmpreintes() {
  return new THREE.ShaderMaterial({
    uniforms: {
      empreintes: { value: Array.from({ length: EMPREINTES_PAR_PASSE }, () => new THREE.Vector4()) },
      normales: { value: Array.from({ length: EMPREINTES_PAR_PASSE }, () => new THREE.Vector3()) },
      nombre: { value: 0 },
      // Bounding sphere of the batch, in world space: centre in xyz, radius in
      // w. Set by the atlas on every pass — see the rejection in main().
      sphereLot: { value: new THREE.Vector4(0, 0, 0, 0) },
      durete: { value: 0.5 },
      seuilNormale: { value: 0.0 },
      efface: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vMonde;
      varying vec3 vNormaleMonde;
      void main() {
        vMonde = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormaleMonde = normalize(mat3(modelMatrix) * normal);
        // UV as clip position: the atlas is the render target.
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${ENTETE}
      uniform vec4 empreintes[NB];
      uniform vec3 normales[NB];
      uniform int nombre;
      uniform vec4 sphereLot;
      uniform float durete;
      uniform float seuilNormale;
      uniform float efface;
      varying vec3 vMonde;
      varying vec3 vNormaleMonde;

      void main() {
        // One distance test instead of NB, and it is what makes painting
        // interactive rather than merely possible. A pass draws the WHOLE
        // model into the WHOLE atlas — four million fragments at 2048²,
        // whatever the batch holds — while a batch of dabs covers a thumbnail
        // of the specimen. Without this, replaying a layer of two thousand
        // dabs ran thirty-two passes × four million fragments × sixty-four
        // iterations. Nothing else in the pipeline came close.
        //
        // Padded by each dab's own radius, so the rejection is conservative:
        // no fragment the loop below would have touched is dropped here.
        if (distance(vMonde, sphereLot.xyz) > sphereLot.w) discard;

        float couverture = 0.0;
        vec3 n = normalize(vNormaleMonde);

        for (int i = 0; i < NB; i++) {
          if (i >= nombre) break;
          vec4 e = empreintes[i];

          // Without this the brush would bleed through a fin onto its far
          // side: two surfaces a millimetre apart are within any useful brush
          // radius, and only their normals tell them apart.
          if (dot(n, normales[i]) < seuilNormale) continue;

          float d = distance(vMonde, e.xyz);
          couverture = max(couverture, 1.0 - smoothstep(e.w * durete, e.w, d));
        }

        if (couverture <= 0.002) discard;
        // Erasing writes the complement and the pass runs with MIN instead of
        // MAX, so a rubbed-out area is subtracted from the mask rather than
        // added to it. The stroke is still stored, never deleted: an eraser
        // mark can be undone like anything else.
        gl_FragColor = vec4(1.0, 1.0, 1.0, mix(couverture, 1.0 - couverture, efface));
      }`,
    // Max rather than alpha blending: overlapping dabs of one stroke must not
    // stack into a darker patch where the hand moved slowly.
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    // UV islands can be wound either way once unwrapped.
    side: THREE.DoubleSide,
  });
}

// Composites one layer's coverage mask into the atlas, tinted and faded.
export function creerMateriauComposition() {
  return new THREE.ShaderMaterial({
    uniforms: {
      masque: { value: null },
      couleur: { value: new THREE.Color(1, 1, 1) },
      opacite: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vCoord;
      void main() {
        vCoord = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D masque;
      uniform vec3 couleur;
      uniform float opacite;
      varying vec2 vCoord;
      void main() {
        float a = texture2D(masque, vCoord).a * opacite;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(couleur, a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

// Copies a texture through unchanged.
export function creerMateriauCopie() {
  return new THREE.ShaderMaterial({
    uniforms: { source: { value: null } },
    vertexShader: /* glsl */`
      varying vec2 vCoord;
      void main() {
        vCoord = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D source;
      varying vec2 vCoord;
      void main() { gl_FragColor = texture2D(source, vCoord); }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

// Seam dilation.
//
// A UV atlas is a patchwork of islands. A triangle's edge falls *between*
// texels, so the outermost texel of an island is only partly covered and the
// one just outside it is empty — which shows up as a pale crack running along
// every seam. Bleeding the painted colour one texel outwards closes it.
export function creerMateriauDilatation() {
  return new THREE.ShaderMaterial({
    uniforms: {
      source: { value: null },
      pas: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    },
    vertexShader: /* glsl */`
      varying vec2 vCoord;
      void main() {
        vCoord = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D source;
      uniform vec2 pas;
      varying vec2 vCoord;

      void main() {
        // Already-painted texels are left exactly as they are: this pass draws
        // over the atlas, and re-emitting them would blend them with
        // themselves.
        if (texture2D(source, vCoord).a > 0.01) discard;

        vec4 somme = vec4(0.0);
        float poids = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec4 voisin = texture2D(source, vCoord + vec2(float(x), float(y)) * pas);
            if (voisin.a > 0.01) { somme += voisin; poids += 1.0; }
          }
        }

        if (poids < 0.5) discard;
        gl_FragColor = somme / poids;
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}
