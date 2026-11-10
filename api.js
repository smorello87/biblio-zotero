// Same-origin API client for the Worker. Kept free of DOM access so it can be tested.
const LOST_SESSION = new Set(['authentication_required', 'session_invalid']);
// Failures where a second attempt can succeed even though the Worker sent x-should-retry: false:
// the model produced unusable output, or ran out of output room (retry with fewer entries per request).
const RETRYABLE_CODES = new Set(['invalid_model_response', 'model_output_limit']);
const RESTART_KEY = 'bibliography-signin-restart';

export function createApi({ fetchImpl = (...args) => fetch(...args), location, base, storage, now = Date.now, randomUUID = () => crypto.randomUUID() }) {
  let restarted = false;
  // A lost CAIL session needs a full-page navigation to the tool's launch path so sign-in restarts.
  // Guarded once per page and once per minute across reloads so a failing sign-in cannot loop.
  function restartSignIn(launch) {
    if (restarted) return false;
    try { const last = Number(storage?.getItem(RESTART_KEY)); if (last && now() - last < 60000) return false; storage?.setItem(RESTART_KEY, String(now())); } catch { /* storage may be unavailable */ }
    restarted = true;
    location.assign(new URL(/^\/launch\/[a-z0-9-]+$/.test(launch) ? launch : './', location.href));
    return true;
  }
  return async function api(path, body, signal) {
    const requestId = randomUUID();
    const response = await fetchImpl(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-cail-request-id': requestId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(185000)])
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The CAIL service returned an unreadable response.'); }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const error = new Error(result.error?.message || 'The CAIL service is unavailable.');
      Object.assign(error, { status: response.status, code: result.error?.code, requestId: result.error?.request_id || requestId, shouldRetry: response.headers.get('x-should-retry') === 'true' || RETRYABLE_CODES.has(result.error?.code), ...(Number.isInteger(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) });
      if (response.status === 401 && LOST_SESSION.has(error.code)) error.signInRestarted = restartSignIn(result.error?.launch);
      throw error;
    }
    return result;
  };
}
