// What differs between the CUNY AI Lab edition (this file) and the open edition (open/edition.js):
// how requests reach a model, what the account panel shows, and a few strings. browser.js imports
// only this module for those; scripts/build-open.mjs swaps in open/edition.js at bundle time.
import { createApi } from './api.js';
import { modelMenus as catalogMenus } from './models.js';

export const copy = {
  otherModel: 'Other Gateway model ID',
  visionImage: 'The image will be sent to the selected CAIL vision model. This uses your shared quota.',
  visionPdf: 'OCR uses your shared CAIL quota. Leave it off for PDFs with selectable text.',
};

export const modelMenus = catalog => catalogMenus(catalog);

export function createEditionApi({ location, base, storage }) {
  return createApi({ location, base, storage });
}

// Called once at start-up; the CAIL edition has nothing to wire.
export function setup() {}

// The account panel: CUNY session and shared quota.
export async function refreshStatus(api, { $, text, signInLink }) {
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
    } catch (error) {
      // Say which failure it was, so a broken Gateway path is reportable rather than a vague notice.
      $('quota-content').replaceChildren(text('p', 'Usage estimate is temporarily unavailable. You can still try a conversion.', 'help'), ...(error.requestId ? [text('p', `${error.code ? `${error.code} · ` : ''}Support reference: ${error.requestId}`, 'help')] : []));
    }
  } catch (error) {
    $('session-status').replaceChildren(error.signInUrl ? signInLink(error.signInUrl) : text('span', error.status === 401 ? 'Sign in with CUNY to convert' : 'CUNY connection unavailable'));
    $('quota-content').replaceChildren(text('p', 'You can prepare and review your bibliography here. A connected CUNY session is required for AI conversion.', 'help'));
  } finally { $('refresh-quota').disabled = false; }
}
