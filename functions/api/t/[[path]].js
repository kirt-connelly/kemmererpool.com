/**
 * Tournaments.
 *
 *   POST   /api/t            create      X-League-Key      → { code, adminCode }
 *   GET    /api/t/{code}     view        public            → { data }
 *   PUT    /api/t/{code}     score       X-Admin-Code      → { ok }
 *   GET    /api/t            list all    X-League-Key      → { tournaments }
 *   DELETE /api/t/{code}     remove      X-League-Key      → { ok }
 *
 * Two levels of access on purpose. The league key belongs to officers and is
 * only needed to create a tournament or see the full list. Entering winners
 * needs just that tournament's own four-character admin code, so whoever is
 * running the bracket can be handed a link without being given the keys to
 * everything.
 *
 * Cloudflare setup:
 *   1. Workers & Pages → KV → create a namespace (e.g. kpl_tournaments)
 *   2. Pages → Settings → Functions → KV bindings:  TOURNAMENTS → that namespace
 *   3. Pages → Settings → Environment variables:    LEAGUE_KEY = officer passphrase
 * Without these every route answers 501 and the pages fall back to local use.
 */

const MAX_BYTES = 256 * 1024;
const INDEX_KEY = '__index';
const MAX_INDEX = 300;

// No 0 and no I, so nothing is misread off a printed sheet or over the phone.
// Dropping those two also makes O and 1 unambiguous.
const ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXYZ123456789';
const CODE_LEN = 4;
const VALID = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const notConfigured = () =>
  json({ ok: false, error: 'Tournament storage is not set up on this site yet.', code: 'not_configured' }, 501);

function entryFor(code, data, adminCode) {
  return {
    code,
    adminCode,                       // officers need this to open a scoring link

    name: String(data.name || '').slice(0, 120),
    kind: ['tournament','chip'].includes(data.kind) ? data.kind : 'bracket',
    format: data.format === 'single' ? 'single' : 'double',
    players: Object.values(data.bySeed || {}).filter(Boolean).length,
    progress: data.progress || null,
    champion: data.champion || null,
    updated: Date.now(),
  };
}

async function touchIndex(kv, code, data, adminCode) {
  const index = (await kv.get(INDEX_KEY, 'json')) || [];
  const prev = index.find(e => e.code === code);
  const admin = adminCode || (prev && prev.adminCode) || null;
  const next = [entryFor(code, data, admin), ...index.filter(e => e.code !== code)].slice(0, MAX_INDEX);
  await kv.put(INDEX_KEY, JSON.stringify(next));
}

export async function onRequest({ request, env, params }) {
  const kv = env.TOURNAMENTS;
  if (!kv) return notConfigured();

  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const code = (parts[0] || '').toUpperCase();
  const method = request.method;
  const leagueKey = request.headers.get('X-League-Key');
  const adminCode = (request.headers.get('X-Admin-Code') || '').toUpperCase();

  const readBody = async () => {
    const text = await request.text();
    if (text.length > MAX_BYTES) return { err: json({ ok: false, error: 'That tournament is too large.' }, 413) };
    let data;
    try { data = JSON.parse(text); } catch { return { err: json({ ok: false, error: 'Body was not JSON.' }, 400) }; }
    if (!data || !data.bySeed) return { err: json({ ok: false, error: 'That is not a tournament.' }, 400) };
    return { data };
  };

  // ── Create ──
  if (method === 'POST' && !code) {
    if (!env.LEAGUE_KEY) return notConfigured();
    if (leagueKey !== env.LEAGUE_KEY) {
      return json({ ok: false, error: 'That league key was not accepted.', code: 'bad_key' }, 403);
    }
    const { data, err } = await readBody();
    if (err) return err;

    let newCode = null;
    for (let i = 0; i < 40 && !newCode; i++) {          // retry on the rare collision
      const candidate = makeCode();
      if (!(await kv.get('t:' + candidate))) newCode = candidate;
    }
    if (!newCode) return json({ ok: false, error: 'Could not allocate a code, try again.' }, 503);

    const admin = makeCode();
    data.code = newCode;
    await kv.put('t:' + newCode, JSON.stringify({ data, adminCode: admin, created: Date.now(), updated: Date.now() }));
    await touchIndex(kv, newCode, data, admin);
    return json({ ok: true, code: newCode, adminCode: admin });
  }

  // ── List ──
  if (method === 'GET' && !code) {
    if (leagueKey !== env.LEAGUE_KEY) {
      return json({ ok: false, error: 'That league key was not accepted.', code: 'bad_key' }, 403);
    }
    return json({ ok: true, tournaments: (await kv.get(INDEX_KEY, 'json')) || [] });
  }

  if (!VALID.test(code)) return json({ ok: false, error: 'That is not a valid code.' }, 400);
  const record = await kv.get('t:' + code, 'json');

  // ── View (public) ──
  if (method === 'GET') {
    if (!record) return json({ ok: false, error: 'No tournament with that code.' }, 404);
    // Whether the caller may score it, without ever echoing the code back.
    const canScore = !!adminCode && adminCode === record.adminCode;
    return json({ ok: true, data: record.data, canScore, updated: record.updated });
  }

  // ── Score ──
  if (method === 'PUT') {
    if (!record) return json({ ok: false, error: 'No tournament with that code.' }, 404);
    const allowed = (adminCode && adminCode === record.adminCode)
                 || (leagueKey && leagueKey === env.LEAGUE_KEY);
    if (!allowed) return json({ ok: false, error: 'Wrong admin code.', code: 'bad_admin' }, 403);

    const { data, err } = await readBody();
    if (err) return err;
    data.code = code;
    await kv.put('t:' + code, JSON.stringify({
      data, adminCode: record.adminCode, created: record.created, updated: Date.now(),
    }));
    await touchIndex(kv, code, data, record.adminCode);
    return json({ ok: true });
  }

  // ── Delete ──
  if (method === 'DELETE') {
    if (leagueKey !== env.LEAGUE_KEY) {
      return json({ ok: false, error: 'That league key was not accepted.', code: 'bad_key' }, 403);
    }
    await kv.delete('t:' + code);
    const index = (await kv.get(INDEX_KEY, 'json')) || [];
    await kv.put(INDEX_KEY, JSON.stringify(index.filter(e => e.code !== code)));
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, PUT, DELETE' } });
}
