// Matrices 4×4, colonne-majeur — la convention de glTF et de three.js, et
// celle dans laquelle dür.air écrit alignmentInfo.transformMatrix (translation
// aux indices 12, 13, 14 ; dernier terme à 1).

export const IDENTITE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function appliquer(M, [x, y, z]) {
  return [
    M[0] * x + M[4] * y + M[8] * z + M[12],
    M[1] * x + M[5] * y + M[9] * z + M[13],
    M[2] * x + M[6] * y + M[10] * z + M[14],
  ];
}

export function multiplier(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let l = 0; l < 4; l += 1) {
      o[c * 4 + l] = a[l] * b[c * 4] + a[4 + l] * b[c * 4 + 1]
        + a[8 + l] * b[c * 4 + 2] + a[12 + l] * b[c * 4 + 3];
    }
  }
  return o;
}

export function inverse(a) {
  const inv = new Array(16);
  inv[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (Math.abs(det) < 1e-20) throw new Error('Matrice non inversible.');
  det = 1 / det;
  return inv.map((x) => x * det);
}

// Facteur d'échelle d'une similitude : la norme de sa première colonne.
export const echelleDe = (M) => Math.hypot(M[0], M[1], M[2]);

// Compose une similitude à partir d'un quaternion, d'une échelle et d'une
// translation. Le quaternion vient de Horn (voir icp.mjs) et est unitaire.
export function depuisQuaternion([w, x, y, z], c, t) {
  const M = [
    c * (1 - 2 * (y * y + z * z)), c * (2 * (x * y + w * z)), c * (2 * (x * z - w * y)), 0,
    c * (2 * (x * y - w * z)), c * (1 - 2 * (x * x + z * z)), c * (2 * (y * z + w * x)), 0,
    c * (2 * (x * z + w * y)), c * (2 * (y * z - w * x)), c * (1 - 2 * (x * x + y * y)), 0,
    t[0], t[1], t[2], 1,
  ];
  return M;
}
