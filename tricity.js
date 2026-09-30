/* ═══════════════════════════════════════════════════════════════
   Tri City tournaments — shared by tricity.html, tricity-roster.html,
   tricity-match.html, tricity-win.html and tricityadmin.html.

   Everything that changes from one Tri City to the next lives in
   TC_EVENTS at the top. The server keeps its own short list of the
   same keys in functions/api/tricity.js — add an event in both.
   tricity.js v1.04
   ═══════════════════════════════════════════════════════════════ */

/* Leave a field as '' and the page simply doesn't show it. */
const TC_EVENTS = {
  kemmerer: {
    key: 'kemmerer',
    name: 'Red Short Memorial Tri City',
    where: 'Kemmerer',
    when: 'Jan 16–17, 2027',
    deadline: '',
    fee: '',
    checkin: '',
    maxTeams: null,
    flyer: 'images/tri-city-2027.jpg',
    /* Printed on the roster under Tournament Info. Leave empty to use
       the shared lines in TC_RULES.info below. */
    info: [],
  },
  evanston: {
    key: 'evanston',
    name: 'Evanston Tri City',
    where: 'Evanston',
    when: 'Feb 6–7, 2027',
    deadline: '',
    fee: '',
    checkin: '',
    maxTeams: null,
    flyer: 'images/tri-city-2027.jpg',
    /* Printed on the roster under Tournament Info. Leave empty to use
       the shared lines in TC_RULES.info below. */
    info: [],
  },
  bridgervalley: {
    key: 'bridgervalley',
    name: 'Bridger Valley Tri City',
    where: 'Bridger Valley',
    when: 'Mar 6–7, 2027',
    deadline: '',
    fee: '',
    checkin: '',
    maxTeams: 32,
    flyer: 'images/tri-city-2027.jpg',
    /* Printed on the roster under Tournament Info. Leave empty to use
       the shared lines in TC_RULES.info below. */
    info: [],
  },
};
const TC_DEFAULT = 'kemmerer';

/* The handicap, as the flyer puts it: 1 ball per 100 points difference,
   max of 10 balls per match. A team's number is the sum of its top four
   Fargo ratings, whatever order they signed up in. */
const TC_RULES = {
  maxPlayers: 6,
  shownAtStart: 4,
  countTop: 4,
  perPoint: 100,        // 1 point per 100 Fargo
  roundTo: 100,         // team totals go to the nearest 100 first
  rounds: 3,            // 12 game match, 4 man teams
  maxPerRound: 4,
  maxPerMatch: 12,
  ruleText: 'Handicap: 1 point per 100 Fargo. Max of 4 per round, 12 per match.',
  /* What every Tri City has in common — used when an event has no info
     lines of its own. The date, check-in and fee from TC_EVENTS go above
     these on the printed roster. */
  info: [
    'BCA rules apply',
    '4 man teams, 12 game format',
    'Handicap max of 4 per round, 12 per match',
    '1 point per 100 Fargo',
    'Team totals round to the nearest 100',
  ],
};

