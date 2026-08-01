// Augmented reality without model-viewer. Both platforms expose AR through a
// plain link, so dropping the component costs nothing here:
//   iOS     — <a rel="ar"> hands the .usdz to Quick Look. Safari insists the
//             anchor contains exactly one <img>, hence the hidden anchor.
//   Android — an intent URL opens Scene Viewer with the .glb, which must be
//             an absolute https address.

const EST_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const EST_ANDROID = /android/i.test(navigator.userAgent);

const PIXEL_TRANSPARENT =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function configurerAR(bouton, titre) {
  if (!EST_IOS && !EST_ANDROID) {
    bouton.hidden = true;
    return () => {};
  }

  let lien = null;
  if (EST_IOS) {
    lien = document.createElement('a');
    lien.rel = 'ar';
    lien.style.display = 'none';
    lien.appendChild(Object.assign(document.createElement('img'), { src: PIXEL_TRANSPARENT, alt: '' }));
    document.body.appendChild(lien);
  }

  let sourceGlb = null;
  let sourceUsdz = null;

  bouton.addEventListener('click', () => {
    if (EST_IOS) {
      if (!sourceUsdz) return;
      lien.href = sourceUsdz;
      lien.click();
      return;
    }
    if (!sourceGlb) return;
    const secours = `${location.href.split('#')[0]}`;
    const intention = `intent://arvr.google.com/scene-viewer/1.0`
      + `?file=${encodeURIComponent(sourceGlb)}`
      + `&mode=ar_preferred&title=${encodeURIComponent(titre)}`
      + `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;`
      + `action=android.intent.action.VIEW;`
      + `S.browser_fallback_url=${encodeURIComponent(secours)};end;`;
    location.href = intention;
  });

  // Scene Viewer needs an absolute URL; Quick Look accepts a relative one.
  return (glb, usdz) => {
    sourceGlb = glb ? new URL(glb, location.href).href : null;
    sourceUsdz = usdz || null;
    bouton.hidden = EST_IOS ? !sourceUsdz : !sourceGlb;
  };
}
