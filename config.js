// Réglages du visualiseur — modifiez les valeurs puis rechargez la page.
// (Ce fichier est volontairement simple : aucune compilation n'est nécessaire.)

window.VIEWER_CONFIG = {

  // ---------------------------------------------------------------- LUMIÈRE
  light: {
    // Intensité générale de la lumière. 1 = valeur d'origine.
    // Plage utile : 0.4 (sombre) à 2 (très lumineux).
    intensity: 1,

    // Bornes du curseur « Luminosité » dans le panneau de réglages.
    intensityMin: 0.4,
    intensityMax: 2,

    // "fixe"    : éclairage d'origine, identique quel que soit le point de vue.
    // "dirigee" : une source que vous orientez vous-même et qui reste où vous
    //             la posez, par-dessus l'éclairage d'origine atténué.
    mode: 'fixe',

    // Réglages utilisés uniquement en mode "dirigee".
    //
    // POURQUOI UNE SOURCE ET NON UN ENVIRONNEMENT — un environnement filtré est
    // diffus par construction : c'est la moyenne de tout ce qui entoure le
    // spécimen. La lumière rasante est exactement l'inverse, une source presque
    // parallèle à la surface dont tout l'intérêt est de n'être PAS moyennée.
    // C'est elle qui fait ressortir les écailles et les rayons des nageoires,
    // en s'appuyant sur la carte de normales que portent les captures.
    dirigee: {
      // Ce qui reste de l'éclairage d'origine, en fond (0 = noir, 1 = normal).
      // C'est le réglage du CONTRASTE : plus il est bas, plus le relief
      // ressort, mais plus les ombres se ferment. Autour de 0.3 pour une image
      // rasante lisible, 0.6 et plus pour un rendu documentaire neutre.
      ambiance: 0.32,

      // Force de la source orientable, de 0 à 30. Elle se lit avec le curseur
      // « Reflet » : une surface peu rugueuse renvoie un éclat net et petit,
      // une surface mate étale la lumière.
      //
      // La plage monte haut volontairement. Plus la lumière est rasante, moins
      // elle atteint les surfaces tournées vers la caméra — c'est justement ce
      // qui fait ressortir le relief, mais l'image s'assombrit d'autant. Il
      // faut alors monter la force, exactement comme on ouvre le diaphragme.
      // Autour de 4 pour un éclairage oblique, 15 à 30 pour un vrai rasant.
      intensite: 4,

      // Position de départ du point sur le disque, de -1 à 1 chacun. Le centre
      // éclaire de face (aucun relief), le bord éclaire à 90° (rasant).
      x: -0.55,
      y: 0.5,

      // Angle atteint au bord du disque, en degrés depuis l'axe de la caméra.
      // 90 = exactement rasant. Au-delà la lumière passe derrière le spécimen
      // et souligne les membranes translucides des nageoires ; l'anneau tracé
      // sur le disque marque toujours le rasant.
      angleMax: 110,
    },
  },

  // --------------------------------------------------------------- MATIÈRE
  // Appliqué à la volée au modèle : inutile de régénérer les fichiers .glb.
  matiere: {
    // Rugosité de la surface : 0 = miroir, 1 = totalement mat.
    // ~0.7 donne un reflet discret d'écailles ; baissez pour plus de brillance.
    rugosite: 0.7,

    // Aspect métallique : 0 pour un spécimen naturel. À laisser à 0
    // sauf effet volontairement métallique.
    metal: 0.8,

    // Opacité globale du modèle. Elle multiplie l'opacité propre des matériaux
    // (les membranes des nageoires restent donc corrigées à 45 % de cette valeur)
    // sans modifier l'opacité des calques de peinture ou de région.
    opacite: 1,
  },

  // ---------------------------------------------------------------- OMBRE
  ombre: {
    // Intensité de l'ombre portée au sol (0 = aucune, 1 = très marquée).
    intensite: 0.7,
    // Netteté du contour de l'ombre (0 = nette, 1 = très floue).
    douceur: 0.8,
    // Taille du plan qui reçoit l'ombre, en multiple de la largeur du modèle.
    // Augmentez si l'ombre semble coupée sur les bords.
    taillePlan: 1.8,
    // Hauteur au-dessus du socle jusqu'à laquelle le modèle projette de
    // l'ombre, en multiple de sa hauteur. Plus c'est bas, plus l'ombre est
    // concentrée sous le spécimen.
    hauteur: 0.7,
  },

  // ---------------------------------------------------------------- CAMÉRA
  camera: {
    // Champ de vision vertical, en degrés. Plus la valeur est basse, plus la
    // perspective est écrasée (effet téléobjectif). 30 = cadrage identique à
    // l'ancien visualiseur.
    champVision: 30,
    // Air autour du modèle au chargement. 1 = le modèle touche exactement les
    // bords de la fenêtre ; 1.22 reproduit le cadrage de l'ancien visualiseur.
    marge: 1.22,

    // Distances minimale et maximale entre la caméra et le modèle, en mètres.
    distanceMin: 0.4,
    distanceMax: 14,
    // Inertie des mouvements de caméra (0 = arrêt net, 0.2 = très glissant).
    amortissement: 0.08,
  },

  // -------------------------------------------------------------- COULEURS
  // Palette proposée pour les calques : annotations, peinture, régions.
  // Ajoutez ou retirez des couleurs librement ; la pastille arc-en-ciel
  // permet de toujours en choisir une hors palette.
  couleurs: [
    '#c9553d', '#d99a35', '#c8b23f', '#4f9066', '#3d7ab8',
    '#8360b8', '#b8508a', '#7a6a5d', '#2b2b28', '#f2f1ec',
  ],

  // -------------------------------------------------------------- PEINTURE
  peinture: {
    // Résolution de l'atlas de peinture, en pixels de côté. 2048 convient à
    // des régions et des contours ; montez à 4096 pour des traits très fins
    // (coût : 4 fois plus de mémoire vidéo), descendez à 1024 sur machine
    // modeste.
    resolutionAtlas: 2048,

    // Diamètre du pinceau au chargement, en MILLIMÈTRES SUR LA SURFACE du
    // spécimen — pas en pixels d'écran. Un trait garde donc sa taille réelle
    // quel que soit le zoom.
    taille: 20,
    tailleMin: 1,
    tailleMax: 80,

    // Diamètre de la gomme au chargement, mêmes unités.
    tailleGomme: 24,

    // Netteté du bord du trait : 0 = très flou, 1 = net.
    durete: 0.55,

    // Empêche le pinceau de traverser une paroi fine (une nageoire) et de
    // peindre l'autre côté. C'est le produit scalaire minimal entre la normale
    // de la surface et celle du trait : 0 = tout ce qui est de face,
    // 0.5 = seulement ce qui est bien orienté pareil, -1 = aucune protection.
    seuilNormale: 0.0,

    // Espacement des empreintes le long du trait, en fraction du rayon.
    espacement: 0.25,

    // Nombre de passes de dilatation qui comblent les coutures de l'atlas UV.
    // 0 laisse apparaître de fines fissures claires le long des îlots.
    dilatations: 2,
  },

  // ---------------------------------------------------------------- MESURE
  mesure: {
    // Échelle automatique : une longueur affichée comme 59 cm dans les unités
    // du modèle correspond à 19 cm sur le spécimen réel. Longueurs, aires et
    // volumes sont convertis respectivement avec ce rapport, son carré et son cube.
    longueurModeleReference: 0.59,
    longueurReelleReference: 0.19,

    // Mode de mesure au chargement.
    //   'droite'  : distance à vol d'oiseau entre deux points, comme un pied
    //               à coulisse. C'est la mesure la plus reproductible.
    //   'surface' : plus court chemin EN RESTANT SUR LE MAILLAGE, comme un
    //               mètre ruban posé sur le spécimen. Sur un corps courbe les
    //               deux diffèrent beaucoup : le mode fait partie de la mesure
    //               et est enregistré avec elle.
    mode: 'droite',

    // Épaisseur du trait de mesure, en pixels.
    epaisseur: 2,

    // AIRE ET PÉRIMÈTRE D'UN CALQUE DE PEINTURE — résolution de la grille de
    // calcul, en pixels de côté. La peinture n'est pas un ensemble de
    // triangles : son aire est l'intégrale de sa couverture sur la surface, et
    // c'est sur cette grille qu'elle est intégrée.
    //
    // Mesuré sur ce spécimen, contre le calcul exact sur le maillage :
    //
    //          256      512      1024     2048
    //   aire   +0,8 %   +0,1 %   −0,1 %   −0,0 %
    //   périm. −31 %    −21 %    −13 %    −5 %
    //
    // L'aire est donc juste dès 512. Le périmètre, lui, est sous-estimé : voir
    // eviterCoutures ci-dessous. 1024 est le compromis retenu ; 2048 divise
    // encore l'écart par deux, au prix de 64 Mo de mémoire vidéo et d'un calcul
    // quatre fois plus long à chaque sélection de calque.
    resolution: 1024,

    // Ignore le contour qui longe une couture de l'atlas UV. Quand une zone
    // peinte passe d'un îlot UV à un autre, l'atlas montre un bord des deux
    // côtés alors qu'il n'y en a aucun sur le spécimen : la peinture continue,
    // simplement. Sans cette correction le périmètre AUGMENTE indéfiniment
    // avec la résolution (+11 %, +25 %, +34 %, +47 %) au lieu de converger.
    // Le prix à payer est une marge d'un pixel autour de chaque îlot, dans
    // laquelle du vrai bord est perdu aussi — d'où la sous-estimation.
    // À ne passer à false que pour comparer.
    eviterCoutures: true,

    // INCERTITUDE DE REPLI sur une aire de peinture, en relatif (0,001 = 0,1 %).
    // Un nombre sans incertitude n'est pas une mesure : toutes les aires sont
    // affichées sous la forme « 12,43 ± 0,01 cm² ».
    //
    // Sur une RÉGION la valeur n'est pas prise ici : elle est mesurée en direct.
    // Une région est le seul calque que les deux méthodes savent mesurer — somme
    // exacte sur les triangles d'un côté, intégration de la couverture dans
    // l'atlas de l'autre — et l'écart entre les deux EST l'incertitude, sans
    // avoir rien à supposer. Cette valeur mesurée est ensuite réutilisée pour
    // les calques de peinture du même document, qui n'ont pas de contrepartie
    // exacte.
    //
    // Le chiffre ci-dessous ne sert donc que tant qu'aucune région n'a encore
    // été mesurée. Il vient du tableau de calibration plus haut, à 1024.
    incertitudeAire: 0.001,

    // RECALAGE DES CAPTURES — fichier produit à l'alignement, qui contient le
    // résidu (RMSE) de chaque session sur la session de référence. C'est
    // l'incertitude de position d'une annotation vue sur une autre capture que
    // celle où elle a été posée ; elle est affichée telle quelle plutôt que
    // passée sous silence.
    recalage: './sessions/_alignment_transforms.json',
  },

  // ------------------------------------------------------------- SÉLECTION
  selection: {
    // BAGUETTE MAGIQUE — la propagation s'arrête quand l'angle entre deux
    // faces voisines dépasse cette valeur, en degrés. Baissez pour que la
    // sélection s'arrête plus tôt sur les arêtes douces, montez pour franchir
    // les plis.
    angleMax: 32,

    // Tolérance de couleur de la baguette, de 0 à 255. La propagation
    // s'arrête quand la texture s'écarte trop de la couleur de départ.
    // 255 = la couleur est ignorée, seule la géométrie compte.
    tolerance: 42,

    // Garde-fou : nombre maximal de faces qu'une seule baguette peut prendre.
    maxFaces: 40000,

    // LASSO — false : seules les faces tournées vers vous sont prises.
    // true : le lasso traverse et prend aussi l'autre côté du spécimen.
    lassoTraversant: false,

    // TRANSFERT ENTRE SESSIONS — une région est définie sur un maillage ; sur
    // une autre capture, les faces sont retrouvées par proximité. La distance
    // acceptée est ce facteur MULTIPLIÉ PAR LA TAILLE MOYENNE D'UNE FACE du
    // maillage, et non une distance fixe.
    //
    // C'est important : sur ce spécimen une arête mesure environ 2 cm, donc un
    // seuil choisi d'après le résidu de recalage serait plus petit
    // qu'un seul triangle et ne retrouverait presque rien. (Ce résidu vaut
    // 0,0055 dans les unités du modèle, soit environ 1,8 mm réels une fois
    // l'échelle appliquée — et non 5 mm : c'est la valeur brute qui était lue
    // comme si une unité du modèle valait un mètre.) Le facteur s'adapte
    // tout seul si vous ajoutez une capture plus fine.
    // 0.6 = un peu plus d'une demi-face. Montez si la région se troue sur les
    // autres sessions, baissez si elle déborde.
    facteurTransfert: 0.6,

    // CONTOUR — épaisseur du trait en pixels, et hauteur à laquelle il flotte
    // au-dessus de la surface (en mètres) pour ne pas se battre avec elle.
    epaisseurContour: 3,
    decalageContour: 0.0004,

    // Surbrillance de la sélection en cours.
    couleurApercu: '#2f6fd0',
    opaciteApercu: 0.45,
  },

  // ----------------------------------------------------------------- RENDU
  rendu: {
    // Courbe de conversion des couleurs calculées vers l'écran.
    //   'neutre'   : Khronos PBR Neutral — préserve les teintes, peu de
    //                saturation dans les hautes lumières. C'est le réglage
    //                le plus proche de l'ancien visualiseur.
    //   'aces'     : plus contrasté, hautes lumières plus douces (cinéma).
    //   'agx'      : très doux dans les hautes lumières, un peu désaturé.
    //   'aucun'    : aucune conversion, les zones vives sont écrêtées.
    // Si le rendu vous paraît différent d'avant, c'est le premier réglage
    // à essayer.
    tonemapping: 'neutre',

    // Plafond de la densité de pixels. 2 = net sur écran Retina ; descendez
    // à 1 si l'affichage rame sur une machine modeste.
    densitePixelsMax: 2,

    // Lissage des bords (antialiasing). Coûteux sur mobile.
    lissage: true,
  },

  // ------------------------------------------------------------------ FOND
  fond: {
    // Couleur de fond au chargement.
    couleur: '#ecebe7',
    // Couleurs proposées dans le panneau de réglages.
    palette: ['#ecebe7', '#ffffff', '#3a352c', '#151515', '#0c1b2e'],
  },

  // --------------------------------------------------------------- AFFICHAGE
  affichage: {
    // Panneau de réglages (à gauche) ouvert au chargement.
    // Note : une fois que vous repliez ou dépliez un panneau, votre choix est
    // mémorisé par le navigateur et prend le pas sur ce réglage.
    panneauOuvert: true,

    // Panneau de calques (à droite) ouvert au chargement.
    panneauCalquesOuvert: true,
    // VUE D'OUVERTURE — celle du chargement, et celle où « Recentrer » revient.
    //
    // Des angles plutôt qu'une position de caméra enregistrée : la distance de
    // cadrage se recalcule sur la boîte englobante, si bien que le spécimen
    // occupe la même part de l'image quelle que soit sa taille et quelle que
    // soit la fenêtre.
    //
    //   azimut    : rotation autour de la verticale, en degrés. 0 regarde
    //               depuis +Z, 90 depuis +X.
    //   elevation : hauteur au-dessus de l'horizon, en degrés. 0 est de niveau,
    //               90 à la verticale au-dessus.
    //   marge     : multiplie la distance. 1 laisse le cadrage automatique,
    //               au-dessus on recule, en dessous on serre.
    //
    // Pour en choisir une autre : placez le spécimen à la main dans la vue,
    // puis tapez DURAIR.vueActuelle() dans la console — les trois nombres à
    // recopier ici en sortent.
    vueInitiale: { azimut: 87, elevation: 30, marge: 0.85 },

    // Vitesse de la rotation automatique, en degrés par seconde.
    vitesseRotation: 18,

    // APLOMB — la verticale du spécimen, quand elle diffère de celle du monde.
    //
    // null depuis que la géométrie a été redressée dans les fichiers eux-mêmes :
    // les captures arrivaient avec un socle penché de 4,0°, elles sont
    // maintenant écrites de niveau. Le contrôle après coup donne 0,17°, 0,42° et
    // 0,17° sur les trois captures.
    //
    // Renseignez une normale ici si vous chargez un jour des captures brutes :
    // faites-en tourner la caméra plutôt que la géométrie tant que des
    // annotations existent, car elles sont écrites dans le repère des fichiers.
    aplomb: null,

    // AXE DE LA ROTATION AUTOMATIQUE — un point qu'il traverse et sa direction.
    //
    // Sans lui, la rotation tourne autour de la verticale passant par le centre
    // de la boîte englobante — ce qui, avant le rognage, tombait au milieu de
    // la nappe : le poisson décrivait un grand cercle autour d'un axe qui ne le
    // traversait pas, un manège plutôt qu'un tour de socle.
    //
    // Le redressement a posé l'origine au pied de la tige et le socle à plat,
    // si bien que l'axe cherché est devenu l'axe Y lui-même. On l'écrit quand
    // même explicitement : la boîte englobante reste bien plus large que le
    // socle — les nageoires débordent de part et d'autre — donc son centre ne
    // retomberait pas sur la tige.
    axeRotation: {
      point: [0, 0, 0],
      direction: [0, 1, 0],
    },

    // Mode « Toutes les sessions ».
    // 'auto' (recommandé) : chaque capture pèse exactement 1/3 du résultat,
    // ce qui donne une vraie moyenne des trois sans délaver les couleurs.
    // Vous pouvez forcer une valeur (ex. 0.5) pour appliquer la même opacité
    // à toutes les couches : l'effet est plus fantomatique, le fond ressort.
    opaciteComposite: 'auto',
  },
};
