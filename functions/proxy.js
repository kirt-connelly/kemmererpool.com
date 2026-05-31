/**
 * Cloudflare Pages Function — FargoRate reverse proxy
 * Route: /proxy?url=https://lms.fargorate.com/PublicReport/...
 */

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const target = url.searchParams.get('url');
  if (!target) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  if (!target.startsWith('https://lms.fargorate.com/PublicReport/')) {
    return new Response('Target URL not allowed', { status: 403 });
  }

  try {
    // Determine if this should be a POST request
    const method = request.method === 'POST' ? 'POST' : 'GET';
    const body = method === 'POST' ? await request.text() : undefined;

    const upstream = await fetch(target, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KemmererPool/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://lms.fargorate.com/',
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body } : {}),
    });

    const responseBody = await upstream.text();

    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 502 });
  }
}
