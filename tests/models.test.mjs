import test from 'node:test';
import assert from 'node:assert/strict';
import { modelMenus, FALLBACK_PARSE, FALLBACK_VISION } from '../models.js';

const row = (id, order, capabilities, modality = 'text') => ({ id, order, capabilities, modality });
const mixed = { object: 'list', data: [
  row('whisper-large-v3-turbo', 1, ['speech-to-text'], 'text'),
  row('qwen3-vl-235b-a22b-instruct', 30, ['text-generation', 'vision', 'json']),
  row('melotts', 2, ['text-to-speech']),
  row('gpt-oss-120b', 10, ['text-generation', 'json']),
  row('flux-2-dev', 3, ['text-to-image'], 'image'),
  row('gemma-4-26b-a4b-it', 20, ['text-generation', 'vision'])
] };
test('parse menu is text-generation rows in catalog order; speech, TTS and image rows are excluded', () => {
  const { parse, vision } = modelMenus(mixed);
  assert.deepEqual(parse.map(model => model.id), ['gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
  assert.deepEqual(vision.map(model => model.id), ['gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
  assert.equal(parse.some(model => /whisper|melotts|flux/.test(model.id)), false);
});
test('built-in IDs are used when the catalog is unavailable or has no usable rows', () => {
  for (const catalog of [undefined, null, {}, { data: 'x' }, { data: [row('melotts', 1, ['text-to-speech'])] }]) {
    const menus = modelMenus(catalog);
    assert.deepEqual(menus.parse, FALLBACK_PARSE);
    assert.deepEqual(menus.vision, FALLBACK_VISION);
  }
  assert.deepEqual(FALLBACK_PARSE.map(model => model.id), ['gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
});
