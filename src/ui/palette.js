// Colour palette.
//
// Reuses the swatch styling of the background picker in the left-hand panel,
// so the two read as the same control rather than as two ideas about colour.

export function creerPalette(couleurs, surChoix, options = {}) {
  const { avecPersonnalisee = true } = options;
  const bloc = document.createElement('div');
  bloc.className = 'swatches palette';

  const pastilles = [];
  for (const couleur of couleurs) {
    const pastille = document.createElement('button');
    pastille.type = 'button';
    pastille.className = 'swatch';
    pastille.style.background = couleur;
    pastille.title = couleur;
    pastille.dataset.couleur = couleur.toLowerCase();
    pastille.addEventListener('click', () => surChoix(couleur));
    bloc.appendChild(pastille);
    pastilles.push(pastille);
  }

  let champ = null;
  if (avecPersonnalisee) {
    const etiquette = document.createElement('label');
    etiquette.className = 'swatch swatch-custom';
    etiquette.title = 'Couleur personnalisée';
    champ = document.createElement('input');
    champ.type = 'color';
    champ.addEventListener('input', () => surChoix(champ.value));
    etiquette.appendChild(champ);
    bloc.appendChild(etiquette);
  }

  // Marks whichever swatch matches the current colour, so the palette shows
  // the state rather than only offering choices.
  bloc.marquer = (couleur) => {
    const valeur = (couleur || '').toLowerCase();
    let trouve = false;
    for (const pastille of pastilles) {
      const actif = pastille.dataset.couleur === valeur;
      pastille.setAttribute('aria-pressed', String(actif));
      pastille.classList.toggle('choisie', actif);
      if (actif) trouve = true;
    }
    if (champ && !trouve && valeur) champ.value = valeur;
  };

  return bloc;
}
