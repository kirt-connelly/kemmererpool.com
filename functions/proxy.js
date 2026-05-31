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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KemmererPool/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://lms.fargorate.com/',
      },
    });

    const body = await upstream.text();

    return new Response(body, {
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
