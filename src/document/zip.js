// Minimal ZIP writer, store method only (no compression).
//
// Exporting a document with its media means producing an archive, and the one
// thing this project refuses to give up is the absence of a build step — so no
// bundler, and pulling a compression library off a CDN for this would be a lot
// of weight for nothing. Images, audio and video are already compressed:
// deflating them again would save a percent or two. Storing them raw costs
// eighty lines and no dependency.

const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let valeur = i;
    for (let bit = 0; bit < 8; bit++) {
      valeur = valeur & 1 ? 0xEDB88320 ^ (valeur >>> 1) : valeur >>> 1;
    }
    table[i] = valeur >>> 0;
  }
  return table;
})();

function crc32(octets) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < octets.length; i++) {
    crc = TABLE_CRC[(crc ^ octets[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// MS-DOS date and time, which is what the format still uses.
function horodatage(date) {
  const heure = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 31);
  const jour = (((date.getFullYear() - 1980) & 127) << 9)
    | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { heure, jour };
}

class Tampon {
  constructor() {
    this.morceaux = [];
    this.longueur = 0;
  }

  ajouter(octets) {
    this.morceaux.push(octets);
    this.longueur += octets.length;
  }

  entete(taille, remplir) {
    const vue = new DataView(new ArrayBuffer(taille));
    remplir(vue);
    this.ajouter(new Uint8Array(vue.buffer));
  }
}

// entrees: [{ nom, donnees: Uint8Array }]
export function construireZip(entrees, date = new Date()) {
  const { heure, jour } = horodatage(date);
  const encodeur = new TextEncoder();
  const corps = new Tampon();
  const repertoire = [];

  for (const entree of entrees) {
    const nom = encodeur.encode(entree.nom);
    const donnees = entree.donnees;
    const crc = crc32(donnees);
    const decalage = corps.longueur;

    corps.entete(30, (v) => {
      v.setUint32(0, 0x04034b50, true); // signature
      v.setUint16(4, 20, true); // version needed
      v.setUint16(6, 0, true); // flags
      v.setUint16(8, 0, true); // method: store
      v.setUint16(10, heure, true);
      v.setUint16(12, jour, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, donnees.length, true);
      v.setUint32(22, donnees.length, true);
      v.setUint16(26, nom.length, true);
      v.setUint16(28, 0, true); // extra
    });
    corps.ajouter(nom);
    corps.ajouter(donnees);

    repertoire.push({ nom, crc, taille: donnees.length, decalage });
  }

  const central = new Tampon();
  for (const entree of repertoire) {
    central.entete(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); // version made by
      v.setUint16(6, 20, true); // version needed
      v.setUint16(8, 0, true);
      v.setUint16(10, 0, true); // store
      v.setUint16(12, heure, true);
      v.setUint16(14, jour, true);
      v.setUint32(16, entree.crc, true);
      v.setUint32(20, entree.taille, true);
      v.setUint32(24, entree.taille, true);
      v.setUint16(28, entree.nom.length, true);
      v.setUint16(30, 0, true); // extra
      v.setUint16(32, 0, true); // comment
      v.setUint16(34, 0, true); // disk
      v.setUint16(36, 0, true); // internal attrs
      v.setUint32(38, 0, true); // external attrs
      v.setUint32(42, entree.decalage, true);
    });
    central.ajouter(entree.nom);
  }

  const fin = new Tampon();
  fin.entete(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(4, 0, true);
    v.setUint16(6, 0, true);
    v.setUint16(8, repertoire.length, true);
    v.setUint16(10, repertoire.length, true);
    v.setUint32(12, central.longueur, true);
    v.setUint32(16, corps.longueur, true);
    v.setUint16(20, 0, true); // comment
  });

  return new Blob([...corps.morceaux, ...central.morceaux, ...fin.morceaux],
    { type: 'application/zip' });
}
