/**
 * The functional placeholder HUD (DESIGN.md section 8): everything is a picture, a bar or a
 * button glyph; the only text is names. A UI specialist will restyle it, so it is one small
 * module that reads a FrameState and touches the page only when a value changes.
 *
 *   top       destruction bar (a skyline with three towers as the marks), sun-and-moon clock
 *             arc, the stage, and for humans the kaiju's health and nerve
 *   corners   own health / nerve / rage (kaiju) or unit health / charge (human), the squads,
 *             and the verbs with the glyph of the button that does each on the device in use
 *   center    crosshair
 */

import {
  barDisplayFraction,
  clamp01,
  COMBAT_RULES,
  kaijuKindDef,
  MATCH_RULES,
  type CommandId,
  type SnapKaiju,
  type SnapSquad,
  type SnapUnit,
} from '@mb/shared';
import { glyphFor, type Bindings, type ButtonAction, type InputDevice } from '../game/input/actions';
import type { FrameState, MatchSession } from '../net/matchSession';
import { skylinePath } from './iconArt';
import { el, glyph, icon, setGlyph } from './icons';

export interface HudView {
  /** What the crosshair is on. */
  aimOn: 'ground' | 'structure' | 'kaiju' | 'none';
  /** The target under the crosshair is within the weapon's range. */
  inRange: boolean;
  thirdPerson: boolean;
  /** Recoil pulse, 0..1. */
  recoil: number;
  /** The command the wheel is highlighting, when open. */
  wheelOpen: boolean;
  mapOpen: boolean;
  /** 'kaiju', 'human' or 'drone': which set of verbs to show. */
  mode: 'kaiju' | 'human' | 'drone';
  device: InputDevice;
  bindings: Bindings;
  /** The connection is being restored. */
  reconnecting: boolean;
}

interface Meter {
  root: HTMLElement;
  fill: HTMLElement;
  last: number;
}

function meter(iconId: string, className: string): Meter {
  const fill = el('div', 'meter-fill');
  const root = el('div', `meter ${className}`, [icon(iconId, 'meter-icon'), el('div', 'meter-track', [fill])]);
  return { root, fill, last: -1 };
}

function setMeter(m: Meter, value: number): void {
  const v = Math.round(clamp01(value) * 200) / 200;
  if (v === m.last) return;
  m.last = v;
  m.fill.style.width = `${(v * 100).toFixed(1)}%`;
}

interface Hint {
  root: HTMLElement;
  glyph: HTMLElement;
  cover: HTMLElement;
  action: ButtonAction;
}

function hint(iconId: string, action: ButtonAction): Hint {
  const g = glyph(null, 'hint-glyph');
  const cover = el('div', 'hint-cover');
  const root = el('div', 'hint', [el('div', 'hint-icon', [icon(iconId), cover]), g]);
  return { root, glyph: g, cover, action };
}

