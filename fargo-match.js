/* ────────────────────────────────────────────────────────────────────
   fargo-match.js  v1.00

   Everything the player pages need to read FargoRate's public reports.
   league.html still carries its own copy of this parsing for its own
   views — this file exists so player.html doesn't have to drag a
   thousand lines of renderer along with it. The selectors below are
   the same ones league.html proved against the live reports.

   Loads after fargo-fixes.js so every report is run through the team
   name corrections before anything parses it.
   ──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const PROXY = '/proxy?url=';
  const BASE  = 'https://lms.fargorate.com/PublicReport';
  const CACHE_V = 1;                       /* bump to throw old cached matches away */

  const fixHtml = h => (window.fixFargoHtml ? window.fixFargoHtml(h) : String(h));

  /* ── names ──────────────────────────────────────────────────────
     Reports give "Smith, Kylee (412)" in some views and "Kylee Smith"
     in others. One shape in, one shape out. */
  function cleanName(s) {
    let n = (s || '').replace(/\s*\(\s*[^)]*\s*\)\s*$/, '').replace(/\s+/g, ' ').trim();
    if (/^[^,]+,\s*.+$/.test(n)) n = n.replace(/^([^,]+),\s*(.+)$/, '$2 $1');
    return n.trim();
  }
  const normName = s => cleanName(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugName = s => cleanName(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  /* Team names drift between reports and our own data: "8Ball Magic"
     against "8 Ball Magic", "and" against "&". Flatten both. */
  const normTeam = s => String(s || '').toLowerCase()
    .replace(/&/g, 'and').replace(/\band\b/g, '').replace(/[^a-z0-9]/g, '');

  const shortName = s => {
    const p = cleanName(s).split(' ').filter(Boolean);
    return p.length < 2 ? (p[0] || '') : `${p[0]} ${p[p.length - 1][0]}.`;
  };

  /* ── fetching ───────────────────────────────────────────────── */
  async function fetchReport(url, opts = {}) {
    const o = { method: opts.method || 'GET', headers: { Accept: 'text/html' } };
    if (o.method === 'POST') {
      o.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      o.body = opts.body || '';
    }
    const r = await fetch(PROXY + encodeURIComponent(url), o);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = fixHtml(await r.text());
    if (!html || html.trim().length < 30) throw new Error('empty report');
    return html;
  }

  const report = (name, divisionId) => fetchReport(`${BASE}/${name}/${divisionId}`);

  /* Reports do change, so they're only held for the length of a visit —
     long enough that clicking from one player to the next doesn't pull
     the same roster down three more times. */
  async function cached(key, mins, load) {
    const k = `kpl.rep.${CACHE_V}.${key}`;
    try {
      const raw = sessionStorage.getItem(k);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.html && (Date.now() - o.t) < mins * 60000) return o.html;
      }
    } catch (e) { /* no session storage, just fetch */ }
    const html = await load();
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), html })); } catch (e) { /* fine */ }
    return html;
  }
  const reportCached   = (name, divisionId, mins = 15) =>
    cached(`${name}.${divisionId}`, mins, () => report(name, divisionId));
  const scheduleCached = (divisionId, mins = 15) =>
    cached(`sched.${divisionId}`, mins, () => fetchSchedule(divisionId));

  /* The schedule wants a form post and won't say which field name it
     prefers, so try the ones that have worked and keep the first reply
     that actually holds a schedule. */
  async function fetchSchedule(divisionId) {
    const bodies = [
      `divisionId=${divisionId}&groupBy=date`,
      `divisionId=${divisionId}&groupBy=Date`,
      `divisionId=${divisionId}&scheduleGroupBy=date`,
      `divisionId=${divisionId}`,
    ];
    let last = '';
    for (const body of bodies) {
      try {
        const html = await fetchReport(`${BASE}/GenerateDivisionScheduleReport`, { method: 'POST', body });
        if (looksLikeSchedule(html)) return html;
        if (html.length > last.length) last = html;
      } catch (e) { /* try the next shape */ }
    }
    return last;
  }

  function looksLikeSchedule(html) {
    if (/schedule-date|schedule-team-block|schedule-team\b/.test(html)) return true;
    if (!/<t[rd]\b/i.test(html)) return false;
    return /\d{1,2}\/\d{1,2}\/\d{4}/.test(html) ||
           /(mon|tues|wednes|thurs|fri|satur|sun)day/i.test(html);
  }

  /* ── plain report tables ────────────────────────────────────── */
  function parseTable(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    const table = d.querySelector('table');
    if (!table) return null;
    const trs = [...table.querySelectorAll('tr')];
    let headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim());
    let start = 0;
    if (!headers.length && trs[0]) {
      headers = [...trs[0].querySelectorAll('td')].map(td => td.textContent.trim());
      start = 1;
    } else {
      start = trs.findIndex(tr => tr.querySelector('td'));
      if (start < 0) start = trs.length;
    }
    const rows = trs.slice(start)
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(r => r.length > 1 && r.some(c => c));
    return { headers, rows };
  }

  /* Column lookup by meaning rather than position: a division with an
     extra column shouldn't put the rating where the team goes. */
  function colIndex(headers, re) {
    return headers.findIndex(h => re.test((h || '').trim()));
  }

  /* ── schedule → dates, teams, match ids ─────────────────────── */
  function parseSchedule(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    const blocks = [];
    let cur = null;

    const teamsOf = node => [...node.querySelectorAll('.schedule-team')]
      .map(s => s.textContent.trim().replace(/^\((H|A)\)\s*/i, '').trim());
    const idOf = s => (String(s || '').match(/matchId=([a-f0-9-]{36})/i) || [])[1] || null;

    [...d.querySelectorAll('.schedule-date, .schedule-team-block')].forEach(node => {
      if (node.classList.contains('schedule-date')) {
        cur = { date: node.textContent.trim(), matches: [] };
        blocks.push(cur);
      } else if (cur) {
        const t = teamsOf(node);
        if (t.length < 2) return;
        const link = node.querySelector('a[href*="matchId"]');
        cur.matches.push({
          home: t[0], away: t[1],
          venue: node.querySelector('.schedule-location')?.textContent.trim() || '',
          matchId: idOf(node.getAttribute('data-url')) || idOf(link && link.getAttribute('href')),
        });
      }
    });

    /* The table shape of the same report. */
    if (!blocks.length) {
      const rows = [...d.querySelectorAll('table tr')];
      let col = { home: 0, away: 1, venue: 2 };
      const head = rows.find(tr => {
        const l = [...tr.children].map(c => c.textContent.trim().toLowerCase());
        return l.some(x => /^home$/.test(x)) && l.some(x => /^away$/.test(x));
      });
      if (head) {
        const l = [...head.children].map(c => c.textContent.trim().toLowerCase());
        const at = re => l.findIndex(x => re.test(x));
        const h = at(/^home/), a = at(/^away/), v = at(/location|venue|bar|room/);
        if (h >= 0) col.home = h;
        if (a >= 0) col.away = a;
        if (v >= 0) col.venue = v;
      }
      rows.forEach(tr => {
        if (tr === head) return;
        const cells = [...tr.children];
        if (!cells.length) return;
        const filled = cells.filter(c => c.textContent.trim());
        if (filled.length === 1) {
          const text = filled[0].textContent.trim();
          if (parseDate(text)) { cur = { date: text, matches: [] }; blocks.push(cur); }
          return;
        }
        if (!cur) return;
        const home = cells[col.home]?.textContent.trim() || '';
        const away = cells[col.away]?.textContent.trim() || '';
        if (!home || !away || /^home$/i.test(home)) return;
        const link = tr.querySelector('a[href*="matchId"], [data-url*="matchId"]');
        const raw = link ? (link.getAttribute('href') || link.getAttribute('data-url') || '') : '';
        cur.matches.push({
          home, away,
          venue: cells[col.venue]?.textContent.trim() || '',
          matchId: idOf(raw),
        });
      });
    }
    return blocks;
  }

  function parseDate(s) {
    if (!s) return null;
    const t = String(s).replace(/^[a-z]+,\s*/i, '').trim();
    const d = new Date(t);
    return isNaN(d) ? null : d;
  }

  /* ── one match's games ──────────────────────────────────────────
     Mirrors league.html's reading of the scoresheet: the selected
     option carries the player and their rating, .row-score carries the
     score (.row-handicap is a different input), and an adornment code
     in the score box — TR, BR, WZ, WF — is a win on its own. */
  function parseMatch(html, matchId) {
    const d = document.createElement('div');
    d.innerHTML = html;
    const gi = id => d.querySelector('#' + id)?.value || '';

    const maxScore = parseInt(gi('MaxScore')) || 1;
    const out = {
      matchId: matchId || gi('Id') || null,
      team1: gi('TeamOne_Name') || '',
      team2: gi('TeamTwo_Name') || '',
      date: gi('Date') || '',
      maxScore,
      games: [],
    };

    const pick = sel => {
      if (!sel) return { name: '', rating: 0 };
      const opt = sel.querySelector('option[selected]') || sel.options?.[sel.selectedIndex || 0];
      return {
        name: cleanName(opt?.textContent || ''),
        rating: parseInt(opt?.getAttribute?.('data-handicap') || '0') || 0,
      };
    };

    [...d.querySelectorAll('.game-container[data-round]')].forEach(game => {
      const round = parseInt(game.getAttribute('data-round')) || 0;
      const type = game.getAttribute('data-gametype') || 'SINGLES';
      const doubles = type.toUpperCase().startsWith('D');

      const s1raw = game.querySelector('input.row-score[data-team="1"]')?.getAttribute('value');
      const s2raw = game.querySelector('input.row-score[data-team="2"]')?.getAttribute('value');
      if (s1raw === null || s1raw === undefined) return;      /* not played yet */

      const code = v => ['TR', 'BR', 'WZ', 'WF'].includes(String(v || '').toUpperCase().trim());
      const n1 = parseInt(s1raw) || 0, n2 = parseInt(s2raw) || 0;
      const a1 = code(s1raw), a2 = code(s2raw);
      const win1 = a1 || (!a2 && (n1 >= maxScore || (n1 > n2 && n2 < maxScore)));
      const win2 = a2 || (!a1 && (n2 >= maxScore || (n2 > n1 && n1 < maxScore)));

      let side1, side2;
      if (doubles) {
        const sel1 = [...game.querySelectorAll('.player-container-1 select')];
        const sel2 = [...game.querySelectorAll('.player-container-2 select')];
        side1 = sel1.map(pick);
        side2 = sel2.map(pick);
      } else {
        side1 = [pick(game.querySelector('select.team-one-player'))];
        side2 = [pick(game.querySelector('select.team-two-player'))];
      }

      out.games.push({
        round, doubles,
        side1, side2,
        score1: s1raw, score2: s2raw,
        points1: a1 ? maxScore : n1,
        points2: a2 ? maxScore : n2,
        code1: a1 ? String(s1raw).toUpperCase().trim() : '',
        code2: a2 ? String(s2raw).toUpperCase().trim() : '',
        win1, win2,
        broke1: !!game.querySelector('.break-container-1 .game-chip.break-active'),
        broke2: !!game.querySelector('.break-container-2 .game-chip.break-active'),
      });
    });

    return out;
  }

  /* ── cached match loading ───────────────────────────────────────
     A finished match never changes, so it's read once and kept in the
     browser. That's what keeps a player page to a fetch or two a week
     instead of twenty in March. */
  const memo = {};
  const key = id => `kpl.match.${CACHE_V}.${id}`;

  function cacheGet(id) {
    if (memo[id]) return memo[id];
    try {
      const raw = localStorage.getItem(key(id));
      if (raw) { memo[id] = JSON.parse(raw); return memo[id]; }
    } catch (e) { /* private mode, full quota — just refetch */ }
    return null;
  }
  function cachePut(id, data) {
    memo[id] = data;
    try { localStorage.setItem(key(id), JSON.stringify(data)); } catch (e) { /* fine */ }
  }

  async function loadMatch(matchId) {
    const hit = cacheGet(matchId);
    if (hit) return hit;
    const html = await fetchReport(`${BASE}/MatchResultBCAPL?matchId=${matchId}`);
    const data = parseMatch(html, matchId);
    if (data.games.length) cachePut(matchId, data);
    return data;
  }

  /* A few at a time: enough to be quick, not so many that a phone on
     bar wifi chokes. */
  async function loadMatches(ids, limit = 4) {
    const queue = ids.slice();
    const done = [];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try { done.push(await loadMatch(id)); } catch (e) { /* skip a bad one */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
    return done;
  }

  window.FargoMatch = {
    PROXY, BASE,
    cleanName, normName, slugName, normTeam, shortName,
    fetchReport, report, reportCached, fetchSchedule, scheduleCached, parseTable, colIndex,
    parseSchedule, parseDate, parseMatch, loadMatch, loadMatches,
  };
})();
