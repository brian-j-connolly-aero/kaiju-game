/**
 * The destruction bar's molt icons (round 4: the fill passed the molt icon a little before the
 * molt was offered). The simulation offers the molt on the tick the bar's points reach the mark
 * (shared/test/molt.test.ts); the HUD must draw the icon where the fill stands at that moment.
 */

import { describe, expect, it } from 'vitest';
import { barDisplayFraction, type PerStage } from '@mb/shared';
import { barMarkAt } from '../src/ui/hud';

describe('the destruction bar', () => {
  it('centers each mark icon where the fill stands when the bar reaches that mark', () => {
    const marks: PerStage<number> = [123.4, 456.7, 999.9];
    for (let i = 0; i < 3; i++) expect(barMarkAt(i)).toBeCloseTo(barDisplayFraction(marks[i], marks), 9);
  });
});
