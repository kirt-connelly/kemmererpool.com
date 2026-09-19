/**
 * Tri-City tournament teams — /api/tricity
 *
 * Public (no password):
 *   GET  /api/tricity?e=kemmerer                  teams (no phone numbers), open/closed
 *   POST /api/tricity  { action:'signup', e, team, captainPhone, players:[{name,rating,division}], website }
 *   POST /api/tricity  { action:'win',    e, winner, loser, reporter, website }
 *
 * Officers (X-League-Pass header — same password as leagueadmin.html):
 *   GET    /api/tricity?e=kemmerer                teams WITH phones, plus reported wins
 *   PUT    /api/tricity  { e, id, ...fields }     fix a team (name, phone, players, paid)
 *   PUT    /api/tricity  { e, settings:{closed} } open or close signups
 *   DELETE /api/tricity  { e, kind:'team'|'win', id }
 *
 * Storage is the TOURNAMENTS KV namespace the other tools already use:
 *   tc:<event>:<id>   one team
 *   tw:<event>:<id>   one reported win
 *   tcfg:<event>      settings for the event (open / closed)
 *
 * Players are stored captain first. Rating is whatever the FargoRate lookup
 * found at signup (or what was typed by hand); officers can correct it.
 * The team handicap is never stored — it is always worked out from the
 * roster (sum of the top four ratings), so a fixed rating fixes the total.
 */

const EVENTS = {
  kemmerer:      { name: 'Red Short Memorial Tri City', where: 'Kemmerer',       maxTeams: null },
  evanston:      { name: 'Evanston Tri City',           where: 'Evanston',       maxTeams: null },
  bridgervalley: { name: 'Bridger Valley Tri City',     where: 'Bridger Valley', maxTeams: 32 },
};

const MAX_PLAYERS = 6;
const DEFAULT_PW = 'ktown';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clean = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const safeId = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);

function isOfficer(request, env) {
  const given = request.headers.get('X-League-Pass') || '';
  if (!given) return false;
  if (given === (env.LEAGUE_ADMIN_PW || DEFAULT_PW)) return true;
  return !!env.LEAGUE_KEY && given === env.LEAGUE_KEY;
}

function cleanPlayers(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const name = clean(p && p.name, 80);
    if (!name) continue;
    const rating = Math.max(0, Math.min(1000, parseInt(p.rating, 10) || 0));
    out.push({ name, rating, division: clean(p.division, 90) || null });
    if (out.length >= MAX_PLAYERS) break;
  }
  return out;
}

function teamRating(players) {
  return players.map((p) => p.rating || 0).sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0);
}

async function listPrefix(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const records = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
  return records.filter(Boolean);
}

async function settings(kv, e) {
  return (await kv.get(`tcfg:${e}`, 'json')) || { closed: false };
}

async function mail(env, subject, rows) {
  if (!env.RESEND_API_KEY) return;
  const to = env.SIGNUP_TO || env.SUGGEST_TO || 'officers@kemmererpool.com';
  const from = env.SIGNUP_FROM || env.SUGGEST_FROM || 'Kemmerer Pool League <noreply@send.kemmererpool.com>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to], subject,
        text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">` +
          `<p style="margin:0 0 14px;font-size:17px"><strong>${esc(subject)}</strong></p>` +
          `<table cellpadding="7" cellspacing="0" style="border-collapse:collapse">` +
          rows.map(([k, v]) =>
            `<tr><td style="border-bottom:1px solid #e3ded4;color:#6b6355;vertical-align:top;white-space:nowrap"><strong>${esc(k)}</strong></td>` +
            `<td style="border-bottom:1px solid #e3ded4;white-space:pre-wrap">${esc(v)}</td></tr>`).join('') +
          `</table>` +
          `<p style="margin:18px 0 0;font-size:12px;color:#777">Sent from the Tri City signup on kemmererpool.com</p></div>`,
      }),
    });
    if (!r.ok) console.error('Resend error', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('Mail failed', e && e.message);
  }
}

