/**
 * Text-free placeholder icons, one per id in docs/ASSETS.md section 5, drawn as a few thick
 * strokes on a 64 x 64 grid in `currentColor`. They stand in until the hand-drawn SVG files
 * land in public/assets/ui/ and remain the fallback for any id without a file.
 */

const S = 'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';

/**
 * The outline of a cog wheel around (cx, cy): `teeth` blunt teeth reaching `outer`, the rim at
 * `inner`, and a round hole of radius `hole` (draw it with the even-odd fill rule).
 */
function cogPath(cx: number, cy: number, outer: number, inner: number, hole: number, teeth: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (r: number, a: number): string => `${(cx + Math.sin(a) * r).toFixed(1)} ${(cy - Math.cos(a) * r).toFixed(1)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    // Each tooth is wider at the rim than at its tip.
    d += `${i === 0 ? 'M' : 'L'}${at(inner, a - step * 0.3)} L${at(outer, a - step * 0.19)} L${at(outer, a + step * 0.19)} L${at(inner, a + step * 0.3)} `;
  }
  return `${d}Z M${cx - hole} ${cy} A${hole} ${hole} 0 1 0 ${cx + hole} ${cy} A${hole} ${hole} 0 1 0 ${cx - hole} ${cy} Z`;
}

const ART: Record<string, string> = {
  // --- commands ---
  cmd_follow: `<circle cx="46" cy="32" r="7" ${F}/><path d="M10 18 L24 32 L10 46 M24 18 L38 32 L24 46" ${S}/>`,
  cmd_moveto: `<path d="M22 54 L22 12 L50 22 L22 32" ${S}/><ellipse cx="22" cy="54" rx="12" ry="4" ${S}/>`,
  cmd_fireatwill: `<path d="M12 50 L30 32 M12 32 L40 32 M12 14 L30 32" ${S}/><path d="M44 20 L54 14 M46 32 L58 32 M44 44 L54 50" ${S}/>`,
  cmd_holdcharge: `<path d="M32 6 L56 32 L32 58 L8 32 Z" ${S}/><path d="M24 38 L32 22 L32 34 L40 28 L32 44" ${S}/>`,
  // --- kaiju verbs ---
  k_swipe: `<path d="M14 12 Q34 26 30 54 M28 10 Q48 24 44 52 M42 10 Q60 22 56 46" ${S}/>`,
  k_stomp: `<path d="M22 8 L22 34 L14 44 L50 44 L42 34 L42 8" ${S}/><path d="M6 54 L20 54 M26 54 L38 54 M44 54 L58 54" ${S}/>`,
  k_grab: `<path d="M46 16 Q22 8 16 30 Q12 50 34 54 Q52 54 50 40" ${S}/><path d="M46 16 L52 24 M40 26 L50 40" ${S}/>`,
  k_throw: `<path d="M8 50 Q26 6 54 30" ${S} stroke-dasharray="2 9"/><rect x="42" y="26" width="16" height="12" rx="2" ${F}/><path d="M8 50 L20 44" ${S}/>`,
  k_eat: `<path d="M8 32 L38 12 A26 26 0 1 1 38 52 Z" ${S}/><circle cx="40" cy="24" r="4" ${F}/>`,
  k_brace: `<path d="M32 6 L54 14 L54 32 Q54 50 32 58 Q10 50 10 32 L10 14 Z" ${S}/>`,
  k_roar: `<path d="M8 22 L26 32 L8 42 Z" ${F}/><path d="M34 20 Q40 32 34 44 M44 14 Q54 32 44 50 M54 8 Q66 32 54 56" ${S}/>`,
  k_special: `<path d="M6 32 L40 32" stroke="currentColor" stroke-width="10" stroke-linecap="round" fill="none"/><path d="M48 14 L56 22 M52 32 L60 32 M48 50 L56 42" ${S}/>`,
  k_molt: `<path d="M32 6 Q52 22 50 40 Q48 58 32 58 Q16 58 14 40 Q12 22 32 6 Z" ${S}/><path d="M26 22 L34 30 L28 38 L36 46" ${S}/>`,
  // --- status ---
  st_health: `<path d="M32 54 L10 32 Q4 18 18 14 Q28 12 32 24 Q36 12 46 14 Q60 18 54 32 Z" ${F}/>`,
  st_nerve: `<path d="M6 34 L18 34 L24 14 L34 50 L42 26 L46 34 L58 34" ${S}/>`,
  st_rage: `<path d="M32 6 Q46 22 44 32 Q52 28 50 20 Q60 36 52 48 Q44 60 30 58 Q14 54 14 40 Q14 28 24 20 Q24 30 30 30 Q26 18 32 6 Z" ${F}/>`,
  st_reload: `<path d="M32 6 Q42 18 42 30 L42 46 L22 46 L22 30 Q22 18 32 6 Z M22 52 L42 52 L42 58 L22 58 Z" ${F}/>`,
  st_charge: `<path d="M32 8 L52 32 L32 56 L12 32 Z" ${F}/>`,
  st_veteran: `<path d="M12 26 L32 10 L52 26 M12 44 L32 28 L52 44" ${S}/>`,
  st_spotted: `<path d="M4 32 Q32 6 60 32 Q32 58 4 32 Z" ${S}/><circle cx="32" cy="32" r="8" ${F}/>`,
  st_crossfire: `<path d="M8 8 L56 56 M56 8 L8 56" ${S}/><path d="M56 56 L42 54 M56 56 L54 42 M8 56 L22 54 M8 56 L10 42" ${S}/>`,
  st_callin: `<circle cx="32" cy="38" r="16" ${S}/><path d="M32 4 L32 30 M24 22 L32 30 L40 22" ${S}/>`,
  st_shaken: `<path d="M8 20 Q16 10 24 20 T40 20 T56 20 M8 34 Q16 24 24 34 T40 34 T56 34 M8 48 Q16 38 24 48 T40 48 T56 48" ${S}/>`,
  st_map: `<path d="M8 14 L24 8 L40 14 L56 8 L56 50 L40 56 L24 50 L8 56 Z M24 8 L24 50 M40 14 L40 56" ${S}/>`,
  st_camera: `<rect x="8" y="20" width="48" height="32" rx="5" ${S}/><circle cx="32" cy="36" r="9" ${S}/><path d="M22 20 L26 12 L38 12 L42 20" ${S}/>`,
  st_sun: `<circle cx="32" cy="32" r="12" ${F}/><path d="M32 4 L32 12 M32 52 L32 60 M4 32 L12 32 M52 32 L60 32 M12 12 L18 18 M46 46 L52 52 M52 12 L46 18 M12 52 L18 46" ${S}/>`,
  st_moon: `<path d="M42 8 A26 26 0 1 0 56 44 A20 20 0 0 1 42 8 Z" ${F}/>`,
  // --- lobby ---
  lb_kaiju: `<path d="M32 6 L58 54 L6 54 Z" ${F}/><circle cx="24" cy="40" r="4" fill="#000" opacity="0.55"/><circle cx="40" cy="40" r="4" fill="#000" opacity="0.55"/>`,
  lb_human: `<circle cx="32" cy="32" r="24" ${F}/><path d="M14 30 L50 30" stroke="#000" stroke-width="6" opacity="0.45" fill="none"/>`,
  lb_ready: `<path d="M10 34 L26 50 L54 14" ${S} stroke-width="8"/>`,
  lb_host: `<path d="M8 48 L8 20 L20 32 L32 12 L44 32 L56 20 L56 48 Z" ${F}/>`,
  lb_bot: `<rect x="12" y="22" width="40" height="30" rx="5" ${S}/><path d="M32 22 L32 10" ${S}/><circle cx="32" cy="8" r="4" ${F}/><circle cx="24" cy="36" r="4" ${F}/><circle cx="40" cy="36" r="4" ${F}/>`,
  lb_link: `<path d="M26 38 L38 26" ${S}/><path d="M30 20 L36 14 Q44 8 52 14 Q58 22 50 30 L44 36" ${S}/><path d="M34 44 L28 50 Q20 56 12 50 Q6 42 14 34 L20 28" ${S}/>`,
  lb_play: `<path d="M18 8 L54 32 L18 56 Z" ${F}/>`,
  lb_back: `<path d="M28 12 L8 32 L28 52 M8 32 L56 32" ${S} stroke-width="7"/>`,
  lb_create: `<path d="M32 8 L32 56 M8 32 L56 32" ${S} stroke-width="8"/>`,
  lb_join: `<path d="M30 10 L54 10 L54 54 L30 54" ${S}/><path d="M6 32 L38 32 M26 20 L38 32 L26 44" ${S}/>`,
  // --- factions ---
  fac_army: `<path d="M32 4 L39 24 L60 24 L43 37 L50 58 L32 45 L14 58 L21 37 L4 24 L25 24 Z" ${F}/>`,
  fac_air: `<path d="M32 6 L38 28 L60 40 L60 46 L38 40 L36 52 L42 56 L42 60 L32 56 L22 60 L22 56 L28 52 L26 40 L4 46 L4 40 L26 28 Z" ${F}/>`,
  fac_science: `<ellipse cx="32" cy="32" rx="27" ry="11" transform="rotate(-45 32 32)" ${S}/><ellipse cx="32" cy="32" rx="27" ry="11" transform="rotate(45 32 32)" ${S}/><circle cx="32" cy="32" r="6" ${F}/><circle cx="13" cy="13" r="4.5" ${F}/><circle cx="51" cy="51" r="4.5" ${F}/>`,
  fac_faith: `<path d="M24 46 L24 26 Q24 14 32 10 Q40 14 40 26 L40 46 Z" ${F}/><path d="M18 55 L46 55" ${S}/><path d="M14 16 L9 10 M50 16 L55 10 M10 30 L4 28 M54 30 L60 28" ${S}/>`,
  // --- tally ---
  tl_car: `<path d="M6 40 L10 28 L20 18 L44 18 L54 28 L58 40 L58 46 L6 46 Z" ${F}/><circle cx="18" cy="48" r="6" ${F}/><circle cx="46" cy="48" r="6" ${F}/>`,
  tl_kiosk: `<path d="M8 22 L32 8 L56 22 Z" ${F}/><rect x="14" y="26" width="36" height="30" ${S}/>`,
  tl_house: `<path d="M6 30 L32 8 L58 30" ${S}/><rect x="14" y="30" width="36" height="26" ${F}/>`,
  tl_shop: `<rect x="8" y="26" width="48" height="30" ${F}/><path d="M4 22 L60 22 L56 10 L8 10 Z" ${S}/>`,
  tl_apartment: `<rect x="16" y="8" width="32" height="48" ${S}/><path d="M24 18 L28 18 M36 18 L40 18 M24 30 L28 30 M36 30 L40 30 M24 42 L28 42 M36 42 L40 42" ${S}/>`,
  tl_office: `<rect x="10" y="14" width="44" height="42" ${F}/><rect x="22" y="6" width="20" height="8" ${F}/>`,
  tl_tower: `<path d="M24 56 L24 16 L32 4 L40 16 L40 56 Z" ${F}/>`,
  tl_factory: `<path d="M6 56 L6 30 L22 40 L22 30 L38 40 L38 14 L50 14 L50 40 L58 40 L58 56 Z" ${F}/>`,
  tl_bridge: `<path d="M4 44 L60 44 M12 44 L12 56 M52 44 L52 56" ${S}/><path d="M8 44 Q32 4 56 44" ${S}/>`,
  tl_landmark: `<path d="M8 56 L56 56 L56 46 L8 46 Z" ${F}/><path d="M14 46 L14 28 M26 46 L26 28 M38 46 L38 28 M50 46 L50 28" ${S}/><path d="M6 26 L32 8 L58 26 Z" ${F}/>`,
  // --- device glyphs ---
  kb_key: `<rect x="8" y="8" width="48" height="48" rx="9" ${S} stroke-width="4"/>`,
  ms_left: `<rect x="14" y="6" width="36" height="52" rx="18" ${S} stroke-width="4"/><path d="M32 6 L32 28 L14 28 L14 24 Q14 6 32 6 Z" ${F}/>`,
  ms_right: `<rect x="14" y="6" width="36" height="52" rx="18" ${S} stroke-width="4"/><path d="M32 6 L32 28 L50 28 L50 24 Q50 6 32 6 Z" ${F}/>`,
  ms_middle: `<rect x="14" y="6" width="36" height="52" rx="18" ${S} stroke-width="4"/><rect x="28" y="12" width="8" height="16" rx="4" ${F}/>`,
  ms_move: `<rect x="20" y="14" width="24" height="36" rx="12" ${S} stroke-width="4"/><path d="M4 32 L12 32 M52 32 L60 32 M32 2 L32 8 M32 56 L32 62" ${S}/>`,
  gp_a: `<circle cx="32" cy="32" r="26" ${S} stroke-width="3" opacity="0.5"/><circle cx="32" cy="48" r="9" ${F}/><circle cx="32" cy="16" r="6" ${S} stroke-width="3"/><circle cx="16" cy="32" r="6" ${S} stroke-width="3"/><circle cx="48" cy="32" r="6" ${S} stroke-width="3"/>`,
  gp_b: `<circle cx="32" cy="32" r="26" ${S} stroke-width="3" opacity="0.5"/><circle cx="48" cy="32" r="9" ${F}/><circle cx="32" cy="16" r="6" ${S} stroke-width="3"/><circle cx="16" cy="32" r="6" ${S} stroke-width="3"/><circle cx="32" cy="48" r="6" ${S} stroke-width="3"/>`,
  gp_x: `<circle cx="32" cy="32" r="26" ${S} stroke-width="3" opacity="0.5"/><circle cx="16" cy="32" r="9" ${F}/><circle cx="32" cy="16" r="6" ${S} stroke-width="3"/><circle cx="48" cy="32" r="6" ${S} stroke-width="3"/><circle cx="32" cy="48" r="6" ${S} stroke-width="3"/>`,
  gp_y: `<circle cx="32" cy="32" r="26" ${S} stroke-width="3" opacity="0.5"/><circle cx="32" cy="16" r="9" ${F}/><circle cx="16" cy="32" r="6" ${S} stroke-width="3"/><circle cx="48" cy="32" r="6" ${S} stroke-width="3"/><circle cx="32" cy="48" r="6" ${S} stroke-width="3"/>`,
  gp_lb: `<path d="M8 40 L8 28 Q8 18 20 18 L56 18 L56 40 Z" ${F}/><path d="M8 48 L56 48" ${S} opacity="0.5"/>`,
  gp_rb: `<path d="M56 40 L56 28 Q56 18 44 18 L8 18 L8 40 Z" ${F}/><path d="M8 48 L56 48" ${S} opacity="0.5"/>`,
  gp_lt: `<path d="M14 56 L14 22 Q14 8 30 8 L44 8 L44 56 Z" ${F}/><path d="M52 14 L52 50" ${S} opacity="0.5"/>`,
  gp_rt: `<path d="M50 56 L50 22 Q50 8 34 8 L20 8 L20 56 Z" ${F}/><path d="M12 14 L12 50" ${S} opacity="0.5"/>`,
  gp_ls: `<circle cx="32" cy="32" r="24" ${S} stroke-width="4"/><circle cx="26" cy="32" r="10" ${F}/>`,
  gp_rs: `<circle cx="32" cy="32" r="24" ${S} stroke-width="4"/><circle cx="38" cy="32" r="10" ${F}/>`,
  gp_dpad: `<path d="M24 6 L40 6 L40 24 L58 24 L58 40 L40 40 L40 58 L24 58 L24 40 L6 40 L6 24 L24 24 Z" ${S} stroke-width="4"/>`,
  gp_dpad_up: `<path d="M24 6 L40 6 L40 24 L58 24 L58 40 L40 40 L40 58 L24 58 L24 40 L6 40 L6 24 L24 24 Z" ${S} stroke-width="4"/><rect x="24" y="6" width="16" height="18" ${F}/>`,
  gp_dpad_right: `<path d="M24 6 L40 6 L40 24 L58 24 L58 40 L40 40 L40 58 L24 58 L24 40 L6 40 L6 24 L24 24 Z" ${S} stroke-width="4"/><rect x="40" y="24" width="18" height="16" ${F}/>`,
  gp_dpad_down: `<path d="M24 6 L40 6 L40 24 L58 24 L58 40 L40 40 L40 58 L24 58 L24 40 L6 40 L6 24 L24 24 Z" ${S} stroke-width="4"/><rect x="24" y="40" width="16" height="18" ${F}/>`,
  gp_dpad_left: `<path d="M24 6 L40 6 L40 24 L58 24 L58 40 L40 40 L40 58 L24 58 L24 40 L6 40 L6 24 L24 24 Z" ${S} stroke-width="4"/><rect x="6" y="24" width="18" height="16" ${F}/>`,
  gp_start: `<path d="M14 22 L50 22 M14 32 L50 32 M14 42 L50 42" ${S}/>`,
  gp_back: `<rect x="10" y="18" width="30" height="22" rx="3" ${S} stroke-width="4"/><rect x="24" y="28" width="30" height="22" rx="3" ${S} stroke-width="4"/>`,
  // --- client extras (not in the art list) ---
  ui_sound: `<path d="M8 24 L20 24 L34 12 L34 52 L20 40 L8 40 Z" ${F}/><path d="M42 22 Q50 32 42 42 M48 14 Q62 32 48 50" ${S}/>`,
  ui_warning: `<path d="M32 6 L60 56 L4 56 Z" ${S}/><path d="M32 24 L32 40" ${S}/><circle cx="32" cy="48" r="3" ${F}/>`,
  ui_offline: `<path d="M8 8 L56 56" ${S}/><path d="M10 28 Q32 8 54 28 M20 40 Q32 30 44 40" ${S}/><circle cx="32" cy="52" r="4" ${F}/>`,
  ui_copy: `<rect x="20" y="8" width="34" height="38" rx="4" ${S}/><path d="M12 20 L12 56 L44 56" ${S}/>`,
  ui_skull: `<path d="M12 30 Q12 8 32 8 Q52 8 52 30 Q52 40 44 44 L44 54 L20 54 L20 44 Q12 40 12 30 Z" ${S}/><circle cx="24" cy="30" r="5" ${F}/><circle cx="40" cy="30" r="5" ${F}/>`,
  ui_clock: `<circle cx="32" cy="32" r="24" ${S}/><path d="M32 16 L32 32 L44 38" ${S}/>`,
  ui_trophy: `<path d="M18 8 L46 8 L46 24 Q46 38 32 38 Q18 38 18 24 Z" ${F}/><path d="M32 38 L32 50 M20 54 L44 54" ${S}/><path d="M18 12 L8 12 Q8 26 18 26 M46 12 L56 12 Q56 26 46 26" ${S}/>`,
  ui_newspaper: `<rect x="8" y="10" width="48" height="44" ${S} stroke-width="4"/><path d="M14 20 L50 20" ${S} stroke-width="6"/>`,
  // --- settings and the drone (drawn here only; no art file yet) ---
  ui_settings: `<path d="${cogPath(32, 32, 28, 20, 9, 8)}" fill="currentColor" fill-rule="evenodd" stroke="none"/>`,
  ui_invert: `<path d="M20 54 L20 10 M8 22 L20 10 L32 22" ${S}/><path d="M44 10 L44 54 M32 42 L44 54 L56 42" ${S}/>`,
  ui_fullscreen: `<path d="M8 22 L8 8 L22 8 M42 8 L56 8 L56 22 M56 42 L56 56 L42 56 M22 56 L8 56 L8 42" ${S}/><rect x="22" y="24" width="20" height="16" rx="2" ${F}/>`,
  ui_rise: `<path d="M32 46 L32 8 M16 24 L32 8 L48 24" ${S} stroke-width="7"/><path d="M12 57 L52 57" ${S}/>`,
  ui_sink: `<path d="M32 6 L32 44 M16 28 L32 44 L48 28" ${S} stroke-width="7"/><path d="M12 57 L52 57" ${S}/>`,
};

/** A generic stand-in for ids this file does not draw: a rounded tile with a mark that depends on the id. */
function generic(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = 14 + (h % 12);
  const b = 50 - ((h >> 4) % 12);
  return `<rect x="8" y="8" width="48" height="48" rx="10" ${S}/><path d="M${a} ${b} L32 ${a} L${b} ${b}" ${S}/>`;
}

/** The inner markup of the placeholder icon for an id. */
export function iconArt(id: string): string {
  return ART[id] ?? generic(id);
}

export function hasIconArt(id: string): boolean {
  return id in ART;
}

/** The destruction-bar skyline: low roofs with three taller towers at 21%, 57% and 100% of the width. */
export function skylinePath(width: number, height: number): string {
  const marks = [0.21, 0.57, 1];
  let d = `M0 ${height}`;
  const steps = 48;
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < steps; i++) {
    const x0 = (i / steps) * width;
    const x1 = ((i + 1) / steps) * width;
    const mid = (i + 0.5) / steps;
    const tower = marks.some((m) => Math.abs(mid - (m - 0.5 / steps)) < 0.6 / steps);
    const h = tower ? height * 0.96 : height * (0.22 + next() * 0.3 + mid * 0.18);
    d += ` L${x0.toFixed(1)} ${(height - h).toFixed(1)} L${x1.toFixed(1)} ${(height - h).toFixed(1)}`;
  }
  return `${d} L${width} ${height} Z`;
}
