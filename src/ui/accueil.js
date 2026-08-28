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

  // L'EN-TÊTE PORTE LE NOM DU SITE, PUIS CE QU'IL FAIT, PUIS POUR QUI.
  //
  // Trois lignes, dans cet ordre, parce qu'un visiteur qui arrive ici ne sait
  // encore rien : le nom, la phrase qui le situe, et un paragraphe court écrit
  // dans les mots du métier — constat d'état, transport, prêt, intervention.
  // Personne n'a besoin qu'on lui dise qu'il est conservateur ou régisseur : le
  // vocabulaire suffit à dire à qui la page s'adresse.
  //
  // Ce qui n'est PAS ici : le nom de l'auteur. Il descend au pied de page, avec
  // le crédit d'acquisition — voir plus bas.
  const entete = document.createElement('header');
  entete.className = 'accueil-entete';

  const titre = document.createElement('h1');
  titre.className = 'accueil-titre';
  titre.textContent = 'Galatée';

  const signature = document.createElement('p');
  signature.className = 'accueil-signature';
  signature.textContent = 'Visualisation et annotation 3D pour les collections de musée et le patrimoine';

  const propos = document.createElement('p');
  propos.className = 'accueil-propos';
  propos.textContent = 'Un constat d’état posé sur l’objet lui-même plutôt que sur une '
    + 'photographie : le relevé se regarde sous tous les angles, se mesure — avec son '
    + 'incertitude à côté du chiffre — et s’annote à l’endroit exact qui le demande. '
    + 'Les relevés d’un même objet se superposent d’une date à l’autre : avant un '
    + 'transport, après une intervention, au retour d’un prêt. Rien à installer, un lien suffit.';

  entete.append(titre, signature, propos);

  // Le bandeau qui sépare l'identité du site de son contenu : l'étiquette d'un
  // côté, le compte de l'autre, sur un filet.
  const bandeau = document.createElement('div');
  bandeau.className = 'accueil-bandeau';
  const invite = document.createElement('h2');
  invite.className = 'panel-kicker accueil-invite';
  invite.textContent = 'Choisir un objet';
  const compte = document.createElement('span');
  compte.className = 'accueil-compte';
  // Le compte ne nomme plus le procédé : tous les objets ne sont pas relevés
  // de la même façon, et le muséum en porte deux à lui seul.
  compte.textContent = catalogue.length > 1
    ? `${catalogue.length} objets relevés`
    : 'Un objet relevé';
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

  // LE PIED DE PAGE : QUI A FAIT QUOI.
  //
  // Deux lignes, et l'ordre n'est pas indifférent. Les relevés viennent de
  // dür.air, l'application de photogrammétrie du laboratoire MAP (CNRS) : sans
  // lui il n'y aurait rien à montrer, et le dire est simplement exact. La
  // seconde ligne dit ce que l'auteur de ce site a fait — le site — et rien de
  // plus. Elles sont en bas parce que c'est là qu'on cherche un crédit, et
  // parce qu'une page qui présente des objets ne commence pas par présenter
  // celui qui l'a écrite.
  const pied = document.createElement('footer');
  pied.className = 'accueil-pied';

  const acquisition = document.createElement('p');
  const durair = document.createElement('a');
  durair.href = 'https://durair.map.cnrs.fr/';
  durair.target = '_blank';
  durair.rel = 'noopener noreferrer';
  durair.textContent = 'dür.air';
  acquisition.append('Acquisitions photogrammétriques et LiDAR réalisées avec ', durair,
    ', développé par le laboratoire MAP (CNRS).');

  const application = document.createElement('p');
  const auteur = document.createElement('a');
  auteur.href = 'https://victor-mule.netlify.app/';
  // Le portfolio est un autre site : l'ouvrir à côté plutôt qu'à la place de
  // celui-ci, pour ne pas faire perdre le catalogue qu'on était en train de
  // parcourir. « noopener » coupe l'accès de la page ouverte à celle-ci.
  auteur.target = '_blank';
  auteur.rel = 'noopener noreferrer';
  auteur.textContent = 'Victor Mulé';
  application.append('Galatée est conçu et développé par ', auteur, '.');

  pied.append(acquisition, application);

  hote.append(entete, bandeau, grille, pied);
  hote.hidden = false;
  document.body.classList.add('sur-accueil');
}
