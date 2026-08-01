// A very small Markdown subset, rendered without a library.
//
// Note the order: the text is HTML-escaped *first*, then the patterns are
// applied to the escaped text. Annotation text is written by whoever opens the
// page and may end up published, so it never reaches innerHTML unescaped.

const ECHAPPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function echapper(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => ECHAPPES[c]);
}

// Only these schemes: escaping alone would not stop a javascript: URL.
function lienSur(url) {
  return /^(https?:|mailto:|\.\/|\/)/i.test(url.trim());
}

function enLigne(texte) {
  return texte
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (tout, libelle, url) => (lienSur(url)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${libelle}</a>`
      : libelle))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function rendreMarkdown(source) {
  if (!source || !source.trim()) return '';
  const lignes = echapper(source).split(/\r?\n/);
  const sortie = [];
  let liste = null;
  let paragraphe = [];

  const viderParagraphe = () => {
    if (paragraphe.length === 0) return;
    sortie.push(`<p>${enLigne(paragraphe.join('<br>'))}</p>`);
    paragraphe = [];
  };
  const viderListe = () => {
    if (!liste) return;
    sortie.push(`<ul>${liste.map((i) => `<li>${enLigne(i)}</li>`).join('')}</ul>`);
    liste = null;
  };

  for (const ligne of lignes) {
    const titre = ligne.match(/^(#{1,3})\s+(.*)$/);
    const puce = ligne.match(/^[-*]\s+(.*)$/);

    if (titre) {
      viderParagraphe(); viderListe();
      const niveau = Math.min(titre[1].length + 3, 6);
      sortie.push(`<h${niveau}>${enLigne(titre[2])}</h${niveau}>`);
    } else if (puce) {
      viderParagraphe();
      (liste ||= []).push(puce[1]);
    } else if (ligne.trim() === '') {
      viderParagraphe(); viderListe();
    } else {
      viderListe();
      paragraphe.push(ligne);
    }
  }

  viderParagraphe();
  viderListe();
  return sortie.join('');
}
