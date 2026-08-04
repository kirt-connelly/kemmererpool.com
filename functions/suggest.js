/**
 * POST /suggest — receives the suggestion form and emails it via Resend.
 *
 * Required Cloudflare Pages environment variables:
 *   RESEND_API_KEY  — from resend.com/api-keys  (mark as "Encrypted")
 *   SUGGEST_TO      — optional, defaults to suggestions@kemmererpool.com
 *   SUGGEST_FROM    — optional, defaults to noreply@send.kemmererpool.com
 *                     (must be on a domain verified in Resend)
 */

const MAX = { name: 80, email: 120, message: 2000 };

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
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Could not read the form data.' }, 400);
  }

  // Honeypot: real people never see or fill this field. Bots usually do.
  // Respond as if it worked so the bot has no signal to retry differently.
  if (oneLine(body.website)) return json({ ok: true });

  const name = oneLine(body.name).slice(0, MAX.name);
  const email = oneLine(body.email).slice(0, MAX.email);
  const message = String(body.message ?? '').trim().slice(0, MAX.message);

  if (message.length < 5) {
    return json({ ok: false, error: 'Please enter a suggestion first.' }, 400);
  }
  if (email && !looksLikeEmail(email)) {
    return json({ ok: false, error: 'That email address does not look right.' }, 400);
  }
  if (!env.RESEND_API_KEY) {
    return json(
      { ok: false, error: 'The suggestion form is not configured yet. Please try again later.' },
      500
    );
  }

  const to = env.SUGGEST_TO || 'suggestions@kemmererpool.com';
  const from = env.SUGGEST_FROM || 'Kemmerer Pool League <noreply@send.kemmererpool.com>';
  const who = name || 'Anonymous';

  const payload = {
    from,
    to: [to],
    subject: `Suggestion from ${who}`,
    // Let the officers hit Reply and reach the submitter directly.
    ...(email ? { reply_to: [email] } : {}),
    text: `Suggestion from: ${who}\nEmail: ${email || '(not provided)'}\n\n${message}`,
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">` +
      `<p style="margin:0 0 4px"><strong>From:</strong> ${esc(who)}</p>` +
      `<p style="margin:0 0 16px"><strong>Email:</strong> ${email ? esc(email) : '<em>not provided</em>'}</p>` +
      `<div style="white-space:pre-wrap;padding:14px 16px;background:#f5f3ef;border-left:3px solid #1f6b48;border-radius:4px">${esc(message)}</div>` +
      `<p style="margin:18px 0 0;font-size:12px;color:#777">Sent from the suggestion form on kemmererpool.com</p>` +
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
    // Log the provider's reason for debugging, but don't leak it to the page.
    console.error('Resend error', res.status, await res.text().catch(() => ''));
    return json({ ok: false, error: 'The suggestion could not be sent. Please try again.' }, 502);
  }

  return json({ ok: true });
}
