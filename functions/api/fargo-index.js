/**
 * GET /api/fargo-index — every player in every Jenkins division, with their
 * current Fargo rating, as one JSON list.
 *
 * The lookup used to build this in each visitor's browser: ninety-odd
 * FargoRate pages through /proxy, on every phone, the first time. Now the
 * server builds it once, keeps it in KV (TOURNAMENTS, under fx:), and every
 * page gets it in a single request.
 *
 *   fresh    (under 12 hours old)  returned straight away
 *   stale    (older)              returned straight away, rebuilt in the
 *                                 background for the next visitor
 *   missing  (first ever)         built in pieces; the reply says
 *                                 { building: true, done, total } and the
 *                                 page asks again until it's ready
 *
 * Built in pieces because a Cloudflare function on the free plan may only
 * make 50 outside requests at a time — each piece fetches at most 40
 * divisions and stores them one per key (fx:div:<id>).
 *
 * ?fresh=1 (officers, with X-League-Pass) rebuilds even if it's fresh — the
 * Refresh all ratings button on tricityadmin.html uses it.
 */

const LMS = 'https://lms.fargorate.com/PublicReport';
const FRESH_MS = 12 * 3600 * 1000;
const PIECE = 40;           // divisions fetched per request
const DEFAULT_PW = 'ktown';

/* Same seed list as signup.html. Discovery adds whatever is new on
   FargoRate's division dropdown; nothing is ever dropped. */
