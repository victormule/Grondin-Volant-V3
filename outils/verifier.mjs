// Vérifie qu'un navigateur pourrait charger le site, sans navigateur.
//
//   node outils/verifier.mjs
//
// Sert le dossier sur un port éphémère, puis demande TOUT ce que la page ira
// chercher : le graphe complet des modules ES depuis src/amorce.js, le
// catalogue, le manifeste de chaque objet, ses .glb, son document publié, ses
// résidus de recalage. Une 404 ici est une page blanche là-bas.
//
// C'est le filet du catalogue : ajouter un objet, c'est ajouter une ligne à
// objets/catalogue.json et un dossier, et rien ne relit ces chemins avant que
// quelqu'un n'ouvre la page. Ceci les relit.

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SEP = String.fromCharCode(92);
const racine = process.cwd();
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png',
};

const serveur = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(racine, url === '/' ? 'index.html' : url);
  if (!f.startsWith(racine) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end('404');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

await new Promise((resoudre) => serveur.listen(0, resoudre));
const base = `http://127.0.0.1:${serveur.address().port}`;

const chemins = ['/', '/config.js', '/objets/catalogue.json'];

// Le graphe de modules, statique et dynamique, depuis la seule entrée.
const vus = new Set();
const suivre = (f) => {
  if (vus.has(f)) return;
  vus.add(f);
  chemins.push('/' + f.split(SEP).join('/'));
  const src = fs.readFileSync(f, 'utf8');
  const liens = [
    ...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g),
    ...src.matchAll(/import\(\s*['"](\.[^'"]+)['"]/g),
  ];
  for (const m of liens) suivre(path.normalize(path.join(path.dirname(f), m[1])));
};
suivre(path.join('src', 'amorce.js'));

// Chaque objet du catalogue, et tout ce que son manifeste promet.
const catalogue = JSON.parse(fs.readFileSync('objets/catalogue.json', 'utf8'));
const resumes = [];
for (const entree of catalogue) {
  const dossier = `objets/${entree.id}`;
  chemins.push(`/${dossier}/objet.json`);
  const m = JSON.parse(fs.readFileSync(`${dossier}/objet.json`, 'utf8'));
  chemins.push(`/${dossier}/annotations/annotations.json`);
  // La page d accueil sert ces vignettes : une manquante, et le catalogue montre
  // une carte trouee.
  chemins.push(`/${dossier}/vignette.jpg`);
  if (m.recalage) chemins.push(`/${dossier}/${m.recalage}`);
  for (const s of m.sessions ?? []) chemins.push(`/${dossier}/${s.glb}`);

  // Un document publié dans un autre repère que celui de l'objet est refusé au
  // chargement, en silence pour qui n'ouvre pas la console. Autant le dire ici.
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(`${dossier}/annotations/annotations.json`, 'utf8')); } catch { /* absent */ }
  // Compter les enfants de la racine ne comptait que les groupes de premier
  // niveau : le dossier de démonstration du grondin, ses vingt-sept calques
  // rangés dans quatre groupes, s'annonçait « 4 calque(s) ». Un outil de
  // vérification qui arrondit à la baisse ce qu'il est chargé de vérifier ne
  // sert à rien. On descend l'arbre.
  const denombrer = (noeud) => (noeud?.enfants ?? []).reduce(
    (n, enfant) => n + (enfant.type === 'groupe' ? 0 : 1) + denombrer(enfant),
    0,
  );
  const calques = denombrer(doc?.racine);
  const repereOK = calques === 0 || doc?.repere === m.repere;
  resumes.push({
    id: entree.id,
    captures: (m.sessions ?? []).length,
    echelle: m.reglages?.mesure?.longueurReelleReference ? 'calibré' : 'NON CALIBRÉ',
    calques,
    repereOK,
    // LA PHRASE QUE LIT LE VISITEUR, À CÔTÉ DES FAITS.
    //
    // catalogue.json porte une description libre, et rien ne la relit quand
    // l'objet change. Elle a dérivé sans bruit : cadre-2 annonçait « 1 capture »
    // alors qu'il en montrait trois, et les quatre cadres se disaient « non
    // calibré » une fois calibrés. C'est la première chose qu'on lit du site.
    //
    // La contrôler par un analyseur de texte serait fragile — c'est de la prose.
    // L'imprimer sous les chiffres suffit : le désaccord saute aux yeux à chaque
    // passage, et corriger prend dix secondes.
    detail: entree.detail ?? '',
  });
}

let echecs = 0;
for (const c of [...new Set(chemins)]) {
  const r = await fetch(base + c);
  if (r.status !== 200) { console.log(`  ${r.status}  ${c}`); echecs += 1; }
  await r.arrayBuffer();
}
serveur.close();

// UNE 404 N'EST PAS LA SEULE FAÇON DE DISPARAÎTRE.
//
// Tout ce que le serveur local vient de servir existe sur le disque. Rien ne
// dit que git le publiera : un fichier qu'une règle de .gitignore attrape est
// absent du dépôt déployé, et le site renvoie alors 404 sur un fichier qu'on a
// sous les yeux. C'est arrivé — git tourne ici avec core.ignorecase = true, et
// la règle « Cadre*/ » écrite pour les exports bruts attrapait aussi
// objets/cadre-1/. Les quatre cadres étaient sur le disque, servis en local,
// vérifiés par ce script, et hors du dépôt.
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const ignores = [];
try {
  const locaux = [...new Set(chemins)]
    .map((c) => (c.startsWith('/') ? c.slice(1) : c))
    .filter((c) => c && fs.existsSync(c));
  const sortie = execFileSync('git', ['check-ignore', '--stdin'], {
    input: locaux.join(NL),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  ignores.push(...sortie.split(NL).filter(Boolean));
} catch (erreur) {
  // check-ignore sort en 1 quand RIEN n'est ignoré : c'est le cas nominal.
  if (erreur.status !== 1) console.log('  (contrôle .gitignore indisponible)');
}
if (ignores.length > 0) {
  echecs += ignores.length;
  console.log(`${NL}${ignores.length} fichier(s) servis en local mais IGNORÉS PAR GIT :`);
  for (const f of ignores) {
    const detail = execFileSync('git', ['check-ignore', '-v', f], { encoding: 'utf8' });
    console.log(`  ${f}${NL}      exclu par ${detail.trim().split(TAB)[0]}`);
  }
}

console.log(`${new Set(chemins).size} requêtes, ${vus.size} modules ES, ${echecs} échec(s)`);
for (const r of resumes) {
  const repere = r.repereOK ? '' : '  ⚠ REPÈRE DU DOCUMENT ≠ REPÈRE DE L’OBJET (calques refusés)';
  console.log(`  ${r.id.padEnd(18)} ${String(r.captures).padStart(2)} entrée(s)  ${r.echelle.padEnd(12)} `
    + `${String(r.calques).padStart(2)} calque(s)${repere}`);
  console.log(`  ${' '.repeat(18)} « ${r.detail} »`);
  if (!r.repereOK) echecs += 1;
}
process.exit(echecs ? 1 : 0);
