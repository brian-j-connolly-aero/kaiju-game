/**
 * Icons as pictures for a canvas: the single-color SVG icons of `public/assets/ui` (docs/ASSETS.md
 * section 5) drawn in a chosen color, for places that are not the DOM: the pick-up picture over a
 * supply crate in the 3D view, and the crates on the map (phase 2). Decoded once per icon and
 * color; nothing is drawn until the picture is ready, and an icon without a file stays null.
 */

import type { PickupKind } from '@mb/shared';
import type { AssetStore } from './assetStore';

/** The picture of a pick-up: `pk_` and its id in lower case (docs/ASSETS.md section 5). */
export function pickupIcon(kind: PickupKind): string {
  return `pk_${kind.toLowerCase()}`;
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** The markup with `currentColor` replaced by `color`, sized `px` square. */
export function tintSvg(markup: string, color: string, px: number): string {
  let svg = markup.replace(/currentColor/g, color);
  // An icon has no size of its own (it fills its box): give it one, or a browser may draw it at 300 by 150.
  svg = svg.replace(/<svg\b/, `<svg width="${px}" height="${px}"`);
  return svg;
}

/** An icon decoded as an image in `color`, or null when it has no art file (or cannot be decoded). */
export function iconImage(assets: AssetStore, id: string, color: string, px = 128): Promise<HTMLImageElement | null> {
  const key = `${id}|${color}|${px}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = assets.uiSvg(id).then(
      (markup) =>
        new Promise<HTMLImageElement | null>((done) => {
          if (!markup || typeof Image === 'undefined') {
            done(null);
            return;
          }
          const img = new Image(px, px);
          img.onload = () => done(img);
          img.onerror = () => done(null);
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tintSvg(markup, color, px))}`;
        }),
    );
    cache.set(key, pending);
  }
  return pending;
}