const DIVISIONS = [
  ['5ba7db58-8ec0-4eae-b39c-af1901216189', "2022 - SWC Fall 9ball/Scotch"],
  ['e9b068bc-155c-4b51-aea7-b37d01026668', "Afton 8 ball pool league 25/26"],
  ['fce8f4cc-63ae-4724-9170-af820130b97f', "Big Piney 8 Ball League"],
  ['5607ca18-56b5-45a1-a8a0-b203003df484', "Bridger Valley A League 2024-25"],
  ['35730190-912a-47aa-a1c4-b372017815d9', "Bridger Valley A League 2025-26"],
  ['eaeadccb-647a-49da-9c36-b3e50162b3ab', "Bridger Valley A League 2025-26 Lower Half"],
  ['22a07d3d-e9cd-4457-9ec0-b3e50160daff', "Bridger Valley A League 2025-26 Top Half"],
  ['0b5f5cbc-a524-4ece-bd10-b27400083c14', "Bridger Valley A League Lower Half 2024-25"],
  ['5d007644-c612-4632-87ee-b27400042ab3', "Bridger Valley A League Upper Half 2024-25"],
  ['da783e3c-94d6-4d4d-b208-b203003889bf', "Bridger Valley B League 2024-25"],
  ['6dbe498e-045e-4b3e-a94c-b372016edc8e', "Bridger Valley B League 2025-26"],
  ['3e7bb3b1-80d2-442b-adb2-af320009fdf4', "Bridger Valley BCA A League 22-23"],
  ['7a51089b-6af2-4e89-87cd-b0c2012ce367', "Bridger Valley BCA B"],
  ['8c29b5ce-edf4-4578-905d-af32000a4f88', "Bridger Valley BCA B League 22-23"],
  ['882da47b-9610-461e-b399-b0c2012571d0', "Bridger Valley Pool BCA A"],
  ['2dec11be-233e-4c58-b16e-b2f00141b077', "Bridger Valley Summer 10-Ball/Scotch Doubles '25"],
  ['f4399f90-0c64-49f1-8b0a-b46a014a6186', "Bridger Valley Summer 10-Ball/Scotch Doubles '26"],
  ['329db8c3-9bf5-4643-a455-b19b010bc52d', "Dubois 8 Ball Fall 23/24"],
  ['66e9fb00-9f1b-4816-aaab-af5f015e4aea', "Dubois 8 Ball League"],
  ['19e3dc05-7d67-4c77-8f36-b3b600f992cf', "Dubois League 25/26"],
  ['fd79c308-3731-46f0-a1d2-b2330115ed2f', "Dubois Pool League 24/25"],
  ['118b441e-0fa9-406c-817f-af3c0115e523', "Evanston 8 Ball League 22-23"],
  ['cdd09564-d2f2-43a8-abfc-b36701493a0c', "Evanston 8 Ball Pool League 2025-26"],
  ['953530da-effe-43e9-9ddc-b204010e9a9c', "Evanston 8-Ball Pool League 2024-25"],
  ['23b1bb39-45eb-4bbe-beb2-b28e00521424', "Evanston 9-Ball/Scotch Doubles '25"],
  ['803d4aa8-ab58-4b6c-9917-b0ba01344b68', "Evanston BCA 8 Ball 23/24"],
  ['18e0f3a3-3c8a-4d3c-a769-b42f00b35c96', "Evanston Spring 10-Ball '26"],
  ['68fa05b8-6472-4fc6-a3b1-b18c016918d3', "Evanston Summer 10 ball"],
  ['a35ec1fe-c9b0-4d23-b1f0-b2ff01142d28', "Evanston Summer 10-Ball '25"],
  ['e5c82d1d-7cfe-4c53-bd72-b04200f369f9', "Evanston Summer 9 - Ball 2023"],
  ['5b32c11b-e339-4917-ac41-b0c101074729', "Fremont Lander BCA 8 Ball 23/24"],
  ['6ef83b70-765f-4c2c-baf6-b1a1010b3920', "Kemmerer 10 Ball"],
  ['530cf2f7-a43e-4e1b-8847-b0b501645187', "Kemmerer 8 Ball League 23/24"],
  ['1dc8b2aa-62eb-41a6-a8f6-b379014efe83', "Kemmerer 8 Ball League 25-26"],
  ['d927b7ed-2289-4722-9d27-af3300cadc72', "Kemmerer BCA Pool League 22-23"],
  ['f3f4bfef-cbbf-4337-bf8d-b208018232cc', "Kemmerer Pool League 24/25"],
  ['c97cf1bf-ff08-44a0-b916-b4520124b3e6', "Kemmerer Summer 10 Ball 2026"],
  ['1c76dc27-bc1c-4aa6-81aa-af310166fb1d', "Lander 8 Ball 22-23"],
  ['f73e5d93-9d85-4f25-ad40-b48501232c67', "Lander Summer 10 Ball 2026"],
  ['915b2c1d-72c3-4365-9130-b30e01504c6c', "Lander Summer 9 Ball"],
  ['77b7699b-2970-4094-8012-b370010637cd', "Lander Valley 8 Ball Pool 25/26"],
  ['9ee14fda-3d19-4f5b-b055-b24301068c84', "Lander Valley Pool BCA"],
  ['f8f186dc-e9cb-4c93-b68e-af34012428ab', "Pinedale 8-Ball League"],
  ['b9181031-be06-4a48-a52c-b0ca01287793', "Pinedale Pool League 23/24"],
  ['c19a9eb2-1a45-478d-892e-af31017213e1', "Riverton A League 22-23"],
  ['d389e595-5592-4f1e-9345-b202016be387', "Riverton A League Pool 2024-25"],
  ['31d8e6e8-aceb-4faa-95c4-b367015bc0a7', "Riverton A League Pool 2025-26"],
  ['6b247e98-1e1b-4939-9126-b37201326a31', "Riverton A League Pool 2025-26 New"],
  ['fff50122-582c-4139-8503-b0c201066793', "Riverton A Pool 23/24"],
  ['da19a3fb-1187-43c6-8ab3-af31017938ff', "Riverton B League 22-23"],
  ['a00acf3e-5c8b-47d7-8ee2-b2020175c7e0', "Riverton B League Pool 2024-25"],
  ['7948d9f2-40c7-476b-a624-b367015e539e', "Riverton B League Pool 2025-26"],
  ['8d5b74fb-0d6a-4822-bda2-b37201393295', "Riverton B League Pool 2025-26 New"],
  ['26046d5b-f0df-41e9-8368-b0c2010bf034', "Riverton B Pool 23/24"],
  ['abda02c6-3625-447c-ac64-b1c301543be7', "Riverton Summer 9-Ball"],
  ['5f253980-93db-4984-8cc9-b46401249525', "Riverton Summer 9-Ball and Scotch Doubles 2026"],
  ['1445f8f2-0081-48d8-9343-b2ea015da627', "Riverton Summer 9-Ball Scotch Doubles '25"],
  ['8d718a74-79e9-413c-9493-b3f4011cf98f', "Spring Training SWC A League 26"],
  ['d31c40a1-86ac-49ce-b7ba-b19b0121db44', "Star Valley Pool League 23/24"],
  ['e1d8db5a-ebcf-443c-8189-b23401400f34', "Star Valley Pool League 24-25"],
  ['b2f40913-6cee-4653-a691-b36e010710e1', "Sublette County 8 Ball Pool Leagues 25/26"],
  ['cd0fe1ec-6faa-4c20-b56c-b3060002b615', "Sublette County 9-Ball Summer League 25"],
  ['b84871df-aaef-42d5-adce-b46a0118883c', "Sublette County 9/10 Scotch Doubles League 26"],
  ['be575a0e-cd22-48b9-a1ee-b233017afc43', "Sublette County Pool League 24/25"],
  ['e32cc8d3-222d-4c0e-b065-b38c016a32ab', "Sublette County Top Gun Pool League 25/26"],
  ['111465aa-9e4f-4ade-9994-b3600166c88f', "SWC 10-Ball Capped League 2025-26"],
  ['f0204cf4-b134-4828-b4c2-b1f90109a91a', "SWC 10-Ball Fall Capped League 2024-25"],
  ['0cb6ca13-5a6b-4122-b417-b1f80131c104', "SWC 10-Ball Fall No Cap League 2024-25"],
  ['19ce8161-03b2-4f79-84cf-b3600168abe6', "SWC 10-Ball No Cap League 2025-26"],
  ['04c48062-4bba-4bcf-85f6-b07b00edd1a0', "SWC A League 8 Ball 23/24"],
  ['e256cc16-39fe-41f0-b6a5-b1ed015bd6c6', "SWC A League 8-Ball 2024-25"],
  ['8b9cf341-bc42-40ad-a7ce-b35e01346dee', "SWC A League 8-Ball 2025-26"],
  ['97c2318f-2cef-4f52-98cf-b08301472a86', "SWC B-10 League 23/24"],
  ['e29f27c4-b1b2-42aa-a39b-b1ee0030b80f', "SWC B-10 League 8-Ball 2024-25"],
  ['54ea8a12-5fc9-433e-8712-b3600163ce04', "SWC B-10 League 8-Ball 2025-26"],
  ['be184b61-845f-49eb-8ef0-b0830146f63d', "SWC B-11 League 23/24"],
  ['82895753-97f8-4009-b5b9-b1ee002c3a87', "SWC B-12 League 8-Ball 2024-25"],
  ['7b490715-8070-49f0-9dfd-b360015c9a6f', "SWC B-12 League 8-Ball 2025-26"],
  ['95edb654-9adb-46cf-a57d-af15011e5048', "SWC Open A 22-23"],
  ['9debe186-d87c-46a1-b4b0-af15015c3448', "SWC Open B-10 22-23"],
  ['1dfd15c8-fb71-4166-a5fb-af15015be1a9', "SWC Open B-11 22-23"],
  ['f7f069c9-42e9-4d99-852c-b2f801542097', "SWC Summer 10 Ball Capped '25"],
  ['b4319194-1eac-4424-8309-b2ea013bcac4', "SWC Summer 10 Ball Capped '25"],
  ['72d04985-01b2-40fc-ab95-b2ea013c03ae', "SWC Summer 10 Ball No Cap '25"],
  ['db453d72-9000-49f5-8943-b2ff013a8563', "SWC SUMMER 10 BALL NO CAP 25'"],
  ['5ef72512-d6ea-42b5-9476-b305015b5445', "SWC Summer Singles Shoot-Out 25"],
  ['ac0a71bc-e011-4c98-a3e7-b463010d8b26', "SWC Sweetwater County 10-Ball Capped Summer 2026"],
  ['da5a4c20-a467-4204-8e16-b463015de862', "SWC Sweetwater County 10-Ball No Cap Summer 2026"],
  ['de48d2ac-7293-403f-b586-b19901018a69', "Sweetwater 10 Ball Fall 23/24"],
  ['f47614c7-0696-4931-b49c-b190011ef4b0', "Sweetwater Summer 10 Ball Capped 24"],
  ['42051f52-a7ed-47c2-b146-b1900119caeb', "Sweetwater Summer 10 Ball No Cap 24"],
  ['931f831a-dcae-4f79-8468-b03c01293fb0', "Sweetwater Summer 23 10 Ball League"],
];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

