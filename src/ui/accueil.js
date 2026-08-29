// Page d'accueil de Pygmalion. Elle reste volontairement autonome et légère :
// aucun code 3D n'est chargé avant que le visiteur choisisse un objet.

function lienExterne(href, classe) {
  const lien = document.createElement('a');
  lien.href = href;
  lien.className = classe;
  lien.target = '_blank';
  lien.rel = 'noopener noreferrer';
  return lien;
}

function creerIdentite() {
  const identite = lienExterne(
    'https://victor-mule.netlify.app/',
    'accueil-identite',
  );
  identite.setAttribute('aria-label', 'Victor Mulé — Solution numérique pour le patrimoine');

  const monogramme = document.createElement('span');
  monogramme.className = 'accueil-monogramme';
  monogramme.setAttribute('aria-hidden', 'true');
  monogramme.textContent = 'VM';

  const texte = document.createElement('span');
  texte.className = 'accueil-identite-texte';
  const nom = document.createElement('span');
  nom.className = 'accueil-identite-nom';
  nom.textContent = 'Victor Mulé';
  const metier = document.createElement('span');
  metier.className = 'accueil-identite-metier';
  metier.textContent = 'Solution numérique pour le patrimoine';
  texte.append(nom, metier);

  identite.append(monogramme, texte);
  return identite;
}

function creerAcquisition() {
  const acquisition = lienExterne(
    'https://durair.map.cnrs.fr/',
    'accueil-acquisition',
  );
  acquisition.setAttribute(
    'aria-label',
    'Découvrir Dur.air, solution d’acquisition 3D du laboratoire MAP, CNRS',
  );

  const repere = document.createElement('span');
  repere.className = 'accueil-acquisition-repere';
  repere.textContent = 'Acquisition 3D';

  const texte = document.createElement('span');
  texte.className = 'accueil-acquisition-texte';
  const nom = document.createElement('strong');
  nom.textContent = 'Dur.air';
  texte.append(nom, ' · Photogrammétrie & LiDAR · MAP (CNRS)');

  const fleche = document.createElement('span');
  fleche.className = 'accueil-acquisition-fleche';
  fleche.setAttribute('aria-hidden', 'true');
  fleche.textContent = '↗';

  acquisition.append(repere, texte, fleche);
  return acquisition;
}

export function afficherAccueil(hote, catalogue) {
  hote.replaceChildren();

  const entete = document.createElement('header');
  entete.className = 'accueil-entete';

  const navigation = document.createElement('div');
  navigation.className = 'accueil-navigation';
  const identite = creerIdentite();
  const domaine = document.createElement('p');
  domaine.className = 'accueil-domaine';
  domaine.textContent = 'Conservation · Recherche · Collections';
  navigation.append(identite, domaine);

  const hero = document.createElement('div');
  hero.className = 'accueil-hero';

  const contenu = document.createElement('div');
  contenu.className = 'accueil-hero-contenu';

  const logo = document.createElement('img');
  logo.className = 'accueil-logo';
  logo.src = './logo.svg';
  logo.alt = '';
  logo.decoding = 'async';

  const surtitre = document.createElement('p');
  surtitre.className = 'accueil-surtitre';
  surtitre.textContent = 'Plateforme de documentation 3D';

  const titre = document.createElement('h1');
  titre.className = 'accueil-titre';
  titre.textContent = 'Pygmalion';

  const marqueTexte = document.createElement('div');
  marqueTexte.className = 'accueil-marque-texte';
  marqueTexte.append(titre, surtitre);

  const marque = document.createElement('div');
  marque.className = 'accueil-marque';
  marque.append(logo, marqueTexte);

  const signature = document.createElement('p');
  signature.className = 'accueil-signature';
  signature.textContent = 'Observer, mesurer et documenter le patrimoine en trois dimensions.';

  const propos = document.createElement('p');
  propos.className = 'accueil-propos';
  propos.textContent = 'Les acquisitions LiDAR et les relevés photogrammétriques sont réalisés à l’aide de l’application Dur.air afin de produire des modèles tridimensionnels du patrimoine. La plateforme Pygmalion permet de visualiser, mesurer, annoter, documenter et partager ces modèles au sein des communautés scientifiques et professionnelles du patrimoine.';

  contenu.append(marque, signature, propos, creerAcquisition());
  hero.appendChild(contenu);
  entete.append(navigation, hero);

  const catalogueEntete = document.createElement('div');
  catalogueEntete.className = 'accueil-bandeau';
  const catalogueTitre = document.createElement('div');
  const invite = document.createElement('h2');
  invite.className = 'accueil-invite';
  invite.textContent = 'Catalogue des collections numérisées';
  const aide = document.createElement('p');
  aide.className = 'accueil-aide';
  aide.textContent = 'Sélectionnez un objet pour ouvrir son espace d’étude.';
  catalogueTitre.append(invite, aide);

  const compte = document.createElement('span');
  compte.className = 'accueil-compte';
  compte.textContent = String(catalogue.length).padStart(2, '0');
  const compteLibelle = document.createElement('span');
  compteLibelle.textContent = catalogue.length > 1 ? ' objets documentés' : ' objet documenté';
  compte.appendChild(compteLibelle);
  catalogueEntete.append(catalogueTitre, compte);

  const grille = document.createElement('div');
  grille.className = 'accueil-grille';

  catalogue.forEach((entree, index) => {
    const carte = document.createElement('a');
    carte.className = 'accueil-carte';
    carte.href = `?objet=${encodeURIComponent(entree.id)}`;
    carte.style.setProperty('--index-carte', index);

    const cadre = document.createElement('div');
    cadre.className = 'accueil-vignette';
    const image = document.createElement('img');
    image.src = `./objets/${entree.id}/vignette.jpg`;
    image.alt = '';
    image.loading = index < 3 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { cadre.hidden = true; });

    const numero = document.createElement('span');
    numero.className = 'accueil-numero';
    numero.textContent = String(index + 1).padStart(2, '0');
    cadre.append(image, numero);

    const corps = document.createElement('span');
    corps.className = 'accueil-carte-corps';
    const nom = document.createElement('span');
    nom.className = 'accueil-nom';
    nom.textContent = entree.nom ?? entree.id;
    const fleche = document.createElement('span');
    fleche.className = 'accueil-carte-fleche';
    fleche.setAttribute('aria-hidden', 'true');
    fleche.textContent = '↗';
    corps.append(nom, fleche);

    carte.append(cadre, corps);
    if (entree.detail) {
      const detail = document.createElement('span');
      detail.className = 'accueil-detail';
      detail.textContent = entree.detail;
      carte.appendChild(detail);
    }
    grille.appendChild(carte);
  });

  const pied = document.createElement('footer');
  pied.className = 'accueil-pied';
  const credit = document.createElement('p');
  credit.textContent = 'Pygmalion · Documentation scientifique du patrimoine en 3D';
  const technique = document.createElement('p');
  technique.append('Conception et développement — ', creerIdentite());
  pied.append(credit, technique);

  hote.append(entete, catalogueEntete, grille, pied);
  hote.hidden = false;
  document.body.classList.add('sur-accueil');
}
