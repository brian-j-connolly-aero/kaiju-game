/**
 * Icons for the no-reading interface (DESIGN.md section 8). `icon(id)` returns an element at
 * once, showing the placeholder drawing; when the art file for that id exists it is fetched and
 * swapped in. Icons are single-color and take the text color of whatever they sit in.
 */

import type { AssetStore } from '../assets/assetStore';
import type { Glyph } from '../game/input/actions';
import { iconArt } from './iconArt';

const SVG_NS = 'http://www.w3.org/2000/svg';

let store: AssetStore | null = null;

/** Tells the icon module where real art comes from. Before this, every icon is a placeholder. */
export function setIconSource(assets: AssetStore): void {
  store = assets;
}

/** The markup of an art file from ui/, or null when it does not exist. */
export function uiMarkup(id: string): Promise<string | null> {
  return store ? store.uiSvg(id) : Promise.resolve(null);
}

function placeholder(id: string): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 64 64" aria-hidden="true">${iconArt(id)}</svg>`;
}

/** An icon element. `className` is added next to the base class `icon`. */
export function icon(id: string, className = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `icon ${className}`.trim();
  el.dataset.icon = id;
  el.innerHTML = placeholder(id);
  const assets = store;
  if (assets) {
    const url = assets.uiUrl(id);
    if (url && url.toLowerCase().endsWith('.png')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.draggable = false;
      el.replaceChildren(img);
    } else if (url) {
      void assets.uiSvg(id).then((svg) => {
        if (svg && el.dataset.icon === id) el.innerHTML = svg;
      });
    }
  }
  return el;
}

/** Changes which icon an existing element shows. */
export function setIcon(el: HTMLElement, id: string): void {
  if (el.dataset.icon === id) return;
  const fresh = icon(id);
  el.dataset.icon = id;
  el.replaceChildren(...Array.from(fresh.childNodes));
  if (store) {
    void store.uiSvg(id).then((svg) => {
      if (svg && el.dataset.icon === id) el.innerHTML = svg;
    });
  }
}

/** A button glyph: a pictured button, or a blank keycap with the key's letter on it. */
export function glyph(g: Glyph | null, className = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `glyph ${className}`.trim();
  setGlyph(el, g);
  return el;
}

export function setGlyph(el: HTMLElement, g: Glyph | null): void {
  const key = g ? `${g.icon}:${g.label}` : '';
  if (el.dataset.glyph === key) return;
  el.dataset.glyph = key;
  el.replaceChildren();
  if (!g) return;
  el.append(icon(g.icon));
  if (g.label) {
    const label = document.createElement('span');
    label.className = 'glyph-label';
    label.textContent = g.label;
    el.append(label);
  }
}

/** A portrait image (`portrait_<kind>.png`), or a large placeholder icon when the file is missing. */
export function portrait(id: string, fallbackIcon: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'portrait';
  const url = store?.uiUrl(id);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    el.append(img);
  } else {
    el.append(icon(fallbackIcon));
  }
  return el;
}

/** Small DOM helper used across the UI modules. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', children: Array<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) node.append(child);
  return node;
}
