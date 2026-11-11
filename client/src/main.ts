/**
 * PLACEHOLDER entry point. The client workers replace this file with the real boot sequence
 * (screen state machine, renderer, network; see docs/ARCHITECTURE.md section 5).
 *
 * It exists so the workspace wiring is proven end to end: Vite serves and builds this file with
 * '@mb/shared' resolved from source.
 */

import { getCity, PROTOCOL_VERSION } from '@mb/shared';

const { city } = getCity();
document.title = 'Monster Battle 9001';
const note = document.createElement('pre');
note.textContent = `client placeholder: @mb/shared is wired (protocol ${PROTOCOL_VERSION}, ${city.structures.length} structures).`;
document.body.append(note);
