import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Tool {
  buildManifest(dir: string): { text: string; counts: string; warnings: string[]; missing: string[]; errors: string[] };
  mergePartials(partials: Array<{ name: string; data: object }>): { manifest: Record<string, Record<string, unknown>>; warnings: string[] };
}

const toolPath = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'tools', 'build-manifest.mjs');

async function loadTool(): Promise<Tool> {
  return (await import(pathToFileURL(toolPath).href)) as Tool;
}

describe('assets:manifest', () => {
  it('merges partials, lists ui art, and leaves out entries whose files are missing', async () => {
    const tool = await loadTool();
    const dir = mkdtempSync(join(tmpdir(), 'mb-manifest-'));
    for (const sub of ['models', 'ui', 'audio/sfx', 'audio/music']) mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, 'models', 'a.glb'), 'x');
    writeFileSync(join(dir, 'ui', 'cmd_follow.svg'), '<svg/>');
    writeFileSync(join(dir, 'ui', 'portrait_army.png'), 'x');
    writeFileSync(join(dir, 'audio', 'sfx', 'boom_1.ogg'), 'x');
    writeFileSync(join(dir, 'audio', 'music', 'lobby.mp3'), 'x');
    writeFileSync(
      join(dir, 'manifest.a.json'),
      JSON.stringify({ models: { a: { file: 'models/a.glb', tris: 10 }, gone: { file: 'models/gone.glb' } }, sfx: { boom: { variants: ['audio/sfx/boom_1', 'audio/sfx/boom_2'], gain: 1 } } }),
    );
    writeFileSync(join(dir, 'manifest.b.json'), JSON.stringify({ models: { a: { tris: 12 } }, music: { lobby: { base: 'audio/music/lobby' }, lost: { base: 'audio/music/lost' } } }));

    const result = tool.buildManifest(dir);
    expect(result.errors).toEqual([]);
    const manifest = JSON.parse(result.text) as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(manifest)).toEqual(['models', 'sprites', 'textures', 'music', 'sfx', 'voice', 'ui']);
    expect(manifest.models.a).toEqual({ file: 'models/a.glb', tris: 12 });
    expect(manifest.models.gone).toBeUndefined();
    expect(manifest.sfx.boom.variants).toEqual(['audio/sfx/boom_1']);
    expect(Object.keys(manifest.music)).toEqual(['lobby']);
    expect(manifest.ui).toEqual({ cmd_follow: { file: 'ui/cmd_follow.svg' }, portrait_army: { file: 'ui/portrait_army.png' } });
    expect(result.warnings.some((w) => w.includes('models.a.tris'))).toBe(true);
    expect(result.missing.length).toBe(3);
  });

  it('reports a partial that is not valid JSON instead of writing a broken manifest', async () => {
    const tool = await loadTool();
    const dir = mkdtempSync(join(tmpdir(), 'mb-manifest-'));
    writeFileSync(join(dir, 'manifest.bad.json'), '{ nope');
    const result = tool.buildManifest(dir);
    expect(result.errors.length).toBe(1);
  });

  it('keeps the committed manifest in step with what the client expects', () => {
    const file = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'assets', 'manifest.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (const section of ['models', 'sprites', 'textures', 'music', 'sfx', 'voice', 'ui']) {
      expect(typeof manifest[section], section).toBe('object');
    }
  });
});