function setClass(node: HTMLElement, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

const SKY_W = 400;
const SKY_H = 44;

export class Hud {
  readonly root = el('div', 'hud');
  private readonly barFill: SVGRectElement;
  private readonly barRuin: SVGRectElement;
  private readonly marks: HTMLElement[] = [];
  private readonly clockSun: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly stagePips: HTMLElement[] = [];
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossHp: Meter;
  private readonly bossNerve: Meter;
  private readonly health: Meter;
  private readonly nerve: Meter;
  private readonly rage: Meter;
  private readonly charge: Meter;
  private readonly reload: Meter;
  private readonly squads: HTMLElement;
  private readonly squadRows: Array<{ root: HTMLElement; name: HTMLElement; pips: HTMLElement[] }> = [];
  private readonly crosshair: HTMLElement;
  private readonly kaijuHints: Record<string, Hint>;
  private readonly humanHints: Record<string, Hint>;
  private readonly droneHints: Record<string, Hint>;
  private readonly hintsKaiju: HTMLElement;
  private readonly hintsHuman: HTMLElement;
  private readonly hintsDrone: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusIcons: Record<string, HTMLElement>;
  private readonly statusUntil: Record<string, number> = {};
  private readonly orders: HTMLElement;
  private lastBar = -1;
  private lastClock = -1;
  private lastDevice = '';

  constructor() {
    // --- destruction bar ---
    const bar = el('div', 'bar');
    const path = skylinePath(SKY_W, SKY_H);
    bar.innerHTML =
      `<svg viewBox="0 0 ${SKY_W} ${SKY_H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<defs><clipPath id="bar-standing"><rect x="0" y="0" width="${SKY_W}" height="${SKY_H}"/></clipPath>` +
      `<clipPath id="bar-ruined"><rect x="0" y="0" width="0" height="${SKY_H}"/></clipPath></defs>` +
      `<path class="bar-city" d="${path}" clip-path="url(#bar-standing)"/>` +
      `<g clip-path="url(#bar-ruined)"><path class="bar-ruin" d="${path}" transform="translate(0 ${SKY_H * 0.62}) scale(1 0.38)"/></g>` +
      `<rect class="bar-edge" x="0" y="0" width="3" height="${SKY_H}"/></svg>`;
    this.barFill = bar.querySelector('#bar-standing rect') as SVGRectElement;
    this.barRuin = bar.querySelector('#bar-ruined rect') as SVGRectElement;
    for (const at of MATCH_RULES.bar.display) {
      const mark = el('div', 'bar-mark', [icon('k_molt')]);
      mark.style.left = `${at * 100}%`;
      this.marks.push(mark);
      bar.append(mark);
    }
    // The last mark is the kaiju's win, not a molt.
    this.marks[2].replaceChildren(icon('lb_kaiju'));

    // --- clock arc ---
    this.clockSun = el('div', 'clock-sun', [icon('st_sun')]);
    this.clock = el('div', 'clock', [el('div', 'clock-arc'), this.clockSun, el('div', 'clock-moon', [icon('st_moon')])]);

    // --- stage: three triangles of growing size ---
    const stage = el('div', 'stage');
    for (let i = 0; i < 3; i++) {
      const pip = el('div', `stage-pip stage-pip-${i + 1}`, [icon('lb_kaiju')]);
      this.stagePips.push(pip);
      stage.append(pip);
    }

    // --- the kaiju as the humans see it ---
    this.bossName = el('div', 'boss-name');
    this.bossHp = meter('st_health', 'boss-hp');
    this.bossNerve = meter('st_nerve', 'boss-nerve');
    this.boss = el('div', 'boss', [el('div', 'boss-head', [icon('lb_kaiju'), this.bossName]), this.bossHp.root, this.bossNerve.root]);

    // --- own meters ---
    this.health = meter('st_health', 'own-health');
    this.nerve = meter('st_nerve', 'own-nerve');
    this.rage = meter('st_rage', 'own-rage');
    this.charge = meter('st_charge', 'own-charge');
    this.reload = meter('cmd_fireatwill', 'own-reload');
    const meters = el('div', 'meters', [this.health.root, this.nerve.root, this.rage.root, this.charge.root, this.reload.root]);

    // --- squads ---
    this.squads = el('div', 'squads');
    this.orders = el('div', 'orders', [icon('cmd_follow'), icon('cmd_fireatwill')]);

    // --- verbs ---
    this.kaijuHints = {
      strike: hint('k_swipe', 'strike'),
      grab: hint('k_grab', 'grab'),
      block: hint('k_brace', 'block'),
      roar: hint('k_roar', 'roar'),
      special: hint('k_special', 'special'),
      molt: hint('k_molt', 'molt'),
      camera: hint('st_camera', 'camera'),
    };
    this.humanHints = {
      fire: hint('cmd_fireatwill', 'fire'),
      wheel: hint('cmd_holdcharge', 'wheel'),
      callIn: hint('st_callin', 'callIn'),
      map: hint('st_map', 'map'),
      camera: hint('st_camera', 'camera'),
    };
    this.droneHints = { camera: hint('st_camera', 'rise'), map: hint('st_map', 'map') };
    this.hintsKaiju = el('div', 'hints', Object.values(this.kaijuHints).map((h) => h.root));
    this.hintsHuman = el('div', 'hints', Object.values(this.humanHints).map((h) => h.root));
    this.hintsDrone = el('div', 'hints', Object.values(this.droneHints).map((h) => h.root));

    // --- crosshair and status pictures ---
    this.crosshair = el('div', 'crosshair', [el('div', 'crosshair-dot'), el('div', 'crosshair-ring')]);
    this.statusIcons = {
      crossfire: icon('st_crossfire', 'status-icon status-crossfire'),
      spotted: icon('st_spotted', 'status-icon status-spotted'),
      shaken: icon('st_shaken', 'status-icon status-shaken'),
      nerveBreak: icon('st_nerve', 'status-icon status-break'),
      volley: icon('st_charge', 'status-icon status-volley'),
      callin: icon('st_callin', 'status-icon status-callin'),
      offline: icon('ui_offline', 'status-icon status-offline'),
      eliminated: icon('ui_skull', 'status-icon status-eliminated'),
    };
    this.status = el('div', 'status', Object.values(this.statusIcons));

    this.root.append(
      el('div', 'hud-top', [this.clock, el('div', 'hud-top-mid', [bar, this.boss]), stage]),
      this.squads,
      el('div', 'hud-bottom-left', [meters, this.orders]),
      el('div', 'hud-bottom-right', [this.hintsKaiju, this.hintsHuman, this.hintsDrone]),
      this.crosshair,
      this.status,
    );
  }

  /** Lights a status picture for a moment (crossfire, a nerve break, a volley). */
  flash(name: 'crossfire' | 'nerveBreak' | 'volley' | 'callin', now: number, seconds = 1.6): void {
    this.statusUntil[name] = now + seconds;
  }

  private ensureSquads(count: number): void {
    while (this.squadRows.length < count) {
      const name = el('div', 'squad-name');
      const pips: HTMLElement[] = [];
      for (let i = 0; i < MATCH_RULES.unitsPerSquad; i++) pips.push(el('div', 'pip'));
      const root = el('div', 'squad', [name, el('div', 'squad-pips', pips)]);
      this.squadRows.push({ root, name, pips });
      this.squads.append(root);
    }
  }

  private updateSquads(session: MatchSession, squads: SnapSquad[], units: SnapUnit[]): void {
    this.ensureSquads(squads.length);
    squads.forEach((squad, i) => {
      const row = this.squadRows[i];
      const slot = session.config.players[squad.player];
      const label = slot ? (slot.bot ? slot.callsign : slot.name) : '';
      if (row.name.textContent !== label) row.name.textContent = label;
      setClass(row.root, 'own', squad.id === session.role.squadId);
      setClass(row.root, 'out', squad.eliminated);
      for (let s = 0; s < row.pips.length; s++) {
        const u = units[squad.id * MATCH_RULES.unitsPerSquad + s];
        const pip = row.pips[s];
        setClass(pip, 'dead', !u || !u.alive);
        setClass(pip, 'charging', !!u && u.alive && u.laser);
        setClass(pip, 'shaken', !!u && u.alive && u.shaken > 0);
        setClass(pip, 'driven', !!u && u.driven);
        const hp = u && u.alive ? Math.round(clamp01(u.hp / Math.max(1, u.maxHp)) * 10) / 10 : 0;
        const scale = `${0.55 + hp * 0.45}`;
        if (pip.style.getPropertyValue('--hp') !== scale) pip.style.setProperty('--hp', scale);
      }
    });
  }

  private updateHints(set: Record<string, Hint>, view: HudView): void {
    for (const h of Object.values(set)) setGlyph(h.glyph, glyphFor(view.bindings, h.action, view.device));
  }

  private cooldown(h: Hint, fraction: number, ready = true): void {
    const f = Math.round(clamp01(fraction) * 20) / 20;
    const value = `${(f * 100).toFixed(0)}%`;
    if (h.cover.style.height !== value) h.cover.style.height = value;
    setClass(h.root, 'unavailable', !ready);
  }

  update(frame: FrameState, session: MatchSession, view: HudView, now: number): void {
    const match = frame.match;

    // Destruction bar: the city left of the fill line lies in ruins.
    const f = Math.round(barDisplayFraction(match.barPoints, match.marks) * 1000) / 1000;
    if (f !== this.lastBar) {
      this.lastBar = f;
      this.barFill.setAttribute('x', `${(f * SKY_W).toFixed(1)}`);
      this.barRuin.setAttribute('width', `${(f * SKY_W).toFixed(1)}`);
      (this.root.querySelector('.bar-edge') as SVGRectElement | null)?.setAttribute('x', `${Math.max(0, f * SKY_W - 1.5).toFixed(1)}`);
    }
    this.marks.forEach((mark, i) => setClass(mark, 'reached', match.marksReached > i));
    const k0 = frame.kaijus[0];
    setClass(this.marks[0], 'ready', !!k0 && k0.moltAvailable && k0.stage === 1);
    setClass(this.marks[1], 'ready', !!k0 && k0.moltAvailable && k0.stage === 2);

    // Clock: the sun crosses the arc as the time runs out.
    const total = session.config.tuning.clock;
    const used = Math.round(clamp01(1 - match.clock / Math.max(1, total)) * 500) / 500;
    if (used !== this.lastClock) {
      this.lastClock = used;
      const a = Math.PI * (1 - used);
      this.clockSun.style.left = `${50 + Math.cos(a) * 46}%`;
      this.clockSun.style.top = `${100 - Math.sin(a) * 86}%`;
    }
    setClass(this.clock, 'late', match.clock < 60 && match.phase === 'playing');
    this.stagePips.forEach((pip, i) => setClass(pip, 'on', match.stage >= i + 1));

    // The kaiju, for everyone but the kaiju itself.
    const isKaiju = view.mode === 'kaiju';
    const boss: SnapKaiju | undefined = frame.kaijus[0];
    setClass(this.boss, 'hidden', isKaiju || !boss);
    if (boss && !isKaiju) {
      const def = kaijuKindDef(boss.kind);
      if (this.bossName.textContent !== def.name) this.bossName.textContent = def.name;
      setMeter(this.bossHp, boss.hp / Math.max(1, boss.maxHp));
      setMeter(this.bossNerve, boss.nerve / def.nerveCapacity);
      setClass(this.boss, 'staggered', boss.phase === 'stagger');
      setClass(this.boss, 'lost', !boss.known && view.mode === 'human');
    }

    // Own meters.
    const lk = frame.localKaiju;
    const lu = frame.localUnit;
    setClass(this.health.root, 'hidden', !lk && !lu);
    setClass(this.nerve.root, 'hidden', !lk && !lu);
    setClass(this.rage.root, 'hidden', !lk);
    setClass(this.charge.root, 'hidden', !lu);
    setClass(this.reload.root, 'hidden', !lu);
    if (lk) {
      const def = kaijuKindDef(lk.kind);
      setMeter(this.health, lk.hp / Math.max(1, lk.maxHp));
      setMeter(this.nerve, lk.nerve / def.nerveCapacity);
      setMeter(this.rage, lk.rage / COMBAT_RULES.rageMax);
      setClass(this.rage.root, 'full', lk.rage >= def.actions.special.rageCost);
      setClass(this.nerve.root, 'danger', lk.nerve > def.nerveCapacity * 0.7 || lk.phase === 'stagger');
    } else if (lu) {
      setMeter(this.health, lu.hp / Math.max(1, lu.maxHp));
      setMeter(this.nerve, lu.nerve / COMBAT_RULES.unitNerveCapacity);
      setClass(this.nerve.root, 'danger', lu.shaken > 0);
      // Charge: the average of the squad's sub-units that are charging.
      let sum = 0;
      let n = 0;
      for (const u of frame.units) {
        if (u.squad === session.role.squadId && u.alive && !u.driven) {
          sum += u.charge;
          n++;
        }
      }
      setMeter(this.charge, n > 0 ? sum / n : 0);
      setClass(this.charge.root, 'full', n > 0 && sum / n > 0.98);
      setMeter(this.reload, 1 - clamp01(lu.cooldown / 3.2));
    }

    // Squads and the standing orders of the local squad.
    setClass(this.squads, 'hidden', frame.squads.length === 0);
    this.updateSquads(session, frame.squads, frame.units);
    const own = frame.squads[session.role.squadId];
    setClass(this.orders, 'hidden', !own || view.mode !== 'human');
    if (own) {
      const want: CommandId[] = [own.moveOrder === 'moveTo' ? 'moveTo' : 'follow', own.fireMode === 'charge' ? 'holdCharge' : 'fireAtWill'];
      const ids = { follow: 'cmd_follow', moveTo: 'cmd_moveto', fireAtWill: 'cmd_fireatwill', holdCharge: 'cmd_holdcharge' };
      const key = want.join(',');
      if (this.orders.dataset.orders !== key) {
        this.orders.dataset.orders = key;
        this.orders.replaceChildren(icon(ids[want[0]]), icon(ids[want[1]]));
      }
    }

    // Verbs with their glyphs for the device in use.
    setClass(this.hintsKaiju, 'hidden', view.mode !== 'kaiju');
    setClass(this.hintsHuman, 'hidden', view.mode !== 'human');
    setClass(this.hintsDrone, 'hidden', view.mode !== 'drone');
    const deviceKey = `${view.device}:${view.mode}`;
    if (deviceKey !== this.lastDevice) {
      this.lastDevice = deviceKey;
      this.updateHints(this.kaijuHints, view);
      this.updateHints(this.humanHints, view);
      this.updateHints(this.droneHints, view);
    }
    if (lk) {
      const def = kaijuKindDef(lk.kind);
      this.cooldown(this.kaijuHints.roar, lk.cooldowns.roar / def.actions.roar.cooldown);
      this.cooldown(this.kaijuHints.grab, lk.cooldowns.eat > 0 && lk.held ? lk.cooldowns.eat / def.actions.eat.cooldown : 0);
      this.cooldown(this.kaijuHints.special, 1 - lk.rage / def.actions.special.rageCost, lk.rage >= def.actions.special.rageCost);
      setClass(this.kaijuHints.special.root, 'glow', lk.rage >= def.actions.special.rageCost);
      setClass(this.kaijuHints.molt.root, 'hidden', !lk.moltAvailable);
      setClass(this.kaijuHints.molt.root, 'glow', lk.moltAvailable);
      setClass(this.kaijuHints.block.root, 'active', lk.phase === 'brace');
    }
    if (lu && own) {
      const hasCallIn = own.level >= 3;
      setClass(this.humanHints.callIn.root, 'hidden', !hasCallIn);
      this.cooldown(this.humanHints.callIn, own.callInCooldowns[0] / 35);
      this.cooldown(this.humanHints.fire, lu.cooldown / 3.2);
    }

    // Crosshair.
    setClass(this.crosshair, 'hidden', view.mode === 'drone' || view.mapOpen || (!lk && !lu));
    setClass(this.crosshair, 'on-kaiju', view.aimOn === 'kaiju');
    setClass(this.crosshair, 'out-of-range', view.mode === 'human' && !view.inRange);
    setClass(this.crosshair, 'kick', view.recoil > 0.5);

    // Status pictures.
    const s = this.statusIcons;
    setClass(s.crossfire, 'on', (this.statusUntil.crossfire ?? 0) > now);
    setClass(s.nerveBreak, 'on', (this.statusUntil.nerveBreak ?? 0) > now);
    setClass(s.volley, 'on', (this.statusUntil.volley ?? 0) > now);
    setClass(s.callin, 'on', (this.statusUntil.callin ?? 0) > now);
    setClass(s.spotted, 'on', !!boss && boss.spotted && view.mode !== 'drone');
    setClass(s.shaken, 'on', !!lu && lu.shaken > 0);
    setClass(s.offline, 'on', view.reconnecting);
    setClass(s.eliminated, 'on', view.mode === 'drone' && session.role.kind === 'human');
  }
}