function tcEventKey() {
  const e = (new URLSearchParams(location.search).get('e') || TC_DEFAULT).toLowerCase();
  return TC_EVENTS[e] ? e : TC_DEFAULT;
}
function tcEvent() { return TC_EVENTS[tcEventKey()]; }

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* Players sorted best first, and the four that count. */
function tcRanked(players) {
  return (players || []).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

/* A team's raw number: its top four Fargo ratings added up. */
function tcTeamRating(players) {
  return tcRanked(players).slice(0, TC_RULES.countTop).reduce((n, p) => n + (p.rating || 0), 0);
}

/* The number the handicap is worked out from — the total rounded to the
   nearest 100, so 1,951 plays as 2,000 and 1,934 plays as 1,900. */
function tcRounded(total) {
  return Math.round(total / TC_RULES.roundTo) * TC_RULES.roundTo;
}

/* Points the lower team gets each round, and over the whole match.
   Both take the raw totals and do the rounding themselves.
   The flyer's example: 1,600 against 2,000 is 4 a round, 12 for the match. */
function tcPointsRound(a, b) {
  const diff = Math.abs(tcRounded(a) - tcRounded(b));
  return Math.min(TC_RULES.maxPerRound, Math.floor(diff / TC_RULES.perPoint));
}
function tcPointsMatch(a, b) {
  return Math.min(TC_RULES.maxPerMatch, tcPointsRound(a, b) * TC_RULES.rounds);
}

/* ── Talking to the server ── */
async function tcGet(e, pass) {
  const r = await fetch('/api/tricity?e=' + encodeURIComponent(e),
    pass ? { headers: { 'X-League-Pass': pass } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || 'Could not load the teams.'), { code: j.code });
  return j;
}
async function tcSend(method, body, pass) {
  const headers = { 'Content-Type': 'application/json' };
  if (pass) headers['X-League-Pass'] = pass;
  const r = await fetch('/api/tricity', { method, headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return Object.assign({ ok: r.ok && j.ok }, j);
}

/* The full address of one of the Tri City pages, for QR codes. */
function tcUrl(page, params) {
  const u = new URL(page, location.href);
  Object.keys(params).forEach(k => u.searchParams.set(k, params[k]));
  return u.toString();
}

/* ═══ FargoRate player lookup ═══════════════════════════════════
   The same index signup.html builds — every Jenkins division, a day's
   cache in this browser under the same key, so a phone that used one
   page doesn't rebuild it for the other.
   ═══════════════════════════════════════════════════════════════ */

let tcStatusHook = null;
function setStatus(msg, bad) { if (tcStatusHook) tcStatusHook(msg, bad); }

const PROXY = '/proxy?url=';
const LMS   = 'https://lms.fargorate.com/PublicReport';

/* Jenkins divisions the lookup searches. IDs change each season — refresh from
   the division dropdown on the LMS league page when a new one starts. */
const LEAGUE_ID = '6e402f34-de51-4e68-9e30-aeeb014fb597';   // Jenkins Music & Vending

/* Every division Jenkins has run, from the LMS "Show all divisions" list.
   Ratings shown are always current, so an old season simply adds more people —
   which is the point, since the player who turns up to a summer tournament may
   not be in any league running right now. Discovery adds to this, never
   replaces it. */
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

/* Any division page carries the dropdown of what's currently running, which is
   how new seasons get picked up. Those are MERGED with the list above — a
   division that has finished still holds ratings for people who play in the
   next one, and dropping them loses hundreds of players. */
async function fetchDivisions() {
  const merged = new Map(DIVISIONS.map(d => [d[0], d[1]]));
  for (const seed of DIVISIONS.map(d => d[0])) {
    try {
      const r = await fetch(PROXY + encodeURIComponent(`${LMS}/LeagueReports/${seed}`));
      if (!r.ok) continue;
      const html = await r.text();
      const sel = html.match(/<select[^>]*id="division-list"[^>]*>([\s\S]*?)<\/select>/i);
      if (!sel) continue;
      let m, found = 0;
      const re = /<option[^>]*value="([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/option>/gi;
      while ((m = re.exec(sel[1]))) {
        merged.set(m[1], m[2].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim());
        found++;
      }
      if (found) break;                       // one page lists them all
    } catch (e) { /* try the next seed */ }
  }
  return [...merged.entries()];
}

/* Ratings move once a week, so a day-old index is fine and saves rebuilding it
   on every visit. */
const INDEX_CACHE = 'kpl-fargo-index-v3';
const CACHE_HOURS = 3;

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_CACHE));
    if (!raw || !raw.at || !Array.isArray(raw.players)) return null;
    if (Date.now() - raw.at > CACHE_HOURS * 3600 * 1000) return null;
    return raw;
  } catch (e) { return null; }
}
function writeCache(players, divisions) {
  try {
    localStorage.setItem(INDEX_CACHE, JSON.stringify({ at: Date.now(), players, divisions }));
  } catch (e) { /* storage full or blocked — the index just rebuilds next time */ }
}


let playerIndex = null;      // [{name, rating, division}] across every division
let indexLoading = null;

/* ── Fargo lookup ── */
function parsePlayerList(html, divLabel) {
  const d = document.createElement('div');
  d.innerHTML = html;
  const table = d.querySelector('table');
  if (!table) return [];

  const rows = [...table.querySelectorAll('tr')];
  let headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim());
  if (!headers.length && rows[0]) headers = [...rows[0].querySelectorAll('td')].map(td => td.textContent.trim());
  const ratingIdx = headers.findIndex(h => /rating|fargo/i.test(h));
  const nameIdx   = headers.findIndex(h => /name/i.test(h));

  const out = [];
  rows.slice(1).forEach(tr => {
    const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g,' ').trim());
    if (!cells.length) return;
    const raw = cells[nameIdx >= 0 ? nameIdx : 1] || cells[0];
    const rating = parseInt(cells[ratingIdx >= 0 ? ratingIdx : cells.length - 1], 10);
    if (!raw || !rating) return;
    // FargoRate lists names "Last, First" — flip for searching
    const name = /,\s/.test(raw) ? raw.replace(/^([^,]+),\s*(.+)$/, '$2 $1') : raw;
    out.push({ name, rating, division: divLabel });
  });
  return out;
}

