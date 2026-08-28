// Découper toutes les captures d'un objet sur une emprise commune.
//
// POURQUOI. Deux captures bien recalées ne montrent pas pour autant la même
// chose : l'opératrice a tracé une boîte différente sur le téléphone à chaque
// fois, et chaque modèle embarque une portion différente de sol autour de
// l'objet. Mesuré sur Cadre 1, les trois captures — dont les surfaces
// coïncident à 21 mm près, soit une arête de maillage — ont des boîtes
// englobantes dont les centres sont à un demi-mètre les uns des autres et dont
// les tailles varient de 40 %.
//
// Or le visualiseur cadre sur la boîte englobante. Changer de capture recadre
// donc la vue, et l'objet paraît sauter et changer de taille alors que rien
// n'a bougé — le défaut le plus visible de tous, et celui qui ne vient pas
// d'un défaut d'alignement.
//
// L'EMPRISE RETENUE est celle de la capture de référence. C'est la plus dense,
// c'est elle qui donne son repère et sur laquelle on peint : la prendre comme
// mesure garantit qu'aucune capture ne montre plus qu'elle, et qu'aucune n'est
// rognée sur ce qu'elle est seule à couvrir d'utile.
//
// ON DÉCOUPE PAR TRIANGLE, pas par sommet. Retirer un sommet laisserait des
// faces incomplètes ; on garde un triangle dès que son centre tombe dans la
// boîte, ce qui conserve une frange d'un demi-triangle au-delà du bord et
// évite d'ouvrir le maillage juste à la limite.

// LES SOMMETS ORPHELINS DOIVENT PARTIR AUSSI, et c'est contre-intuitif.
//
// Retirer des triangles de l'index laisse dans le tampon les sommets qu'ils
// étaient seuls à utiliser. Ils ne sont plus rendus : on pourrait croire
// l'affaire close. Mais `Box3.setFromObject` de three.js calcule la boîte
// englobante à partir de l'ATTRIBUT DE POSITION, pas des triangles — les
// orphelins comptent, la boîte ne bouge pas, et comme c'est elle qui règle le
// cadrage, la découpe ne change rien à l'écran. Mesuré : 10 % de triangles
// retirés, boîte identique au millimètre.
//
// Il faut donc réindexer pour de bon : ne garder que les sommets utilisés, et
// réécrire tous les attributs — positions, UV, normales — dans le même ordre.
export function decouper(doc, boiteCible, marge = 0.02) {
  const dilatation = boiteCible.taille.map((t) => t * marge);
  const mn = boiteCible.mn.map((v, i) => v - dilatation[i]);
  const mx = boiteCible.mx.map((v, i) => v + dilatation[i]);
  const dedans = (p) => p[0] >= mn[0] && p[0] <= mx[0]
    && p[1] >= mn[1] && p[1] <= mx[1]
    && p[2] >= mn[2] && p[2] <= mx[2];

  let avant = 0;
  let apres = 0;

  for (const maille of doc.getRoot().listMeshes()) {
    for (const prim of maille.listPrimitives()) {
      const positions = prim.getAttribute('POSITION');
      const indices = prim.getIndices();
      if (!positions || !indices) continue;

      const source = indices.getArray();
      const nTriangles = source.length / 3;
      avant += nTriangles;

      const gardes = [];
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const c = [0, 0, 0];
      for (let t = 0; t < nTriangles; t += 1) {
        const i0 = source[t * 3];
        const i1 = source[t * 3 + 1];
        const i2 = source[t * 3 + 2];
        positions.getElement(i0, a);
        positions.getElement(i1, b);
        positions.getElement(i2, c);
        const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        if (dedans(centre)) gardes.push(i0, i1, i2);
      }
      apres += gardes.length / 3;

      if (gardes.length === source.length) continue;
      if (gardes.length === 0) {
        // Une capture entièrement hors de l'emprise est une capture mal
        // recalée : mieux vaut la laisser entière et visible que rendre un
        // maillage vide, que personne ne saurait interpréter.
        apres += nTriangles;
        continue;
      }

      // Réindexation : les sommets conservés, dans l'ordre où ils apparaissent.
      const ancienVersNouveau = new Map();
      const ordre = [];
      for (const i of gardes) {
        if (!ancienVersNouveau.has(i)) {
          ancienVersNouveau.set(i, ordre.length);
          ordre.push(i);
        }
      }

      for (const semantique of prim.listSemantics()) {
        const attribut = prim.getAttribute(semantique);
        const taille = attribut.getElementSize();
        const ancien = attribut.getArray();
        const Tableau = ancien.constructor;
        const neuf = new Tableau(ordre.length * taille);
        for (let n = 0; n < ordre.length; n += 1) {
          const source0 = ordre[n] * taille;
          for (let k = 0; k < taille; k += 1) neuf[n * taille + k] = ancien[source0 + k];
        }
        attribut.setArray(neuf);
      }

      const TableauIndices = source.constructor;
      indices.setArray(TableauIndices.from(gardes.map((i) => ancienVersNouveau.get(i))));
    }
  }

  return { trianglesAvant: avant, trianglesApres: apres };
}
