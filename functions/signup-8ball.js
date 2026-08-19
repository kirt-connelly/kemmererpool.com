/**
 * POST /signup-8ball — 8-Ball Fall/Winter 2026-27 sign-ups, emailed via Resend.
 *
 * Uses the same mail setup as /suggest, so nothing new has to be configured:
 *   RESEND_API_KEY  — from resend.com/api-keys  (mark as "Encrypted")
 *   SIGNUP_TO       — optional, falls back to SUGGEST_TO, then officers@kemmererpool.com
 *   SIGNUP_FROM     — optional, falls back to SUGGEST_FROM, then noreply@send.kemmererpool.com
 *
 * Two shapes come in from league-signup.html:
 *   { kind: 'team',   team, bar, captain, captainPhone, players: [{name, phone}], notes, website }
 *   { kind: 'player', name, phone, website }
 */

const SEASON = '8-Ball Fall/Winter 2026-27';

const MAX = { short: 80, phone: 40, bar: 60, notes: 1200 };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Escape user text before it goes into the HTML email body.
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Strip CR/LF so a submitted value can't inject extra mail headers.
const oneLine = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Could not read the form.' }, 400);
  }

  // Honeypot: real people never see this field. Answer as if it worked.
  if (oneLine(body.website, 80)) return json({ ok: true });

  let subject = '';
  let rows = [];

  if (body.kind === 'team') {
    const team = oneLine(body.team, MAX.short);
    const bar = oneLine(body.bar, MAX.bar);
    const captain = oneLine(body.captain, MAX.short);
    const captainPhone = oneLine(body.captainPhone, MAX.phone);

    if (!team || !bar || !captain || !captainPhone) {
      return json({ ok: false, error: 'Team name, bar, captain and captain phone are all needed.' }, 400);
    }

    subject = `Team signup — ${team} (${bar})`;
    rows = [
      ['Season', SEASON],
      ['Team name', team],
      ['Bar', bar],
      ['Captain', captain],
      ['Captain phone', captainPhone],
    ];

    const players = Array.isArray(body.players) ? body.players.slice(0, 10) : [];
    let n = 0;
    for (const p of players) {
      const name = oneLine(p && p.name, MAX.short);
      if (!name) continue;
      const phone = oneLine(p && p.phone, MAX.phone);
      n++;
      rows.push([`Player ${n}`, phone ? `${name} — ${phone}` : name]);
    }
    if (!n) rows.push(['Players', 'none listed']);

    const notes = String(body.notes ?? '').trim().slice(0, MAX.notes);
    if (notes) rows.push(['Notes', notes]);

  } else if (body.kind === 'player') {
    const name = oneLine(body.name, MAX.short);
    const phone = oneLine(body.phone, MAX.phone);

    if (!name || !phone) {
      return json({ ok: false, error: 'We need a name and a phone number.' }, 400);
    }

    subject = `Player looking for a team — ${name}`;
    rows = [
      ['Season', SEASON],
      ['Name', name],
      ['Phone', phone],
      ['Note', 'Wants to play, does not have a team.'],
    ];

  } else {
    return json({ ok: false, error: 'Could not read the form.' }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'The signup form is not configured yet. Please try again later.' }, 500);
  }

  const to = env.SIGNUP_TO || env.SUGGEST_TO || 'officers@kemmererpool.com';
  const from = env.SIGNUP_FROM || env.SUGGEST_FROM || 'Kemmerer Pool League <noreply@send.kemmererpool.com>';

  const payload = {
    from,
    to: [to],
    subject: `8-Ball signup: ${subject}`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">` +
      `<p style="margin:0 0 14px;font-size:17px"><strong>${esc(subject)}</strong></p>` +
      `<table cellpadding="7" cellspacing="0" style="border-collapse:collapse">` +
      rows.map(([k, v]) =>
        `<tr>` +
        `<td style="border-bottom:1px solid #e3ded4;color:#6b6355;vertical-align:top;white-space:nowrap"><strong>${esc(k)}</strong></td>` +
        `<td style="border-bottom:1px solid #e3ded4;white-space:pre-wrap">${esc(v)}</td>` +
        `</tr>`).join('') +
      `</table>` +
      `<p style="margin:18px 0 0;font-size:12px;color:#777">Sent from the signup form on kemmererpool.com</p>` +
      `</div>`,
  };

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the mail service. Please try again.' }, 502);
  }

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text().catch(() => ''));
    return json({ ok: false, error: 'The signup could not be sent. Please try again.' }, 502);
  }

  return json({ ok: true });
}
