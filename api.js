// Same-origin API client for the Worker. Kept free of DOM access so it can be tested.
const LOST_SESSION = new Set(['authentication_required', 'session_invalid']);
// Failures where a person-initiated second attempt can succeed even though the Worker sent
// x-should-retry: false (which only forbids automatic retries): the model produced unusable output or
// ran out of output room, a deadline passed, or the Gateway could not be reached. Smaller batches or
// another model usually help. The page never retries any of these on its own.
const RETRYABLE_CODES = new Set(['invalid_model_response', 'model_output_limit', 'request_timeout', 'upstream_timeout', 'network_error']);
const RESTART_KEY = 'bibliography-signin-restart';
const RESTART_WINDOW_MS = 60000;
export const LAUNCH_PATH = '/launch/bibliography';
const LAUNCH = /^\/launch\/[a-z0-9-]+$/;
const BROWSER_TIMEOUT_MS = 185000;

export function createApi({ fetchImpl = (...args) => fetch(...args), location, base, storage, now = Date.now, randomUUID = () => crypto.randomUUID() }) {
  let restarted = false;
  // A lost CAIL session needs a full-page navigation to the launch path so sign-in restarts. It happens
  // at most once per page, and only when sessionStorage can record it, so that no more than one
  // automatic restart happens per minute across reloads. Otherwise (storage unavailable, a restart in
  // the last minute, or the person cancelling the navigation) the error carries signInUrl and the page
  // shows a "Sign in with CUNY" link instead.
  function restartSignIn(url) {
    if (restarted) return false;
    try {
      const last = Number(storage.getItem(RESTART_KEY));
      if (last && now() - last < RESTART_WINDOW_MS) return false;
      const stamp = String(now());
      storage.setItem(RESTART_KEY, stamp);
      if (storage.getItem(RESTART_KEY) !== stamp) return false;
    } catch { return false; }
    restarted = true;
    location.assign(url);
    return true;
  }
  return async function api(path, body, signal) {
    const requestId = randomUUID();
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-cail-request-id': requestId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(BROWSER_TIMEOUT_MS)])
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const timedOut = error?.name === 'TimeoutError';
      throw Object.assign(new Error(timedOut ? 'The request took longer than 3 minutes. Completed entries are preserved. Try fewer entries per request or another model.' : 'The CAIL service could not be reached. Check your connection and try again.'), { code: timedOut ? 'request_timeout' : 'network_error', requestId, shouldRetry: true });
    }
    let result;
    try { result = await response.json(); } catch { throw Object.assign(new Error('The CAIL service returned an unreadable response.'), { status: response.status, requestId }); }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const envelope = result?.error;
      const error = new Error(typeof envelope?.message === 'string' && envelope.message ? envelope.message : 'The CAIL service is unavailable.');
      Object.assign(error, { status: response.status, code: envelope?.code, requestId: envelope?.request_id || requestId, shouldRetry: response.headers.get('x-should-retry') === 'true' || RETRYABLE_CODES.has(envelope?.code), ...(Number.isInteger(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) });
      if (response.status === 401 && LOST_SESSION.has(error.code)) {
        error.signInUrl = new URL(typeof envelope?.launch === 'string' && LAUNCH.test(envelope.launch) ? envelope.launch : LAUNCH_PATH, location.href).href;
        error.signInRestarted = restartSignIn(error.signInUrl);
      }
      throw error;
    }
    return result;
  };
}
