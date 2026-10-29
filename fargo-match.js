/* ────────────────────────────────────────────────────────────────────
   fargo-match.js  v1.06

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
  const CACHE_V = 3;                       /* bump to throw old cached matches away */

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
    /* Same corrections the other pages apply: nights split in two get
       merged, and a match filed on the wrong night moves back. */
    return window.fixFargoBlocks ? window.fixFargoBlocks(blocks) : blocks;
  }

  /* Safari's date parser is fussier than Chrome's, and the reports
     hand us three different shapes. Read the two we know by hand
     before falling back to whatever the browser makes of it. */
  function parseDate(s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : s;
    const t = String(s).replace(/^[a-z]+,\s*/i, '').trim();

    let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/);
    if (m) {
      let hh = m[4] ? parseInt(m[4], 10) : 0;
      const ap = (m[7] || '').toUpperCase();
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      return new Date(+m[3], +m[1] - 1, +m[2], hh, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
    }
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

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
      maxHdcp: parseInt(gi('Division_MaximumAllowedHandicap')) || 20,
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
      if (s1raw === null || s1raw === undefined) return;      /* no box at all */
      /* The boxes are there from the moment a lineup is set and stay
         empty until someone types the score in. An empty box is a game
         not yet played or not yet entered — it is not a 0. */
      const scored = String(s1raw).trim() !== '' || String(s2raw == null ? '' : s2raw).trim() !== '';

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
        round, doubles, scored,
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

    out.total  = out.games.length;
    out.scored = out.games.filter(g => g.scored).length;
    return out;
  }

  /* ── cached match loading ───────────────────────────────────────
     A finished match never changes, so it's read once and kept in the
     browser. That's what keeps a player page to a fetch or two a week
     instead of twenty in March. */
  const memo = {};
  const key = id => `kpl.match.${CACHE_V}.${id}`;

  /* A kept sheet is only usable if it was written by a build that
     knew which games had scores in them. Anything older gets read
     again rather than quietly counting as nothing. */
  const usable = d => d && Array.isArray(d.games) && typeof d.scored === 'number';

  function cacheGet(id) {
    if (memo[id]) return memo[id];
    try {
      const raw = localStorage.getItem(key(id));
      if (raw) {
        const d = JSON.parse(raw);
        if (!usable(d)) { localStorage.removeItem(key(id)); return null; }
        memo[id] = d;
        return d;
      }
    } catch (e) { /* private mode, full quota — just refetch */ }
    return null;
  }
  function cachePut(id, data) {
    memo[id] = data;
    try { localStorage.setItem(key(id), JSON.stringify(data)); } catch (e) { /* fine */ }
  }

  /* Only a finished sheet is worth keeping. A lineup posted on
     Wednesday with the scores still to come would otherwise be held
     as gospel long after Thursday morning, which is exactly how a
     match ends up reading 20\u20130 on handicap alone. Anything older
     than a fortnight is as entered as it is ever going to be. */
  const SETTLES_AFTER_DAYS = 2;    /* a fresh sheet can still be corrected */
  const FINAL_AFTER_DAYS   = 14;   /* by now it is what it is */
  function worthKeeping(data) {
    if (!data || !data.total) return false;
    const when = parseDate(data.date);
    const age = when ? (Date.now() - when.getTime()) / 864e5 : 99;
    if (age > FINAL_AFTER_DAYS) return true;
    /* Fully entered and a couple of days settled: keep it. Anything
       newer is re-read next visit, which costs one fetch a match and
       means a score typed in late \u2014 or fixed \u2014 shows up. */
    return data.scored === data.total && age > SETTLES_AFTER_DAYS;
  }

  /* Sheets kept under an older cache version will never be read again. */
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('kpl.') && !k.startsWith(`kpl.match.${CACHE_V}.`) && !k.startsWith(`kpl.rep.${CACHE_V}.`))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) { /* no storage, nothing to sweep */ }

  async function loadMatch(matchId) {
    const hit = cacheGet(matchId);
    if (hit) return hit;
    const html = await fetchReport(`${BASE}/MatchResultBCAPL?matchId=${matchId}`);
    const data = parseMatch(html, matchId);
    if (worthKeeping(data)) cachePut(matchId, data);
    return data;
  }

  /* A few at a time: enough to be quick, not so many that a phone on
     bar wifi chokes. */
  async function loadMatches(ids, limit = 4) {
    const queue = ids.slice();
    const done = [];
    let failed = 0;
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try { done.push(await loadMatch(id)); } catch (e) { failed++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
    /* How many didn't answer, so a caller can tell "nothing posted"
       apart from "nothing loaded". */
    done.failed = failed;
    return done;
  }


  /* ── who won ─────────────────────────────────────────────────────
     The same arithmetic the scoresheet does: in 8-ball the round is
     won on balls with the handicap added, the handicap itself is the
     FargoRate expectation spread spread over the rounds back to front,
     and the match goes to whoever took more rounds. */
  function result(m) {
    const use8 = m.maxScore > 1;
    const rounds = [...new Set(m.games.map(g => g.round))].sort((a, b) => a - b);
    const rate = side => Math.max(...side.map(p => p.rating || 0), 0);

    /* A round nobody has entered yet isn't a 0–0 draw, and it certainly
       isn't a handicap win: leave it out until the scores go in. */
    const live = rounds.filter(rn => m.games.some(g => g.round === rn && g.scored));

    let hdcpBy = {}, hdcpTeam = 0;
    if (use8) {
      let v1 = 0, v2 = 0;
      m.games.forEach(g => {
        const r1 = rate(g.side1), r2 = rate(g.side2);
        if (r1 > 0 && r2 > 0) {
          const p = 1 / (1 + Math.pow(2, (r2 - r1) / 100));
          v1 += p * 10 + (1 - p) * (7.4 - 0.0062 * r2);
          v2 += (1 - p) * 10 + p * (7.4 - 0.0062 * r1);
        }
      });
      const cap = m.maxHdcp || 20;
      let total = 0;
      if (v2 > v1)      { hdcpTeam = 1; total = Math.min(Math.floor(v2 - v1), cap); }
      else if (v1 > v2) { hdcpTeam = 2; total = Math.min(Math.floor(v1 - v2), cap); }
      let left = total, i = rounds.length - 1;
      while (left > 0 && rounds.length) {
        const rn = rounds[i];
        hdcpBy[rn] = (hdcpBy[rn] || 0) + 1;
        left--; i--;
        if (i < 0) i = rounds.length - 1;
      }
    }

    let rw1 = 0, rw2 = 0, pts1 = 0, pts2 = 0, gw1 = 0, gw2 = 0;
    live.forEach(rn => {
      let p1 = 0, p2 = 0, w1 = 0, w2 = 0;
      m.games.filter(g => g.round === rn).forEach(g => {
        p1 += g.points1; p2 += g.points2;
        if (g.win1) w1++; else if (g.win2) w2++;
      });
      const h = use8 ? (hdcpBy[rn] || 0) : 0;
      const a1 = p1 + (hdcpTeam === 1 ? h : 0);
      const a2 = p2 + (hdcpTeam === 2 ? h : 0);
      const t1 = use8 ? a1 : w1, t2 = use8 ? a2 : w2;
      if (t1 > t2) rw1 += 1;
      else if (t2 > t1) rw2 += 1;
      else if (t1 > 0) { rw1 += 0.5; rw2 += 0.5; }
      pts1 += use8 ? a1 : p1; pts2 += use8 ? a2 : p2;
      gw1 += w1; gw2 += w2;
    });

    const scored = m.scored != null ? m.scored : m.games.filter(g => g.scored).length;
    const total  = m.total  != null ? m.total  : m.games.length;
    const done = total > 0 && scored === total;

    /* Five points are on the table: one for each of the four rounds,
       and a fifth for the higher ball total over the whole match. A
       dead heat splits whichever one it falls on. Checked against
       FargoRate's own RDS column \u2014 all eight teams agree. */
    const bonus1 = !done ? 0 : pts1 > pts2 ? 1 : pts1 === pts2 ? 0.5 : 0;
    const bonus2 = !done ? 0 : 1 - bonus1;
    const mp1 = rw1 + bonus1, mp2 = rw2 + bonus2;

    return {
      rounds: live.length, rw1, rw2, pts1, pts2, gw1, gw2,
      mp1, mp2, bonus1, bonus2,
      scored, total, partial: scored > 0 && !done,
      win1: mp1 > mp2, win2: mp2 > mp1, tie: mp1 === mp2 && mp1 > 0,
    };
  }

  const isoOf = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';

  /* Every night one team has already played, with the result from
     that night's own sheet. */
  async function teamSeason(divisionId, teamName) {
    const want = normTeam(teamName);
    const blocks = parseSchedule(await scheduleCached(divisionId));
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const ids = [];
    blocks.forEach(b => {
      const d = parseDate(b.date);
      if (d && d > today) return;
      b.matches.forEach(m => {
        if (!m.matchId) return;
        if (want && normTeam(m.home) !== want && normTeam(m.away) !== want) return;
        ids.push(m.matchId);
      });
    });
    const loaded = await loadMatches(ids);
    return loaded.filter(m => m && m.scored).map(m => {
      const r = result(m);
      const home = normTeam(m.team1) === want;
      const when = parseDate(m.date);
      return {
        matchId: m.matchId, when, iso: isoOf(when),
        team: home ? m.team1 : m.team2,
        opp:  home ? m.team2 : m.team1,
        home,
        for:    home ? r.pts1 : r.pts2,
        against:home ? r.pts2 : r.pts1,
        rounds:    home ? r.rw1 : r.rw2,
        oppRounds: home ? r.rw2 : r.rw1,
        points:    home ? r.mp1 : r.mp2,
        oppPoints: home ? r.mp2 : r.mp1,
        games:     home ? r.gw1 : r.gw2,
        oppGames:  home ? r.gw2 : r.gw1,
        win:  home ? r.win1 : r.win2,
        loss: home ? r.win2 : r.win1,
        tie:  r.tie,
        partial: r.partial, scored: r.scored, total: r.total,
      };
    });
  }


  /* The most recent night that has scores on it, division-wide. The
     sheet's own date is what gets shown, so a wrong date on the posted
     schedule can't mislabel it. */
  async function recentResults(divisionId) {
    const blocks = parseSchedule(await scheduleCached(divisionId));
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const withIds = blocks.filter(b => b.matches.some(m => m.matchId));
    let past = withIds.filter(b => {
      const d = parseDate(b.date);
      return d && d <= today;
    });
    /* If not one date could be read, don't give up — the sheets
       themselves carry their date, and an unplayed one comes back
       empty anyway. */
    if (!past.length) past = withIds;
    for (let i = past.length - 1; i >= 0; i--) {
      const ids = past[i].matches.filter(m => m.matchId).map(m => m.matchId);
      const got = await loadMatches(ids);
      /* Every sheet refused: that's a failure to report, not a quiet
         "no scores yet". */
      if (ids.length && got.failed === ids.length) {
        throw new Error('the scoresheets didn\u2019t answer');
      }
      const loaded = got.filter(m => m && m.scored);
      if (!loaded.length) continue;
      const when = parseDate(loaded[0].date) || parseDate(past[i].date);
      return {
        date: when, iso: isoOf(when),
        matches: loaded.map(m => {
          const r = result(m);
          return {
            matchId: m.matchId, home: m.team1, away: m.team2,
            homePts: r.pts1, awayPts: r.pts2,
            homeRounds: r.rw1, awayRounds: r.rw2,
            homePoints: r.mp1, awayPoints: r.mp2,
            homeGames: r.gw1, awayGames: r.gw2,
            homeWin: r.win1, awayWin: r.win2, tie: r.tie,
            partial: r.partial, scored: r.scored, total: r.total,
          };
        }),
      };
    }
    return null;
  }

  window.FargoMatch = {
    PROXY, BASE,
    cleanName, normName, slugName, normTeam, shortName,
    fetchReport, report, reportCached, fetchSchedule, scheduleCached, parseTable, colIndex,
    parseSchedule, parseDate, parseMatch, loadMatch, loadMatches,
    result, teamSeason, recentResults, isoOf,
  };
})();
