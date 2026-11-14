import { describe, expect, it } from 'vitest';
import { readPageParams } from '../src/app/params';

describe('page flags', () => {
  it('start a match in third person, as the owner chose, unless the address asks for first person', () => {
    expect(readPageParams('').thirdPerson).toBe(true);
    expect(readPageParams('?cam=tp').thirdPerson).toBe(true);
    expect(readPageParams('?cam=fp').thirdPerson).toBe(false);
  });
});
