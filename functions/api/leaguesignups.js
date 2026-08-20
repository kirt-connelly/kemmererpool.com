/**
 * League sign-ups — the officers' side.
 *
 *   GET    /api/leaguesignups     list everyone signed up
 *   POST   /api/leaguesignups     { id, status }   mark contacted / new
 *   DELETE /api/leaguesignups     { id }           remove an entry
 *
 * Every route needs the league password in an X-League-Pass header.
 *
 * Storage is the same KV namespace the tournament tools already use, under an
 * `ls:` prefix, so there is nothing new to create in Cloudflare:
 *   Pages → Settings → Functions → KV bindings:  TOURNAMENTS → kpl_tournaments
 *
 * The password is 'ktown' unless LEAGUE_ADMIN_PW is set in the Pages
 * environment variables — set it there if you ever want to change it without
 * touching the code. The league key used by admin.html works here too.
 */

const PREFIX = 'ls:';
const DEFAULT_PW = 'ktown';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function allowed(request, env) {
  const given = request.headers.get('X-League-Pass') || '';
  if (!given) return false;
  if (given === (env.LEAGUE_ADMIN_PW || DEFAULT_PW)) return true;
  return !!env.LEAGUE_KEY && given === env.LEAGUE_KEY;
}

export async function onRequest({ request, env }) {
  const kv = env.TOURNAMENTS;
  if (!kv) {
    return json({ ok: false, error: 'Sign-up storage is not set up on this site yet.', code: 'not_configured' }, 501);
  }
  if (!allowed(request, env)) {
    return json({ ok: false, error: 'That password was not accepted.', code: 'bad_pass' }, 403);
  }

  // ── List ──
  if (request.method === 'GET') {
    const listed = await kv.list({ prefix: PREFIX });
    const records = await Promise.all(listed.keys.map((k) => kv.get(k.name, 'json')));
    const signups = records
      .filter(Boolean)
      .sort((a, b) => (a.at || 0) - (b.at || 0));   // oldest first: the order they came in
    return json({ ok: true, signups });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Body was not JSON.' }, 400);
  }

  const id = String(body.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!id) return json({ ok: false, error: 'Which entry?' }, 400);
  const key = PREFIX + id;

  // ── Mark contacted / put back to new ──
  if (request.method === 'POST') {
    const record = await kv.get(key, 'json');
    if (!record) return json({ ok: false, error: 'That entry is gone already.' }, 404);
    record.status = body.status === 'contacted' ? 'contacted' : 'new';
    await kv.put(key, JSON.stringify(record));
    return json({ ok: true, status: record.status });
  }

  // ── Delete ──
  if (request.method === 'DELETE') {
    await kv.delete(key);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, DELETE' } });
}
