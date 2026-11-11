/**
 * Home: pick a callsign, then create a room or join one by its four-letter code. A code in the
 * page address (#BCDF) is joined at once. Problems are shown as a picture, never a sentence.
 */

import { JOIN_ERROR, MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '@mb/shared';
import { ERROR_NO_ROOM, JoinFailure } from '../../net/connection';
import { cleanRoomCode, roomCodeFromHash, storeName } from '../../net/session';
import { el, icon } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

export class HomeScreen implements Screen {
  readonly id = 'home' as const;
  private root: HTMLElement | null = null;
  private busy = false;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  enter(ctx: AppContext): void {
    const name = el('input', 'field name-field');
    name.type = 'text';
    name.maxLength = MAX_NAME_LENGTH;
    name.value = ctx.name;
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'callsign');

    const code = el('input', 'field code-field');
    code.type = 'text';
    code.maxLength = ROOM_CODE_LENGTH;
    code.spellcheck = false;
    code.autocomplete = 'off';
    code.value = roomCodeFromHash(window.location.hash);
    code.setAttribute('aria-label', 'room code');

    const create = el('button', 'btn btn-big', [icon('lb_create')]);
    const join = el('button', 'btn btn-big', [icon('lb_join')]);
    const notice = el('div', 'notice');
    const showNotice = (iconId: string): void => {
      notice.replaceChildren(iconId ? icon(iconId) : '');
      notice.classList.remove('shake');
      // Restart the shake animation.
      void notice.offsetWidth;
      if (iconId) notice.classList.add('shake');
    };
    if (ctx.notice) showNotice(ctx.notice);
    ctx.notice = '';

    const commitName = (): string => {
      ctx.name = name.value.trim().slice(0, MAX_NAME_LENGTH);
      storeName(ctx.store, ctx.name, ctx.params.profile);
      return ctx.name;
    };
    const run = async (action: () => Promise<void>): Promise<void> => {
      if (this.busy) return;
      this.busy = true;
      ctx.audio.unlock();
      ctx.audio.play('ui_click');
      create.disabled = true;
      join.disabled = true;
      showNotice('');
      try {
        await action();
      } catch (err) {
        const failure = err instanceof JoinFailure ? err.code : 0;
        // No such room, a full room, an old page, or no server at all.
        showNotice(failure === ERROR_NO_ROOM ? 'lb_join' : failure === JOIN_ERROR.roomFull || failure === JOIN_ERROR.serverFull ? 'lb_human' : failure === JOIN_ERROR.version ? 'ui_warning' : 'ui_offline');
        ctx.audio.play('ui_error');
        if (failure === ERROR_NO_ROOM) code.classList.add('bad');
      } finally {
        this.busy = false;
        create.disabled = false;
        join.disabled = false;
      }
    };
    create.addEventListener('click', () => void run(() => ctx.client.create(commitName())));
    const tryJoin = (): void => {
      const c = cleanRoomCode(code.value);
      if (c.length !== ROOM_CODE_LENGTH) {
        code.classList.add('bad');
        return;
      }
      void run(() => ctx.client.join(c, commitName()));
    };
    join.addEventListener('click', tryJoin);
    code.addEventListener('input', () => {
      code.value = cleanRoomCode(code.value);
      code.classList.remove('bad');
    });
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryJoin();
    });
    name.addEventListener('change', commitName);

    this.root = el('div', 'screen home', [
      el('div', 'title', ['MONSTER BATTLE 9001']),
      el('div', 'panel', [
        el('div', 'row', [icon('lb_human', 'row-icon'), name]),
        el('div', 'row', [create]),
        el('div', 'row', [code, join]),
        notice,
      ]),
    ]);
    ctx.ui.append(this.root);

    // A code in the address joins at once; the autopilot also creates a room when there is none.
    const hashCode = roomCodeFromHash(window.location.hash);
    if (hashCode || ctx.params.autoplay) {
      this.autoTimer = setTimeout(() => {
        if (hashCode) tryJoin();
        else create.click();
      }, 250);
    }
  }

  exit(): void {
    if (this.autoTimer !== null) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.root?.remove();
    this.root = null;
  }
}
