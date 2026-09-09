// Actual Gateway; only its external Registry, discovery, and provider are synthetic.
import { handleRequest } from 'gateway-source';
import { openRouterDiscoveryResponse, workersWeightMetadataResponse } from 'gateway-test-helpers';
const workers = ['@cf/openai/gpt-oss-120b', '@cf/google/gemma-4-26b-a4b-it'];
const vision = { id: 'qwen/qwen3-vl-235b-a22b-instruct', canonical_slug: 'qwen/qwen3-vl-235b-a22b-instruct', hugging_face_id: 'Qwen/Qwen3-VL-235B-A22B-Instruct', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, context_length: 262144, supported_parameters: ['response_format'], pricing: { prompt: '0.0000001', completion: '0.0000003' } };
let state = { mode: 'success', upstream: [], registry: [], apps: [] };
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/fixture') {
      if (request.method === 'POST') state = { mode: (await request.json()).mode, upstream: [], registry: [], apps: [] };
      return Response.json(state);
    }
    state.apps.push(request.headers.get('x-cail-app'));
    return handleRequest(request, {
      ...env,
      AI: { models: async () => workers.map(name => ({ name, properties: [{ property_id: 'context_window', value: '128000' }, { property_id: 'price', value: [{ unit: 'per M input tokens', price: 0.2, currency: 'USD' }, { unit: 'per M output tokens', price: 0.3, currency: 'USD' }] }] })) },
      MODEL_ACCESS_REGISTRY_GATEWAY: { resolveDoorwayAccess: async ({ subject }) => {
        state.registry.push(subject);
        return state.mode === 'registry-denied' ? { ok: false, code: 'not_admitted', retryable: false } : { ok: true, scope: 'models:invoke models:read quota:read', budgetScope: 'person' };
      } },
      CF_AIG_AUTH_TOKEN_STORE: { get: async () => 'synthetic-token-at-least-twenty-characters' },
    }, { fetch: (input, init) => external(new Request(input, init)), now: Date.now });
  },
};
async function external(request) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (request.url === 'https://models.dev/api.json') return workersWeightMetadataResponse(workers);
    if (url.hostname === 'gateway.ai.cloudflare.com' && url.pathname.includes('/openrouter/')) return openRouterDiscoveryResponse(request, [vision]);
    throw new Error(`Unexpected discovery: ${request.url}`);
  }
  if (!['gateway.ai.cloudflare.com', 'api.cloudflare.com'].includes(url.hostname) || !url.pathname.endsWith('/chat/completions')) throw new Error(`Unexpected provider: ${request.url}`);
  const body = await request.json();
  state.upstream.push({ url: request.url, body, metadata: JSON.parse(request.headers.get('cf-aig-metadata')), attempts: request.headers.get('cf-aig-max-attempts'), cache: request.headers.get('cf-aig-skip-cache'), payloadLog: request.headers.get('cf-aig-collect-log-payload') });
  if (state.mode === 'quota') return Response.json({ error: { code: 2041, message: 'Synthetic spend refusal' } }, { status: 429, headers: { 'cf-aig-step': 'spend-limit' } });
  const content = body.messages[0].role === 'system' ? JSON.stringify({ items: [{ source_id: 'entry-1', type: 'book', title: 'Synthetic Book' }] }) : 'Synthetic scanned citation.';
  return Response.json({ choices: [{ message: { content }, finish_reason: state.mode === 'truncated' ? 'length' : 'stop' }] }, { headers: { 'cf-aig-log-id': 'synthetic-accounting-log' } });
}
