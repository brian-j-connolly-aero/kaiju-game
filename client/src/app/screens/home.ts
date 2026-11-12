/**
 * Home: pick a callsign, then create a room or join one by its four-letter code. A code in the
 * page address (#BCDF) is joined at once, except for a first-time visitor with no callsign:
 * they see only the callsign field and the join button (Enter joins; an empty field joins as
 * "Player N"). Problems are shown as a picture, never a sentence.
 */

import { JOIN_ERROR, MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '@mb/shared';
import { ERROR_NO_ROOM, JoinFailure } from '../../net/connection';
import { cleanRoomCode, roomCodeFromHash, storeName } from '../../net/session';
import { el, icon } from '../../ui/icons';
import type { AppContext, Screen } from '../context';

/**
 * Whether the home screen asks for a callsign before joining the room in the address: only for
 * a person (not the autopilot) who arrives by an invite link and has never set a callsign.
 */
export function invitePrompt(hashCode: string, name: string, autoplay: boolean): boolean {
  return hashCode !== '' && name.trim() === '' && !autoplay;
}

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

    // Set once the rows exist: brings back the full panel after a failed invite join.
    let showAll = (): void => undefined;
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
      go.disabled = true;
      showNotice('');
      try {
        await action();
      } catch (err) {
        const failure = err instanceof JoinFailure ? err.code : 0;
        // No such room, a full room, an old page, or no server at all.
        showNotice(failure === ERROR_NO_ROOM ? 'lb_join' : failure === JOIN_ERROR.roomFull || failure === JOIN_ERROR.serverFull ? 'lb_human' : failure === JOIN_ERROR.version ? 'ui_outdated' : 'ui_offline');
        ctx.audio.play('ui_error');
        // Whatever went wrong, the whole panel is there again to try something else.
        showAll();
        if (failure === ERROR_NO_ROOM) {
          code.classList.add('bad');
          // Do not keep trying a room that is gone every time the page is opened.
          if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      } finally {
        this.busy = false;
        create.disabled = false;
        join.disabled = false;
        go.disabled = false;
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
    // The invite's join button, beside the callsign: only shown while asking for a callsign.
    const go = el('button', 'btn invite-join hidden', [icon('lb_join')]);
    go.addEventListener('click', tryJoin);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !go.classList.contains('hidden')) tryJoin();
    });
    const createRow = el('div', 'row', [create]);
    const codeRow = el('div', 'row', [code, join]);
    showAll = (): void => {
      go.classList.add('hidden');
      createRow.classList.remove('hidden');
      codeRow.classList.remove('hidden');
    };

    const gear = el('button', 'btn settings-open', [icon('ui_settings')]);
    gear.addEventListener('click', () => {
      ctx.audio.unlock();
      ctx.audio.play('ui_click');
      ctx.settings.setOpen(true);
    });

    this.root = el('div', 'screen home', [
      gear,
      el('div', 'title', ['MONSTER BATTLE 9001']),
      el('div', 'panel', [el('div', 'row', [icon('lb_human', 'row-icon'), name, go]), createRow, codeRow, notice]),
    ]);
    ctx.ui.append(this.root);

    // A code in the address joins at once; the autopilot also creates a room when there is none.
    // Someone arriving by invite with no callsign yet is asked for one first (`invitePrompt`).
    const hashCode = roomCodeFromHash(window.location.hash);
    if (invitePrompt(hashCode, ctx.name, ctx.params.autoplay)) {
      createRow.classList.add('hidden');
      codeRow.classList.add('hidden');
      go.classList.remove('hidden');
      name.focus();
    } else if (hashCode || ctx.params.autoplay) {
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