export async function onRequest({ request, env }) {
  const kv = env.TOURNAMENTS;
  if (!kv) return json({ ok: false, error: 'Storage is not set up on this site yet.', code: 'not_configured' }, 501);

  const url = new URL(request.url);
  let body = {};
  if (request.method !== 'GET') {
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Could not read the form.' }, 400); }
  }

  const e = String((request.method === 'GET' ? url.searchParams.get('e') : body.e) || '').toLowerCase();
  const ev = EVENTS[e];
  if (!ev) return json({ ok: false, error: 'Unknown tournament.' }, 400);

  const officer = isOfficer(request, env);

  // ── Read ──
  if (request.method === 'GET') {
    const cfg = await settings(kv, e);
    const teams = (await listPrefix(kv, `tc:${e}:`)).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!officer) {
      return json({
        ok: true, event: e, closed: !!cfg.closed,
        teams: teams.map((t) => ({ id: t.id, team: t.team, players: t.players.map((p) => ({ name: p.name, rating: p.rating })) })),
      });
    }
    const wins = (await listPrefix(kv, `tw:${e}:`)).sort((a, b) => (b.at || 0) - (a.at || 0));
    return json({ ok: true, event: e, closed: !!cfg.closed, officer: true, teams, wins });
  }

  // ── Public posts ──
  if (request.method === 'POST') {
    if (clean(body.website, 80)) return json({ ok: true, id: 'x', count: 0 });   // honeypot

    if (body.action === 'signup') {
      const cfg = await settings(kv, e);
      if (cfg.closed && !officer) return json({ ok: false, error: 'Signups for this tournament are closed.' }, 403);

      const team = clean(body.team, 60);
      const captainPhone = clean(body.captainPhone, 40);
      const players = cleanPlayers(body.players);
      if (!team) return json({ ok: false, error: 'The team needs a name.' }, 400);
      if (!players.length) return json({ ok: false, error: 'The team needs a captain.' }, 400);
      if (!captainPhone) return json({ ok: false, error: "We need the captain's phone number." }, 400);

      const existing = await listPrefix(kv, `tc:${e}:`);
      if (existing.some((t) => t.team.toLowerCase() === team.toLowerCase())) {
        return json({ ok: false, error: `There is already a team called ${team}. Pick another name, or talk to an officer.` }, 409);
      }
      if (ev.maxTeams && existing.length >= ev.maxTeams && !officer) {
        return json({ ok: false, error: `This tournament is full (${ev.maxTeams} teams).` }, 403);
      }

      const id = newId();
      const record = {
        id, event: e, team, captainPhone, players,
        paid: false, at: Date.now(),
        source: officer ? 'officer' : 'online',
      };
      await kv.put(`tc:${e}:${id}`, JSON.stringify(record));

      const rows = [
        ['Tournament', `${ev.name} (${ev.where})`],
        ['Team', team],
        ['Captain', players[0].name],
        ['Captain phone', captainPhone],
        ...players.map((p, i) => [`Player ${i + 1}`, `${p.name}${i === 0 ? ' (captain)' : ''} — ${p.rating || 'no rating'}${p.division ? '' : ' (entered by hand)'}`]),
        ['Team handicap (top 4)', String(teamRating(players))],
        ['Teams signed up', String(existing.length + 1)],
      ];
      await mail(env, `Tri City signup: ${team} — ${ev.where}`, rows);

      return json({ ok: true, id, count: existing.length + 1 });
    }

    if (body.action === 'win') {
      const winner = safeId(body.winner);
      const loser = safeId(body.loser);
      if (!winner || !loser || winner === loser) return json({ ok: false, error: 'Pick the team you beat.' }, 400);
      const [w, l] = await Promise.all([kv.get(`tc:${e}:${winner}`, 'json'), kv.get(`tc:${e}:${loser}`, 'json')]);
      if (!w || !l) return json({ ok: false, error: 'One of those teams is not on the list.' }, 404);

      // Two phones at the same table can both report the same match.
      const recent = (await listPrefix(kv, `tw:${e}:`))
        .find((r) => r.winner === winner && r.loser === loser && Date.now() - r.at < 30 * 60 * 1000);
      if (recent) return json({ ok: true, duplicate: true, at: recent.at, winnerName: w.team, loserName: l.team });

      const id = newId();
      const record = {
        id, event: e, winner, loser, winnerName: w.team, loserName: l.team,
        reporter: clean(body.reporter, 60), at: Date.now(),
      };
      await kv.put(`tw:${e}:${id}`, JSON.stringify(record));
      return json({ ok: true, id, at: record.at, winnerName: w.team, loserName: l.team });
    }

    return json({ ok: false, error: 'Could not read the form.' }, 400);
  }

  // ── Officers only from here ──
  if (!officer) return json({ ok: false, error: 'That password was not accepted.', code: 'bad_pass' }, 403);

  if (request.method === 'PUT') {
    if (body.settings) {
      const cfg = await settings(kv, e);
      if (typeof body.settings.closed === 'boolean') cfg.closed = body.settings.closed;
      await kv.put(`tcfg:${e}`, JSON.stringify(cfg));
      return json({ ok: true, closed: cfg.closed });
    }

    const id = safeId(body.id);
    const key = `tc:${e}:${id}`;
    const record = await kv.get(key, 'json');
    if (!record) return json({ ok: false, error: 'That team is gone already.' }, 404);

    if (typeof body.team === 'string') record.team = clean(body.team, 60);
    if (typeof body.captainPhone === 'string') record.captainPhone = clean(body.captainPhone, 40);
    if (typeof body.paid === 'boolean') record.paid = body.paid;
    if (Array.isArray(body.players)) record.players = cleanPlayers(body.players);
    if (!record.team || !record.players.length) return json({ ok: false, error: 'A team needs a name and a captain.' }, 400);

    record.editedAt = Date.now();
    await kv.put(key, JSON.stringify(record));
    return json({ ok: true, team: record });
  }

  if (request.method === 'DELETE') {
    const id = safeId(body.id);
    if (!id) return json({ ok: false, error: 'Which one?' }, 400);
    await kv.delete(`${body.kind === 'win' ? 'tw' : 'tc'}:${e}:${id}`);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, PUT, DELETE' } });
}
