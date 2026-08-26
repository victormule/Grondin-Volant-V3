// Le catalogue, dans le panneau de gauche.
//
// Il reprend les classes de la liste des sessions sans en ajouter : ce sont
// deux listes du même genre, l'une au-dessus de l'autre — quel objet, puis
// quelle capture de cet objet — et les distinguer visuellement les ferait lire
// comme deux mécanismes différents alors qu'il n'y en a qu'un.
//
// CHANGER D'OBJET RECHARGE LA PAGE, ET C'EST VOULU. Démonter la scène à chaud
// demanderait de vider, dans le bon ordre, les atlas de peinture, les analyses
// de maillage, les caches de régions et de contours, tous indexés par capture,
// plus le brouillon local. Un seul oubli laisserait la peinture d'un objet sur
// la surface d'un autre — une fuite qui ne se voit qu'après coup et qu'on ne
// sait plus expliquer. Le rechargement rend cette catégorie de bug impossible,
// et il coûte le temps d'un .glb de moins de deux mégaoctets.
//
// Le brouillon en cours n'est pas perdu : app.js vide la sauvegarde différée
// sur « pagehide », qui se déclenche avant que la page ne parte.

import { catalogue, objet } from '../objet.js';

export function installerListeObjets(hote) {
  if (!hote) return;
  hote.replaceChildren();

  // Un catalogue d'un seul objet n'est pas un choix : la section entière
  // disparaît plutôt que d'afficher une liste à une ligne, toujours cochée.
  const section = hote.closest('.panel-section');
  if (catalogue.length < 2) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;

  for (const entree of catalogue) {
    const courant = entree.id === objet.id;
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'session-tab';
    bouton.setAttribute('aria-pressed', String(courant));

    bouton.append(entree.nom ?? entree.id);
    if (entree.detail) {
      const detail = document.createElement('span');
      detail.textContent = entree.detail;
      bouton.appendChild(detail);
    }

    if (!courant) {
      bouton.addEventListener('click', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('objet', entree.id);
        window.location.assign(url);
      });
    }
    hote.appendChild(bouton);
  }
}