async function fargo(path) {
  const r = await fetch(`${LMS}/${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; KemmererPool/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://lms.fargorate.com/',
    },
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
}

const decode = (s) => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim();

/* The same rules as parsePlayerList in the pages: first table, headers
   from <th> (or the first row), find the Name and Rating columns. */
function parsePlayerList(html, label) {
  const t = html.match(/<table[\s\S]*?<\/table>/i);
  if (!t) return [];
  const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  const cells = (row, tag) => [...row.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((m) => decode(m[1]));

  let headers = [...t[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => decode(m[1]));
  if (!headers.length && rows[0]) headers = cells(rows[0], 'td');
  const ratingIdx = headers.findIndex((h) => /rating|fargo/i.test(h));
  const nameIdx = headers.findIndex((h) => /name/i.test(h));

  const out = [];
  rows.slice(1).forEach((row) => {
    const c = cells(row, 'td');
    if (!c.length) return;
    const raw = c[nameIdx >= 0 ? nameIdx : 1] || c[0];
    const rating = parseInt(c[ratingIdx >= 0 ? ratingIdx : c.length - 1], 10);
    if (!raw || !rating) return;
    const name = /,\s/.test(raw) ? raw.replace(/^([^,]+),\s*(.+)$/, '$2 $1') : raw;
    out.push({ name, rating, division: label });
  });
  return out;
}

async function divisionList(kv) {
  const saved = (await kv.get('fx:divs', 'json')) || { at: 0, list: [] };
  const merged = new Map(DIVISIONS.map((d) => [d[0], d[1]]));
  saved.list.forEach(([id, name]) => merged.set(id, name));
  if (Date.now() - saved.at < FRESH_MS) return [...merged.entries()];

  /* Any division page carries the dropdown of everything Jenkins runs.
     One try only — this counts against the 50-request budget. */
  try {
    const html = await fargo(`LeagueReports/${DIVISIONS.find((d) => /^Kemmerer 8 Ball League 25/.test(d[1]))[0]}`);
    const sel = html.match(/<select[^>]*id="division-list"[^>]*>([\s\S]*?)<\/select>/i);
    if (sel) {
      for (const m of sel[1].matchAll(/<option[^>]*value="([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/option>/gi)) {
        merged.set(m[1], decode(m[2]));
      }
    }
  } catch (e) { /* the saved list will do */ }
  const list = [...merged.entries()];
  await kv.put('fx:divs', JSON.stringify({ at: Date.now(), list }));
  return list;
}

/* Fetch up to PIECE divisions that are older than `since`, store each,
   and when none are left, put the whole index together. */
async function buildPiece(kv, since) {
  const divisions = await divisionList(kv);
  const stamps = await Promise.all(divisions.map(([id]) => kv.get(`fx:div:${id}`, 'json')));
  const todo = divisions.filter((d, i) => !stamps[i] || stamps[i].at < since).slice(0, PIECE);

  for (let i = 0; i < todo.length; i += 10) {
    await Promise.all(todo.slice(i, i + 10).map(async ([id, label]) => {
      let players = [], failed = false;
      try { players = parsePlayerList(await fargo(`GeneratePlayerListReport/${id}`), label); }
      catch (e) { failed = true; }
      await kv.put(`fx:div:${id}`, JSON.stringify({ at: Date.now(), failed, players }));
    }));
  }

  const left = divisions.length - (divisions.filter((d, i) => stamps[i] && stamps[i].at >= since).length + todo.length);
  if (left > 0) return { done: divisions.length - left, total: divisions.length };

  const parts = await Promise.all(divisions.map(([id]) => kv.get(`fx:div:${id}`, 'json')));
  const byKey = {};
  let failed = 0;
  parts.forEach((p) => {
    if (!p) return;
    if (p.failed) failed++;
    p.players.forEach((pl) => {
      const k = pl.name.toLowerCase();
      if (!byKey[k] || pl.rating > byKey[k].rating) byKey[k] = pl;
    });
  });
  const players = Object.values(byKey).sort((a, b) => a.name.localeCompare(b.name));
  const index = { at: Date.now(), divisions: divisions.length, failed, players };
  if (players.length) await kv.put('fx:index', JSON.stringify(index));
  return { done: divisions.length, total: divisions.length, index };
}

/* Only one build at a time. KV isn't a real lock, but it's close enough
   to stop a crowd of phones all fetching the same ninety pages. */
async function withLock(kv, fn) {
  if (await kv.get('fx:lock')) return null;
  await kv.put('fx:lock', '1', { expirationTtl: 60 });
  try { return await fn(); }
  finally { await kv.delete('fx:lock'); }
}

export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const kv = env.TOURNAMENTS;
  if (!kv) return json({ ok: false, error: 'Storage is not set up on this site yet.' }, 501);

  const url = new URL(request.url);
  const given = request.headers.get('X-League-Pass') || '';
  const officer = !!given && (given === (env.LEAGUE_ADMIN_PW || DEFAULT_PW) || (!!env.LEAGUE_KEY && given === env.LEAGUE_KEY));
  const force = officer && url.searchParams.get('fresh') === '1';

  const index = await kv.get('fx:index', 'json');
  const age = index ? Date.now() - index.at : Infinity;

  /* Fresh, or stale but usable: answer now. */
  if (index && !force) {
    if (age > FRESH_MS) {
      const since = Date.now() - FRESH_MS;
      waitUntil(withLock(kv, () => buildPiece(kv, since)).catch(() => {}));
    }
    return json({ ok: true, at: index.at, divisions: index.divisions, failed: index.failed, players: index.players },
      200, { 'Cache-Control': 'private, max-age=300' });
  }

  /* Nothing yet (or an officer asked for new numbers): build a piece and
     tell the page how far along it is. A forced rebuild counts anything
     fetched in the last ten minutes as already done, so the pieces add up. */
  const since = force ? Math.max(Date.now() - 10 * 60 * 1000, index ? index.at + 1 : 0) : Date.now() - FRESH_MS;
  const res = await withLock(kv, () => buildPiece(kv, since)).catch((e) => ({ error: e.message }));
  if (res && res.index) {
    return json({ ok: true, at: res.index.at, divisions: res.index.divisions, failed: res.index.failed, players: res.index.players });
  }
  return json({ ok: true, building: true, done: res && res.done || 0, total: res && res.total || 0, error: res && res.error });
}
