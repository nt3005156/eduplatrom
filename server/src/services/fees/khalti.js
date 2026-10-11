// Khalti ePayment v2 client. This is the only module that talks to Khalti.
//
// Mode is set by env. With no secret key the client refuses every call with
// GatewayError('not_configured'), so online payment stays off until credentials are supplied.
//   KHALTI_SECRET_KEY   live or sandbox secret key (sent as "Authorization: Key <secret>")
//   KHALTI_ENV          'sandbox' (default) or 'production'
//   PUBLIC_BASE_URL     origin the browser returns to after paying (already used by the app)
//
// Endpoints (as documented, not yet checked against a live merchant account):
//   POST {base}/api/v2/epayment/initiate/   -> { pidx, payment_url, expires_at }
//   POST {base}/api/v2/epayment/lookup/     -> { pidx, total_amount, status, transaction_id, ... }
// Amounts are in paisa.
//
// Trust rule: a redirect or callback proves nothing by itself. Only the lookup result counts,
// and only status 'Completed' with a matching total_amount is treated as paid (see services/fees/online.js).

export class GatewayError extends Error {
  /** @param {string} code  'not_configured' | 'unavailable' | 'rejected' */
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const TIMEOUT_MS = 15000;
const BASES = { sandbox: 'https://dev.khalti.com', production: 'https://khalti.com' };

let override = null;

/** Tests inject a fake client here. Pass null to restore the real one. */
export function setKhaltiClientForTest(client) {
  override = client;
}

export function khaltiConfig() {
  const secret = process.env.KHALTI_SECRET_KEY || '';
  const env = process.env.KHALTI_ENV === 'production' ? 'production' : 'sandbox';
  return { secret, env, base: BASES[env], configured: Boolean(secret) };
}

async function post(path, body) {
  const cfg = khaltiConfig();
  if (!cfg.configured) throw new GatewayError('not_configured', 'Khalti is not configured');
  let res;
  try {
    res = await fetch(cfg.base + path, {
      method: 'POST',
      headers: { Authorization: `Key ${cfg.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GatewayError('unavailable', `Khalti unreachable: ${err.name || 'error'}`);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status >= 500 || res.status === 429) throw new GatewayError('unavailable', `Khalti HTTP ${res.status}`);
  if (!res.ok) throw new GatewayError('rejected', `Khalti HTTP ${res.status}: ${data?.detail || data?.error_key || 'rejected'}`);
  return data || {};
}

export const realKhaltiClient = {
  initiate: payload => post('/api/v2/epayment/initiate/', payload),
  lookup: pidx => post('/api/v2/epayment/lookup/', { pidx }),
};

export function khaltiClient() {
  return override || realKhaltiClient;
}
