// La page d'accueil : le catalogue, en vignettes.
//
// Le site sert plusieurs objets, et arriver directement dans l'un d'eux
// obligeait à comprendre qu'il y en avait d'autres avant de pouvoir les
// atteindre. On entre désormais par le catalogue : on voit ce qu'il y a, on
// choisit, on entre. Revenir en arrière ramène ici.
//
// Aucune scène 3D n'est chargée tant qu'un objet n'a pas été choisi : l'accueil
// est du texte et cinq JPEG. C'est amorce.js qui en décide — il n'importe
// app.js, et à travers lui three.js, qu'une fois l'objet connu.
//
// LE CHOIX SE FAIT PAR L'URL, pas par un état interne. Chaque vignette est un
// vrai lien vers ?objet=<id> : la page se recharge, ce qui garantit qu'aucun
// atlas, aucune analyse de maillage et aucun brouillon de l'objet précédent ne
// traîne — et donne gratuitement le bouton « précédent » du navigateur, qui
// est le geste que tout le monde connaît déjà pour revenir en arrière.

export function afficherAccueil(hote, catalogue) {
  hote.replaceChildren();

  // L'EN-TÊTE PORTE LE NOM DU SITE, PAS LA CONSIGNE.
  //
  // « Choisir un objet » en titre décrivait ce qu'on fait sur la page, ce que
  // la grille dit déjà toute seule. Le titre nomme maintenant le site, et la
  // consigne descend en étiquette au-dessus des cartes, là où elle sert.
  const entete = document.createElement('header');
  entete.className = 'accueil-entete';

  const titre = document.createElement('h1');
  titre.className = 'accueil-titre';
  titre.textContent = 'Art’Scanner';

  const signature = document.createElement('p');
  signature.className = 'accueil-signature';
  signature.append('Numérisation 3D pour le patrimoine');

  const point = document.createElement('span');
  point.className = 'accueil-point';
  // Décoratif : un lecteur d'écran n'a pas à annoncer une puce de séparation.
  point.setAttribute('aria-hidden', 'true');
  point.textContent = '·';

  const auteur = document.createElement('a');
  auteur.className = 'accueil-auteur';
  auteur.href = 'https://victor-mule.netlify.app/';
  // Le portfolio est un autre site : l'ouvrir à côté plutôt qu'à la place de
  // celui-ci, pour ne pas faire perdre le catalogue qu'on était en train de
  // parcourir. « noopener » coupe l'accès de la page ouverte à celle-ci.
  auteur.target = '_blank';
  auteur.rel = 'noopener noreferrer';
  auteur.textContent = 'Victor Mulé';

  signature.append(' ', point, ' By ', auteur);
  entete.append(titre, signature);

  // Le bandeau qui sépare l'identité du site de son contenu : l'étiquette d'un
  // côté, le compte de l'autre, sur un filet.
  const bandeau = document.createElement('div');
  bandeau.className = 'accueil-bandeau';
  const invite = document.createElement('h2');
  invite.className = 'panel-kicker accueil-invite';
  invite.textContent = 'Choisir un objet';
  const compte = document.createElement('span');
  compte.className = 'accueil-compte';
  compte.textContent = catalogue.length > 1
    ? `${catalogue.length} objets relevés en photogrammétrie`
    : 'Un objet relevé en photogrammétrie';
  bandeau.append(invite, compte);

  const grille = document.createElement('div');
  grille.className = 'accueil-grille';

  for (const entree of catalogue) {
    const carte = document.createElement('a');
    carte.className = 'accueil-carte';
    carte.href = `?objet=${encodeURIComponent(entree.id)}`;

    const cadre = document.createElement('div');
    cadre.className = 'accueil-vignette';
    const image = document.createElement('img');
    image.src = `./objets/${entree.id}/vignette.jpg`;
    // Le nom suffit à identifier la carte : décrire l'image une seconde fois
    // ferait lire deux fois la même chose à un lecteur d'écran.
    image.alt = '';
    image.loading = 'lazy';
    // Une vignette manquante ne doit pas laisser l'icône d'image cassée du
    // navigateur : la carte reste utilisable, avec son nom et sa description.
    image.addEventListener('error', () => { cadre.hidden = true; });
    cadre.appendChild(image);

    const nom = document.createElement('span');
    nom.className = 'accueil-nom';
    nom.textContent = entree.nom ?? entree.id;

    carte.append(cadre, nom);
    if (entree.detail) {
      const detail = document.createElement('span');
      detail.className = 'accueil-detail';
      detail.textContent = entree.detail;
      carte.appendChild(detail);
    }
    grille.appendChild(carte);
  }

  hote.append(entete, bandeau, grille);
  hote.hidden = false;
  document.body.classList.add('sur-accueil');
}
