/**
 * Cloudflare Worker — FargoRate reverse proxy
 * Deployed automatically by Cloudflare Pages from this repo.
 *
 * Usage: fetch /proxy?url=https://lms.fargorate.com/PublicReport/...
 */

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ['https://kemmererpool.com', 'https://www.kemmererpool.com'];

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);

    // Only handle /proxy route
    if (url.pathname !== '/proxy') {
      return new Response('Not found', { status: 404 });
    }

    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    // Whitelist — only proxy FargoRate LMS public report endpoints
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
          'Cache-Control': 'public, max-age=300', // cache 5 min
        },
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  },
};
