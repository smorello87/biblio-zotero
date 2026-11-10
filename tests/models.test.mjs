import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelMenus, chooseModel, FALLBACK_PARSE, FALLBACK_VISION, MIN_CONTEXT_TOKENS } from '../models.js';

const row = (id, order, capabilities, extra = {}) => ({ id, order, capabilities, recommended: true, status: 'active', context_length: 128000, modality: 'text', ...extra });
const mixed = { object: 'list', data: [
  row('whisper-large-v3-turbo', 1, ['automatic-speech-recognition']),
  row('qwen3-vl-235b-a22b-instruct', 30, ['text-generation', 'vision', 'function-calling']),
  row('melotts', 2, ['text-to-speech']),
  row('gpt-oss-120b', 10, ['text-generation', 'reasoning', 'structured-output']),
  row('flux-1-schnell', 3, ['text-to-image'], { modality: 'image' }),
  row('gemma-4-26b-a4b-it', 20, ['text-generation', 'reasoning', 'vision']),
  row('llama-3.3-70b-instruct-fp8-fast', 5, ['text-generation'], { recommended: false }),
  row('llama-guard-3-8b', 6, ['text-generation']),
  row('gpt-oss-safeguard-20b', 7, ['text-generation', 'reasoning'], { name: 'GPT OSS Safeguard 20B' }),
  row('gemma-7b-it-lora', 8, ['text-generation'], { context_length: 3500 }),
  row('no-context', 9, ['text-generation'], { context_length: null }),
  row('retired', 11, ['text-generation'], { status: 'deprecated' }),
] };
test('menus offer only recommended rows with the capability, in catalog order; others are suggestions only', () => {
  const { parse, vision, suggestions } = modelMenus(mixed);
  assert.deepEqual(parse.map(model => model.id), ['gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
  assert.deepEqual(vision.map(model => model.id), ['gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
  assert.ok(suggestions.some(model => model.id === 'llama-3.3-70b-instruct-fp8-fast'));
  assert.equal(suggestions.some(model => /whisper|melotts|flux/.test(model.id)), false);
});
test('classifiers, small or unknown context windows, and inactive rows are never offered', () => {
  const ids = modelMenus(mixed).parse.map(model => model.id);
  for (const id of ['llama-guard-3-8b', 'gpt-oss-safeguard-20b', 'gemma-7b-it-lora', 'no-context', 'retired', 'llama-3.3-70b-instruct-fp8-fast']) assert.equal(ids.includes(id), false, id);
  const edge = modelMenus({ data: [row('just-enough', 1, ['text-generation'], { context_length: MIN_CONTEXT_TOKENS }), row('just-short', 2, ['text-generation'], { context_length: MIN_CONTEXT_TOKENS - 1 })] });
  assert.deepEqual(edge.parse.map(model => model.id), ['just-enough']);
});
test('built-in IDs are used when the catalog is unavailable or has no usable rows', () => {
  for (const catalog of [undefined, null, {}, { data: 'x' }, { data: [row('melotts', 1, ['text-to-speech'])] }, { data: [row('gpt-oss-120b', 1, ['text-generation'], { recommended: false })] }]) {
    const menus = modelMenus(catalog);
    assert.deepEqual(menus.parse, FALLBACK_PARSE);
    assert.deepEqual(menus.vision, FALLBACK_VISION);
  }
  assert.deepEqual(FALLBACK_PARSE.map(model => model.id), ['deepseek-v4.1-flash-1017', 'gpt-oss-120b', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
  assert.deepEqual(FALLBACK_VISION.map(model => model.id), ['deepseek-v4.1-flash-1017', 'gemma-4-26b-a4b-it', 'qwen3-vl-235b-a22b-instruct']);
});
test('the default is the first offered model; a chosen model is kept only while it is offered', () => {
  assert.equal(chooseModel('', ['deepseek-v4.1-flash-1017', 'gpt-oss-120b']), 'deepseek-v4.1-flash-1017');
  assert.equal(chooseModel('gemma-4-26b-a4b-it', ['gpt-oss-120b', 'gemma-4-26b-a4b-it']), 'gemma-4-26b-a4b-it');
  assert.equal(chooseModel('llama-guard-3-8b', ['glm-5.3', 'gpt-oss-120b', 'other']), 'glm-5.3');
  assert.equal(chooseModel('other', ['glm-5.3', 'other']), 'other');
  // The rule follows the catalog order, so a new top recommendation becomes the default with no code change.
  const reordered = modelMenus({ data: [{ id: 'newer-model', order: 0, recommended: true, status: 'active', capabilities: ['text-generation', 'vision'], context_length: 128000 }, { id: 'deepseek-v4.1-flash-1017', order: 1, recommended: true, status: 'active', capabilities: ['text-generation', 'vision', 'reasoning'], context_length: 1048576 }] });
  assert.equal(chooseModel('', reordered.parse.map(model => model.id)), 'newer-model');
});
test('the live catalog snapshot of 2026-11-09 yields the documented menus', async () => {
  const catalog = JSON.parse(await readFile(new URL('./fixtures/catalog-2026-11-09.json', import.meta.url), 'utf8'));
  const { parse, vision } = modelMenus(catalog);
  assert.deepEqual(parse.map(model => model.id), ['deepseek-v4.1-flash-1017', 'glm-5.3', 'qwen3.8-27b', 'gpt-oss-120b', 'gemma-4-26b-a4b-it', 'mistral-large-3-675b-instruct']);
  assert.deepEqual(vision.map(model => model.id), ['deepseek-v4.1-flash-1017', 'qwen3.8-27b', 'gemma-4-26b-a4b-it', 'mistral-large-3-675b-instruct']);
  // The default rule resolves to the fallback list's first entry, so the page agrees with or without the catalog.
  assert.equal(chooseModel('', parse.map(model => model.id)), FALLBACK_PARSE[0].id);
  assert.equal(chooseModel('', vision.map(model => model.id)), FALLBACK_VISION[0].id);
});
test('the built-in page options match the fallback lists, first option first', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const options = id => [...html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(options('model-select'), [...FALLBACK_PARSE.map(model => model.id), 'other']);
  assert.deepEqual(options('vision-model-select'), FALLBACK_VISION.map(model => model.id));
});
