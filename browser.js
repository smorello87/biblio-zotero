import { splitEntries, expandRepeatedAuthors, reconcileItems, validateItem, toRIS } from './core.js';
import { readFile, textFromHTML } from './readers.js';

const $ = id => document.getElementById(id);
const state = { records: [], controller: null, busy: false, page: 0, model: '', enrich: false };
const apiBase = new URL('api/', location.href.endsWith('/') ? location.href : new URL('./', location.href));
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const display = (id, visible) => { $(id).hidden = !visible; };
function showError(error) {
  $('error-banner').textContent = error.message || 'The operation could not be completed.';
  if (error.requestId) $('error-banner').append(text('p', `Support reference: ${error.requestId}`, 'help'));
  display('error-banner', true);
}
function stage(number) {
  for (let n = 1; n <= 4; n++) display(`step-${n}`, n === number);
  document.querySelectorAll('.steps li').forEach((node, index) => {
    node.classList.toggle('complete', index + 1 < number);
    if (index + 1 === number) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  });
  $(`step-${number}`).querySelector('h2').focus();
}
function busy(value) {
  state.busy = value;
  document.querySelectorAll('.settings-panel input,.settings-panel select,#pdf-options input,#pdf-options select,.source-choices input,#file-field,#example-btn,#review-btn').forEach(node => { node.disabled = value; });
}
async function api(path, body, signal) {
  const requestId = crypto.randomUUID();
  const response = await fetch(new URL(path, apiBase), {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-cail-request-id': requestId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(185000)])
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The CAIL service returned an unreadable response.'); }
  if (!response.ok) {
    const error = new Error(result.error?.message || 'The CAIL service is unavailable.');
    Object.assign(error, { status: response.status, code: result.error?.code, requestId: result.error?.request_id || requestId, shouldRetry: response.headers.get('x-should-retry') === 'true' });
    throw error;
  }
  return result;
}

async function refreshQuota() {
  $('refresh-quota').disabled = true;
  try {
    const session = await api('session');
    if (!session.authenticated) throw new Error('Sign in with your CUNY account.');
    $('session-status').textContent = 'Signed in with CUNY';
    try {
      const quota = await api('quota');
      const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 1000000);
      const number = text('p', `${money(quota.estimated_remaining)} remaining`, 'quota-number');
      const meter = document.createElement('meter'); meter.min = 0; meter.max = 100; meter.value = quota.used_percent; meter.setAttribute('aria-label', `${quota.used_percent}% of shared quota used`);
      const window = `${Math.round(quota.window_seconds / 86400)}-day ${quota.window_technique} reporting window`;
      // Gateway calculated_at is an epoch-second timestamp, not a local decrement.
      const at = new Date(quota.calculated_at * 1000).toLocaleString();
      $('quota-content').replaceChildren(number, text('p', `${money(quota.estimated_used)} used of ${money(quota.limit)}`, 'help'), meter, text('p', `Estimated shared usage. ${window}. Calculated ${at}. Updates may be delayed.`, 'help'));
    } catch { $('quota-content').replaceChildren(text('p', 'Usage estimate is temporarily unavailable. You can still try a conversion.', 'help')); }
  } catch (error) {
    $('session-status').textContent = error.status === 401 ? 'Sign in with CUNY to convert' : 'CUNY connection unavailable';
    $('quota-content').replaceChildren(text('p', 'You can prepare and review your bibliography here. A connected CUNY session is required for AI conversion.', 'help'));
  } finally { $('refresh-quota').disabled = false; }
}
async function loadCatalog() {
  try {
    const catalog = await api('catalog');
    $('gateway-models').replaceChildren(...catalog.data.map(model => { const option = document.createElement('option'); option.value = model.id; option.label = model.name || model.id; return option; }));
  } catch { /* Discovery is informational; exact model IDs remain usable. */ }
}
function currentModel() {
  const model = $('model-select').value === 'other' ? $('custom-model-field').value.trim() : $('model-select').value;
  if (!model) throw new Error('Enter a model ID under Conversion settings.');
  return model;
}
function reviewedEntries() {
  return $('review-text').value.trim().split(/\n[\t ]*\n+/).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function updateCount() {
  const count = reviewedEntries().length;
  $('entry-count').textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
  $('convert-btn').disabled = count === 0;
}

async function prepare() {
  display('error-banner', false); busy(true); display('cancel-extract', true);
  state.controller = new AbortController();
  let partial = '';
  const source = document.querySelector('[name=input-source]:checked').value;
  try {
    let raw;
    if (source === 'text') raw = $('text-field').value;
    else if (source === 'url') {
      $('source-status').textContent = 'Importing bibliography…';
      const result = await api('source', { url: $('url-field').value.trim() }, state.controller.signal);
      raw = result.html ? textFromHTML(result.text) : result.text;
    } else {
      raw = await readFile($('file-field').files[0], {
        signal: state.controller.signal, vision: $('use-vision-ocr').checked,
        firstPage: Number($('page-from').value), lastPage: $('page-to').value ? Number($('page-to').value) : undefined,
        onProgress: value => { $('source-status').textContent = value; }, onText: value => { partial = value; },
        ocr: async image => (await api('ocr', { image, model: $('vision-model-select').value }, state.controller.signal)).content
      });
    }
    state.controller.signal.throwIfAborted();
    if (!raw?.trim()) throw new Error('Add some bibliography text before continuing.');
    $('review-text').value = splitEntries(raw).join('\n\n'); updateCount(); stage(2);
  } catch (error) {
    if (partial.trim()) { $('review-text').value = splitEntries(partial).join('\n\n'); updateCount(); stage(2); showError(new Error('Extraction stopped. Text from completed pages is preserved below. Check it before conversion.')); }
    else if (state.controller.signal.aborted) $('source-status').textContent = 'Extraction stopped.';
    else showError(error);
  } finally { busy(false); display('cancel-extract', false); state.controller = null; if (source === 'file' && $('use-vision-ocr').checked) void refreshQuota(); }
}

async function convert(retry = false) {
  display('error-banner', false);
  try {
    const batchSize = Number($('batch-size-field').value);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('Entries per request must be between 1 and 100.');
    state.model = currentModel(); state.enrich = $('enrich-isbn').checked;
    if (!retry) {
      let entries = reviewedEntries();
      if ($('test-mode').checked) entries = entries.slice(0, 10);
      if (!entries.length) throw new Error('Add at least one citation.');
      const expanded = expandRepeatedAuthors(entries);
      state.records = entries.map((source, i) => ({ id: crypto.randomUUID(), source, citation: expanded[i], status: 'pending', item: null }));
    }
    const pending = state.records.filter(record => record.status !== 'ready');
    if (!pending.length) return;
    state.controller = new AbortController(); busy(true); stage(3);
    for (let i = 0; i < pending.length; i += batchSize) {
      state.controller.signal.throwIfAborted();
      const batch = pending.slice(i, i + batchSize);
      $('progress-text').textContent = `Processing entries ${i + 1}–${Math.min(i + batchSize, pending.length)} of ${pending.length}…`;
      $('batch-status').textContent = `Request ${Math.floor(i / batchSize) + 1} of ${Math.ceil(pending.length / batchSize)}`;
      $('progress').value = i / pending.length * 100;
      const result = await api('parse', { model: state.model, entries: batch.map(record => ({ id: record.id, source: record.citation })) }, state.controller.signal);
      let parsed;
      try { parsed = JSON.parse(result.content); } catch { parsed = {}; }
      const reconciled = reconcileItems(parsed, batch);
      for (const record of reconciled) Object.assign(state.records.find(r => r.id === record.id), record, { model: state.model, requestId: result.request_id });
      if (state.enrich) {
        for (const record of reconciled.filter(r => r.status === 'ready' && r.item.type === 'book')) {
          state.controller.signal.throwIfAborted();
          $('progress-text').textContent = 'Looking for library metadata…';
          try {
            const result = await api('enrich', { title: record.item.title, author: record.item.author?.[0]?.family || record.item.author?.[0]?.literal || '', year: record.item.issued?.['date-parts']?.[0]?.[0] }, state.controller.signal);
            state.records.find(r => r.id === record.id).suggestion = result.suggestion;
          } catch (error) {
            if (state.controller.signal.aborted || [401, 403, 429].includes(error.status)) throw error;
            state.records.find(r => r.id === record.id).enrichmentError = 'Library lookup was unavailable. The parsed record is preserved.';
          }
        }
      }
    }
    $('progress').value = 100;
  } catch (error) {
    if (!state.controller?.signal.aborted) showError(error);
  } finally {
    busy(false); state.controller = null;
    if (state.records.length) { state.page = 0; renderResults(); stage(4); }
    void refreshQuota();
  }
}
function readyItems() { return state.records.filter(r => r.status === 'ready').map(r => r.item); }
function renderResults() {
  const ready = readyItems().length, unresolved = state.records.length - ready;
  $('results-summary').textContent = `${ready} ready to import · ${unresolved} unresolved · ${state.records.length} total`;
  $('download-btn').disabled = ready === 0;
  display('incomplete-notice', unresolved > 0); display('failed-btn', unresolved > 0);
  const records = state.records.slice(state.page * 20, (state.page + 1) * 20);
  $('records').replaceChildren(...records.map(record => {
    const detail = document.createElement('details'); detail.className = 'record';
    const summary = document.createElement('summary');
    summary.append(text('span', record.status === 'ready' ? 'Ready' : 'Needs review', `record-status ${record.status === 'ready' ? '' : 'failed'}`), text('span', record.item?.title || record.source));
    const body = document.createElement('div'); body.className = 'record-body';
    body.append(text('h4', 'Original citation'), text('blockquote', record.source));
    if (record.item) {
      const fields = document.createElement('dl'); fields.className = 'record-fields';
      for (const [key, value] of Object.entries(record.item).filter(([key]) => key !== 'id')) {
        let displayValue = value;
        if (['author', 'editor', 'translator'].includes(key)) displayValue = value.map(p => p.literal || [p.given, p.family].filter(Boolean).join(' ')).join('; ');
        else if (key === 'issued') displayValue = value['date-parts'].map(p => p.join('-')).join(' – ');
        fields.append(text('dt', key), text('dd', String(displayValue)));
      }
      body.append(fields);
    } else body.append(text('p', record.error || 'This entry has not been converted yet.', 'help'));
    if (record.enrichmentError) body.append(text('p', record.enrichmentError, 'help'));
    if (record.suggestion) {
      const suggestion = document.createElement('div'); suggestion.className = 'notice';
      suggestion.append(text('p', `Possible library match: ${record.suggestion.title}. Check the edition before accepting.`));
      const link = text('a', 'View catalog record'); link.href = record.suggestion.url; link.target = '_blank'; link.rel = 'noreferrer'; suggestion.append(link);
      const accept = text('button', 'Use missing metadata', 'text-button');
      accept.addEventListener('click', () => { for (const [key, value] of Object.entries(record.suggestion.fields)) if (!record.item[key]) record.item[key] = value; record.enrichment = record.suggestion; delete record.suggestion; renderResults(); });
      suggestion.append(document.createElement('br'), accept); body.append(suggestion);
    }
    const edit = document.createElement('details'); edit.append(text('summary', 'Edit CSL-JSON record'));
    const input = document.createElement('textarea'); input.value = JSON.stringify(record.item || { type: 'book', title: record.source }, null, 2); input.setAttribute('aria-label', `Edit record ${record.id}`);
    const feedback = text('p', '', 'help'); feedback.setAttribute('role', 'status');
    const save = text('button', 'Save record', 'button secondary');
    save.addEventListener('click', () => {
      try {
        const item = validateItem(JSON.parse(input.value));
        if (!item) throw new Error('Use a valid CSL type, title, names, and date-parts.');
        Object.assign(record, { item: { ...item, id: record.id }, status: 'ready', error: '', edited: true }); renderResults();
      } catch { feedback.textContent = 'The record is not valid CSL-JSON. Check its type, title, names, and dates.'; }
    });
    edit.append(input, feedback, save); body.append(edit); detail.append(summary, body); return detail;
  }));
  const pages = Math.ceil(state.records.length / 20);
  display('pagination', pages > 1); $('page-label').textContent = `Page ${state.page + 1} of ${pages}`;
  $('previous-page').disabled = state.page === 0; $('next-page').disabled = state.page + 1 >= pages;
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function fileName(extension) { return ($('output-filename').value.replace(/\.(json|ris|txt)$/i, '').replace(/[^\p{L}\p{N} _.-]/gu, '_').trim() || 'bibliography') + extension; }

document.querySelectorAll('[name=input-source]').forEach(radio => radio.addEventListener('change', () => { for (const source of ['text', 'file', 'url']) display(`${source}-input`, source === radio.value); }));
$('file-field').addEventListener('change', () => {
  const file = $('file-field').files[0];
  const isPdf = file?.name.toLowerCase().endsWith('.pdf');
  const isImage = /\.(?:png|jpe?g)$/i.test(file?.name || '');
  $('file-name').textContent = file?.name || '';
  display('pdf-options', isPdf || isImage);
  display('page-range', isPdf);
  display('page-help', isPdf);
  $('vision-help').textContent = isImage ? 'The image will be sent to the selected CAIL vision model. This uses your shared quota.' : 'OCR uses your shared CAIL quota. Leave it off for PDFs with selectable text.';
  $('use-vision-ocr').checked = isImage;
});
$('model-select').addEventListener('change', () => display('custom-model-input', $('model-select').value === 'other'));
$('example-btn').addEventListener('click', () => { $('text-field').value = 'Douglass, Frederick. 1845. Narrative of the Life of Frederick Douglass, an American Slave. Boston: Anti-Slavery Office.\n\nDu Bois, W. E. B. 1903. The Souls of Black Folk. Chicago: A. C. McClurg & Co.\n\nWoolf, Virginia. 1929. A Room of One’s Own. London: Hogarth Press.'; $('text-field').focus(); });
$('review-btn').addEventListener('click', prepare);
$('review-text').addEventListener('input', updateCount);
$('back-btn').addEventListener('click', () => stage(1));
$('convert-btn').addEventListener('click', () => convert());
$('retry-btn').addEventListener('click', () => convert(true));
for (const id of ['cancel-btn', 'cancel-extract']) $(id).addEventListener('click', () => state.controller?.abort());
$('new-btn').addEventListener('click', () => { if (!confirm('Start another bibliography? Download these results first; starting again clears them from this tab.')) return; state.records = []; display('error-banner', false); stage(1); });
$('download-btn').addEventListener('click', () => { const ris = $('output-format').value === 'ris'; download(ris ? toRIS(readyItems()) : JSON.stringify(readyItems(), null, 2), fileName(ris ? '.ris' : '.json'), ris ? 'application/x-research-info-systems' : 'application/json'); });
$('failed-btn').addEventListener('click', () => download(state.records.filter(r => r.status !== 'ready').map(r => r.source).join('\n\n'), fileName('-unresolved.txt'), 'text/plain'));
$('provenance-btn').addEventListener('click', () => download(JSON.stringify({ created_at: new Date().toISOString(), records: state.records }, null, 2), fileName('-review.json'), 'application/json'));
$('previous-page').addEventListener('click', () => { state.page--; renderResults(); });
$('next-page').addEventListener('click', () => { state.page++; renderResults(); });
$('refresh-quota').addEventListener('click', refreshQuota);
$('about-link').addEventListener('click', () => $('about-dialog').showModal());
$('close-about').addEventListener('click', () => $('about-dialog').close());
window.addEventListener('beforeunload', event => { if (state.busy || state.records.length) { event.preventDefault(); event.returnValue = ''; } });
void refreshQuota(); void loadCatalog();