let indexAt = 0;             // when FargoRate was last read for the index in use

/* The index now comes from the server, built once for everybody
   (functions/api/fargo-index.js). The first time ever, the server builds
   it in pieces and this keeps asking until it's done. `fresh` (officers
   only) makes the server read FargoRate again right now. */
async function serverIndex(fresh, pass) {
  for (let tries = 0; tries < 12; tries++) {
    const r = await fetch('/api/fargo-index' + (fresh ? '?fresh=1' : ''),
      pass ? { headers: { 'X-League-Pass': pass } } : undefined);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'index ' + r.status);
    if (Array.isArray(j.players) && j.players.length) return j;
    if (!j.building) throw new Error('empty');
    setStatus(j.total
      ? `Getting ratings from FargoRate… ${j.done} of ${j.total} divisions`
      : 'Getting ratings from FargoRate…');
    await new Promise(res => setTimeout(res, 700));
  }
  throw new Error('still building');
}

/* The old way — every division through /proxy, from this browser. Only
   used if the server can't answer. */
async function browserIndex() {
  setStatus('Loading player lists from FargoRate…');
  const divisions = await fetchDivisions();
  const all = [];
  let failed = 0, done = 0;
  const BATCH = 6;
  for (let i = 0; i < divisions.length; i += BATCH) {
    await Promise.all(divisions.slice(i, i + BATCH).map(async ([id, label]) => {
      try {
        const r = await fetch(PROXY + encodeURIComponent(`${LMS}/GeneratePlayerListReport/${id}`));
        if (!r.ok) throw new Error(r.status);
        all.push(...parsePlayerList(await r.text(), label));
      } catch (e) { failed++; }
      done++;
      setStatus(`Loading players… ${done} of ${divisions.length} divisions`);
    }));
  }
  const byKey = {};
  all.forEach(p => {
    const k = p.name.toLowerCase();
    if (!byKey[k] || p.rating > byKey[k].rating) byKey[k] = p;
  });
  return { at: Date.now(), players: Object.values(byKey).sort((a, b) => a.name.localeCompare(b.name)), divisions: divisions.length, failed };
}

/* loadIndex()                       whatever is quickest: memory, this
                                     browser's copy, then the server
   loadIndex({ fresh: true, pass })  officers: straight from FargoRate */
async function loadIndex(opts) {
  const fresh = !!(opts && opts.fresh);
  if (playerIndex && !fresh) return playerIndex;
  if (indexLoading && !fresh) return indexLoading;

  if (!fresh) {
    const cached = readCache();
    if (cached) {
      playerIndex = cached.players;
      indexAt = cached.fargoAt || cached.at;
      setStatus('');
      return playerIndex;
    }
  }

  indexLoading = (async () => {
    let got;
    try { got = await serverIndex(fresh, opts && opts.pass); }
    catch (e) { got = await browserIndex(); }

    playerIndex = got.players;
    indexAt = got.at;
    if (playerIndex.length) {
      try {
        localStorage.setItem(INDEX_CACHE, JSON.stringify({ at: Date.now(), fargoAt: got.at, players: playerIndex }));
      } catch (e) { /* storage full or blocked — fine */ }
    }
    setStatus(playerIndex.length ? '' : 'No players came back — add players by hand.', !playerIndex.length);
    return playerIndex;
  })();

  try { return await indexLoading; }
  finally { indexLoading = null; }
}

/* ═══ One roster spot with its own lookup ═══════════════════════
   Type a name, pick them from the list, and their rating comes with
   them. Someone who isn't in a Jenkins league can be used as typed,
   with a rating put in by hand (or left blank).

   Everything the player picks is kept in `this.value`; names never go
   into onclick strings — the hits are looked up by position instead.
   ═══════════════════════════════════════════════════════════════ */

