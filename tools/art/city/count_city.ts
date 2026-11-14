/**
 * Counts the structures of each archetype in Port Meridian, for tools/art/city/budgets.py.
 *
 *   npx tsx tools/art/city/count_city.ts
 *
 * Prints JSON { total, counts }. Copy the counts into budgets.py COUNTS when the city changes.
 */
import { generatePortMeridian } from '../../../shared/src/city/meridian/generate';

const city = generatePortMeridian();
const counts: Record<string, number> = {};
for (const s of city.structures) counts[s.archetype] = (counts[s.archetype] ?? 0) + 1;
console.log(JSON.stringify({ total: city.structures.length, counts }, null, 1));
