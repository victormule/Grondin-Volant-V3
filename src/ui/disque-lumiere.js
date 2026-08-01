// The light disc: where the key light comes from, as one grabbable dot.
//
// The mapping is the whole reason this reads at a glance. The disc is the
// hemisphere in front of the specimen, seen from the camera:
//
//   centre  → the light is straight down the lens. Everything is lit head on,
//             nothing casts, the surface looks flat. It is the useless case,
//             and it belongs at the centre so that is obvious.
//   rim     → the light is at ninety degrees to the view. Fully grazing: every
//             scale and every fin ray throws its own shadow. That is the image
//             worth taking, and it is at arm's length from the centre.
//   beyond  → slightly behind the specimen, which rims the translucent fin
//             webbing. The ring drawn on the disc marks where grazing is, so
//             the extra margin reads as « past grazing » rather than as slack.
//
// The dot stays where it is dropped. That is the point: the old mode tied the
// light to the pointer, so it swung away the instant you reached for a slider
// and there was no way to hold an angle you liked.

const TAILLE = 132;

export function creerDisqueLumiere({ x = 0, y = 0, angleMax = 110, surChangement }) {
  const hote = document.createElement('div');
  hote.className = 'disque-lumiere';

  const disque = document.createElement('div');
  disque.className = 'disque-lumiere-surface';
  disque.tabIndex = 0;
  disque.setAttribute('role', 'application');
  disque.setAttribute('aria-label',
    'Direction de la lumière. Flèches pour déplacer, Origine pour revenir au centre.');

  // The ring sits where the light is exactly grazing; everything outside it is
  // behind the specimen.
  const anneau = document.createElement('div');
  anneau.className = 'disque-lumiere-anneau';
  anneau.style.inset = `${(1 - 90 / angleMax) * 50}%`;

  const point = document.createElement('div');
  point.className = 'disque-lumiere-point';

  disque.append(anneau, point);

  const lecture = document.createElement('span');
  lecture.className = 'disque-lumiere-lecture';

  hote.append(disque, lecture);

  let vx = x;
  let vy = y;

  const appliquer = (emettre = true) => {
    // The dot may sit past the grazing ring but not off the disc.
    const r = Math.hypot(vx, vy);
    if (r > 1) { vx /= r; vy /= r; }

    point.style.left = `${(vx * 0.5 + 0.5) * 100}%`;
    // Screen y grows downwards; the light's y grows upwards.
    point.style.top = `${(-vy * 0.5 + 0.5) * 100}%`;

    // The disc previews what it does: the shading follows the dot, so the
    // widget looks like the sphere the light is about to carve.
    const eclat = Math.min(1, Math.hypot(vx, vy));
    disque.style.setProperty('--lx', `${(vx * 0.5 + 0.5) * 100}%`);
    disque.style.setProperty('--ly', `${(-vy * 0.5 + 0.5) * 100}%`);
    disque.style.setProperty('--durete', String(0.35 + eclat * 0.4));

    const angle = Math.round(Math.min(1, Math.hypot(vx, vy)) * angleMax);
    lecture.textContent = angle <= 2
      ? 'De face — aucun relief'
      : (angle >= 90 ? `${angle}° — à contre-jour` : `${angle}° — ${angle >= 68 ? 'rasante' : 'oblique'}`);
    disque.setAttribute('aria-valuetext', lecture.textContent);

    if (emettre) surChangement?.(vx, vy);
  };

  const depuisEvenement = (evenement) => {
    const rect = disque.getBoundingClientRect();
    vx = ((evenement.clientX - rect.left) / rect.width) * 2 - 1;
    vy = -(((evenement.clientY - rect.top) / rect.height) * 2 - 1);
    appliquer();
  };

  let pointeur = null;
  disque.addEventListener('pointerdown', (evenement) => {
    if (evenement.button !== undefined && evenement.button !== 0) return;
    pointeur = evenement.pointerId;
    disque.setPointerCapture?.(evenement.pointerId);
    disque.classList.add('saisi');
    depuisEvenement(evenement);
    evenement.preventDefault();
  });

  disque.addEventListener('pointermove', (evenement) => {
    if (evenement.pointerId !== pointeur) return;
    depuisEvenement(evenement);
    evenement.preventDefault();
  });

  const relacher = (evenement) => {
    if (evenement.pointerId !== pointeur) return;
    if (disque.hasPointerCapture?.(evenement.pointerId)) {
      disque.releasePointerCapture(evenement.pointerId);
    }
    pointeur = null;
    disque.classList.remove('saisi');
  };
  disque.addEventListener('pointerup', relacher);
  disque.addEventListener('pointercancel', relacher);

  disque.addEventListener('keydown', (evenement) => {
    const pas = evenement.shiftKey ? 0.02 : 0.08;
    if (evenement.key === 'ArrowLeft') vx -= pas;
    else if (evenement.key === 'ArrowRight') vx += pas;
    else if (evenement.key === 'ArrowUp') vy += pas;
    else if (evenement.key === 'ArrowDown') vy -= pas;
    else if (evenement.key === 'Home') { vx = 0; vy = 0; }
    else return;
    evenement.preventDefault();
    appliquer();
  });

  appliquer(false);

  return {
    element: hote,
    definir(nx, ny) { vx = nx; vy = ny; appliquer(false); },
    get valeur() { return { x: vx, y: vy }; },
  };
}

export const TAILLE_DISQUE = TAILLE;