class PlayerSlot {
  constructor(root, label, onChange) {
    this.root = root;
    this.label = label;
    this.onChange = onChange || (() => {});
    this.value = null;           /* {name, rating, division} once picked */
    this.hits = [];
    this.sel = 0;
    this.render('');
  }

  render(typed) {
    const v = this.value;
    this.root.innerHTML = `
      <label>${esc(this.label)}</label>
      ${v ? `
        <div class="pl-picked${v.division ? '' : ' manual'}">
          <span class="pl-who">
            <span class="pl-name">${esc(v.name)}</span>
            <span class="pl-div">${v.division ? esc(v.division) : 'Not in a Jenkins league — rating entered by hand'}</span>
          </span>
          ${v.division
            ? `<span class="pl-rating">${v.rating}</span>`
            : `<input class="pl-rate" type="number" inputmode="numeric" min="0" max="1000" placeholder="Fargo" value="${v.rating || ''}" aria-label="Fargo rating">`}
          <button type="button" class="pl-change">Change</button>
        </div>`
      : `
        <input class="pl-input" type="text" maxlength="80" autocomplete="off" spellcheck="false"
               placeholder="Start typing a name…" value="${esc(typed)}">
        <div class="pl-results" hidden></div>`}`;

    if (v) {
      this.root.querySelector('.pl-change').onclick = () => {
        const name = this.value.name;
        this.value = null;
        this.render(name);
        this.onChange();
        const i = this.root.querySelector('.pl-input');
        i.focus(); i.select();
      };
      const rate = this.root.querySelector('.pl-rate');
      if (rate) rate.oninput = () => {
        this.value.rating = Math.max(0, Math.min(1000, parseInt(rate.value, 10) || 0));
        this.onChange();
      };
    } else {
      const input = this.root.querySelector('.pl-input');
      input.oninput = () => this.search();
      input.onkeydown = ev => this.key(ev);
      input.onblur = () => setTimeout(() => this.close(), 180);
      input.onfocus = () => { if (input.value.trim().length >= 2) this.search(); };
    }
  }

  typed() {
    const i = this.root.querySelector('.pl-input');
    return i ? i.value.trim() : '';
  }

  async search() {
    const q = this.typed();
    const box = this.root.querySelector('.pl-results');
    if (!box) return;
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }

    box.hidden = false;
    if (!playerIndex) box.innerHTML = '<div class="pl-wait">Loading players from FargoRate…</div>';
    const idx = await loadIndex().catch(() => []);
    if (this.typed() !== q || this.value) return;       /* they kept typing */

    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    this.hits = (idx || []).filter(p => {
      const n = p.name.toLowerCase();
      return words.every(w => n.includes(w));
    }).slice(0, 6);
    this.sel = 0;

    box.innerHTML = this.hits.map((p, i) => `
      <button type="button" class="pl-hit${i === 0 ? ' sel' : ''}" data-i="${i}">
        <span><span class="pl-hn">${esc(p.name)}</span><span class="pl-hd">${esc(p.division)}</span></span>
        <span class="pl-hr">${p.rating}</span>
      </button>`).join('') + `
      <button type="button" class="pl-hit pl-typed${this.hits.length ? '' : ' sel'}" data-i="typed">
        <span><span class="pl-hn">Use “${esc(q)}” as typed</span>
        <span class="pl-hd">Not in a Jenkins league — put the rating in by hand</span></span>
      </button>`;

    box.querySelectorAll('.pl-hit').forEach(b => {
      b.onmousedown = ev => ev.preventDefault();       /* keep focus so blur doesn't close it first */
      b.onclick = () => this.choose(b.dataset.i);
    });
  }

  key(ev) {
    const items = [...this.root.querySelectorAll('.pl-hit')];
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (items[this.sel]) items[this.sel].click(); else this.search();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!items.length) return;
      this.sel = (this.sel + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('sel', i === this.sel));
    } else if (ev.key === 'Escape') {
      this.close();
    }
  }

  close() {
    const box = this.root.querySelector('.pl-results');
    if (box) box.hidden = true;
  }

  choose(which) {
    if (which === 'typed') {
      const name = this.typed();
      if (!name) return;
      this.value = { name, rating: 0, division: null };
      this.render('');
      const rate = this.root.querySelector('.pl-rate');
      if (rate) rate.focus();
    } else {
      const p = this.hits[+which];
      if (!p) return;
      this.value = { name: p.name, rating: p.rating, division: p.division };
      this.render('');
    }
    this.onChange();
  }
}
