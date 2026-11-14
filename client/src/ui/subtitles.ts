/** The subtitles line: the speaker's name and the words of the voice line being spoken. */

import { el } from './icons';

export class Subtitles {
  readonly root = el('div', 'subtitles hidden');
  private readonly speaker = el('span', 'subtitles-speaker');
  private readonly text = el('span', 'subtitles-text');
  private until = 0;

  constructor() {
    this.root.append(this.speaker, this.text);
  }

  /** Shows a line until `until` (local seconds) or until `clear` is called. */
  show(speaker: string, text: string, until: number): void {
    this.speaker.textContent = speaker;
    this.text.textContent = text;
    this.until = until;
    this.root.classList.remove('hidden');
  }

  clear(): void {
    this.until = 0;
    this.root.classList.add('hidden');
  }

  update(now: number): void {
    if (this.until > 0 && now > this.until) this.clear();
  }
}
