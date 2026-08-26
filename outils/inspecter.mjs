// Décrit un .glb : matériaux, textures, encodage, jeux d'UV.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const chemin of process.argv.slice(2)) {
  const doc = await io.read(chemin);
  const r = doc.getRoot();
  console.log(`\n${chemin}`);
  console.log(`  extensions : ${r.listExtensionsUsed().map((e) => e.extensionName).join(', ') || 'aucune'}`);
  for (const maille of r.listMeshes()) {
    for (const prim of maille.listPrimitives()) {
      const sem = prim.listSemantics().join(', ');
      console.log(`  primitive  : ${prim.getAttribute('POSITION').getCount()} sommets, ${prim.getIndices()?.getCount() / 3 || 0} faces`);
      console.log(`  attributs  : ${sem}`);
    }
  }
  for (const mat of r.listMaterials()) {
    const t = (nom, tex, info) => {
      if (!tex) return `${nom}=—`;
      const img = tex.getImage();
      return `${nom}=${tex.getMimeType().replace('image/', '')} ${Math.round((img?.byteLength ?? 0) / 1024)} Ko uv${info?.getTexCoord() ?? 0}`;
    };
    console.log(`  materiau   : ${mat.getName() || '(sans nom)'}  rugosite=${mat.getRoughnessFactor()} metal=${mat.getMetallicFactor()} alphaMode=${mat.getAlphaMode()}`);
    console.log(`    ${t('base', mat.getBaseColorTexture(), mat.getBaseColorTextureInfo())}`);
    console.log(`    ${t('normale', mat.getNormalTexture(), mat.getNormalTextureInfo())}`);
    console.log(`    ${t('occlusion', mat.getOcclusionTexture(), mat.getOcclusionTextureInfo())}`);
  }
}
