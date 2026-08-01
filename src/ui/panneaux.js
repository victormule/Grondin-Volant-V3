// Collapsing behaviour, shared by both side panels.
//
// Since there is no separate viewing mode, folding both panels is what gives
// back the bare presentation site — so the state is remembered rather than
// reset on every visit.

const PREFIXE = 'durair.panneau.';

export function installerPanneau(elements, options = {}) {
  const { panneau, bouton, icone, etiquette } = elements;
  const { cote = 'gauche', ouvertParDefaut = true, memoriser = true, surBascule = null } = options;
  const cle = PREFIXE + cote;

  const fleches = cote === 'gauche' ? { ouvert: '◀', ferme: '▶' } : { ouvert: '▶', ferme: '◀' };

  let ouvertCourant = ouvertParDefaut;
  if (memoriser) {
    const memorise = localStorage.getItem(cle);
    if (memorise !== null) ouvertCourant = memorise === '1';
  }

  function definirOuvert(ouvert, prevenir = true) {
    ouvertCourant = ouvert;
    panneau.classList.toggle('collapsed', !ouvert);
    bouton.classList.toggle('panel-open', ouvert);
    bouton.setAttribute('aria-expanded', String(ouvert));

    const texte = ouvert ? 'Replier le panneau' : 'Déplier le panneau';
    icone.textContent = ouvert ? fleches.ouvert : fleches.ferme;
    etiquette.textContent = texte;
    bouton.title = texte;

    if (memoriser) localStorage.setItem(cle, ouvert ? '1' : '0');
    if (prevenir) surBascule?.(ouvert, cote);
  }

  bouton.addEventListener('click', () => definirOuvert(!ouvertCourant));
  definirOuvert(ouvertCourant, false);

  return {
    definirOuvert,
    estOuvert: () => ouvertCourant,
  };
}

// On a phone both panels take the full width, so opening one has to close the
// other; otherwise the second silently covers the first.
export function exclusiviteMobile(panneaux, largeurMax = 640) {
  return (ouvert, cote) => {
    if (!ouvert || !window.matchMedia(`(max-width: ${largeurMax}px)`).matches) return;
    for (const [nom, panneau] of Object.entries(panneaux)) {
      if (nom !== cote && panneau.estOuvert()) panneau.definirOuvert(false, false);
    }
  };
}
