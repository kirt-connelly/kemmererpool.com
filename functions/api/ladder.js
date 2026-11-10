/* ────────────────────────────────────────────────────────────────────
   /api/ladder — the Top 15 challenge ladder.

   GET  is public: anyone can read the ladder, the match history and
        what's in the envelope.
   POST is officers only, on the same X-League-Pass header the other
        admin pages use.

   The rules live here rather than in the admin page, so a mis-typed
   match is caught before it's written and the page can say why.

   Storage: one JSON document in KV. The ladder is fifteen names and a
   season of matches — small enough that a single document keeps every
   write atomic and makes undo a matter of keeping the last few copies.

   Players may put a match up themselves (POST action 'submit', no
   password): it waits in doc.pending until an officer approves it.
   Nothing a player submits touches the ladder on its own.

   ladder v1.03
   ──────────────────────────────────────────────────────────────── */

const DOC      = 'ladder:v1';
const SIZE     = 15;          /* places on the ladder */
const RACE_TO  = 5;           /* every match, whatever anyone's rating */
const PER_MATCH = 5;          /* dollars into the envelope per match */
const UNDO_DEPTH = 20;
const MAX_PENDING = 60;       /* a lid on the public queue */

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-League-Pass',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  },
});

/* The KV namespace is bound in the Pages project. TOURNAMENTS is what
   the Tri City tools use; the others are here so a differently named
   binding still works rather than failing silently. */
const store = env => env.TOURNAMENTS || env.LEAGUE || env.KV || env.SIGNUPS || null;

const pass = env => env.LEAGUE_ADMIN_PW || env.LEAGUE_KEY || 'ktown';

/* A league week runs Wednesday to Tuesday: matches land on Wednesday
   night, and the envelope is handed over before the next one. */
const WEEK_START_DAY = 3;                       /* 0 Sun \u2026 3 Wed */
const DAY = 86400000;
const asDate = iso => {
  const p = String(iso || '').slice(0, 10).split('-').map(Number);
  return (p.length === 3 && p[0]) ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : null;
};
const isoOf = d => d.toISOString().slice(0, 10);
function weekOf(iso) {
  const d = asDate(iso) || new Date();
  const back = (d.getUTCDay() - WEEK_START_DAY + 7) % 7;
  const start = new Date(d.getTime() - back * DAY);
  return { start: isoOf(start), end: isoOf(new Date(start.getTime() + 6 * DAY)) };
}

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 60);
/* Nobody has to remember the score. Blank stays blank rather than
   turning into a 5\u20130 nobody played. */
const parseScore = v => {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(RACE_TO - 1, n)) : null;
};
const key   = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const today = () => new Date().toISOString().slice(0, 10);

function blank() {
  return {
    v: 1, seededAt: null, players: [], matches: [], payouts: [],
    pending: [], potMatches: 0, updatedAt: null, undo: [],
  };
}

async function read(env) {
  const kv = store(env);
  if (!kv) throw new Error('no KV namespace bound');
  const raw = await kv.get(DOC);
  if (!raw) return blank();
  try {
    const d = JSON.parse(raw);
    return Object.assign(blank(), d);
  } catch (e) {
    return blank();
  }
}

async function write(env, doc, snapshot) {
  const kv = store(env);
  doc.updatedAt = new Date().toISOString();
  if (snapshot) {
    const { undo, ...rest } = snapshot;
    doc.undo = [JSON.stringify(rest), ...(doc.undo || [])].slice(0, UNDO_DEPTH);
  }
  await kv.put(DOC, JSON.stringify(doc));
  return doc;
}

/* What the public sees: everything but the undo stack, with the
   envelope worked out from the matches rather than a running counter,
   so a backdated match or an undo can't leave the total adrift. */
function publicView(doc) {
  const { undo, pending, ...rest } = doc;
  const week = weekOf(today());
  const paidThrough = doc.paidThrough || '';
  /* Paid is marked on the match itself, not worked out from a cut-off
     date \u2014 so a match written up after its week was closed out still
     counts, it just counts towards the next envelope. */
  const unpaid = (doc.matches || []).filter(m => !m.forfeit && !m.paid);
  const thisWeek = unpaid.filter(m => m.date >= week.start && m.date <= week.end);
  const earlier  = unpaid.filter(m => m.date < week.start);

  return {
    ...rest,
    size: SIZE,
    raceTo: RACE_TO,
    perMatch: PER_MATCH,
    week,
    weekMatches: thisWeek.length,
    weekPot: thisWeek.length * PER_MATCH,
    priorMatches: earlier.length,
    priorPot: earlier.length * PER_MATCH,
    potMatches: unpaid.length,
    pot: unpaid.length * PER_MATCH,
    paidThrough,
    waiting: (pending || []).length,
    undoDepth: (undo || []).length,
  };
}

/* Officers also see the queue itself. */
const adminView = doc => ({ ...publicView(doc), pending: doc.pending || [] });

const find = (doc, name) => doc.players.find(p => key(p.name) === key(name)) || null;
const renumber = doc => { doc.players.forEach((p, i) => { p.rank = i + 1; }); return doc; };

/* ── the rules ──────────────────────────────────────────────────────
   A challenge comes from below: one place, no further. Someone off the
   ladder may only knock on the bottom two doors, and taking that place
   puts the player who held it off the ladder — they come back the same
   way everyone else gets on. */
function ruleCheck(doc, winnerName, loserName) {
  const w = find(doc, winnerName), l = find(doc, loserName);
  if (!winnerName || !loserName) return { ok: false, why: 'Both players are needed.' };
  if (key(winnerName) === key(loserName)) return { ok: false, why: 'A player can’t challenge themselves.' };
  if (!w && !l) return { ok: false, why: 'Neither player is on the ladder.' };

  if (w && l) {
    const low = w.rank > l.rank ? w : l;      /* the challenger */
    const high = low === w ? l : w;
    if (low.rank - high.rank !== 1) {
      return { ok: false, why: `${low.name} is #${low.rank} and ${high.name} is #${high.rank} — a challenge can only go up one place.` };
    }
    return low === w
      ? { ok: true, effect: 'swap', detail: `${w.name} takes #${high.rank}, ${l.name} drops to #${low.rank}.` }
      : { ok: true, effect: 'hold', detail: `${w.name} holds #${w.rank}.` };
  }

  /* One of them isn't on the ladder. Whoever that is, they can only
     have knocked on the bottom two doors. */
  const outsider = clean(w ? loserName : winnerName);
  const holder = w || l;
  const bottomTwo = holder.rank >= SIZE - 1;

  if (!w) {
    /* The player off the ladder won it. */
    if (!bottomTwo) {
      return { ok: false, why: `${outsider} isn\u2019t on the ladder, so the challenge has to be to #${SIZE - 1} or #${SIZE}.` };
    }
    return { ok: true, effect: 'enter',
      detail: `${clean(winnerName)} takes #${holder.rank}; ${holder.name} comes off the ladder.` };
  }

  /* The player off the ladder lost: nothing moves. */
  if (!bottomTwo) {
    return { ok: false, why: `${outsider} isn\u2019t on the ladder, so the challenge has to be to #${SIZE - 1} or #${SIZE}.` };
  }
  return { ok: true, effect: 'hold', detail: `${holder.name} holds #${holder.rank}.` };
}

function applyMatch(doc, m) {
  const check = ruleCheck(doc, m.winner, m.loser);
  if (!check.ok && !m.force) return { error: check.why };

  const w = find(doc, m.winner), l = find(doc, m.loser);
  const rec = {
    id: 'm' + Date.now().toString(36),
    date: m.date || today(),
    winner: w ? w.name : clean(m.winner),
    loser:  l ? l.name : clean(m.loser),
    score: m.forfeit ? null : parseScore(m.score),
    note: clean(m.note || ''),
    forfeit: !!m.forfeit,
    forced: !!m.force && !check.ok,
  };

  const effect = check.ok ? check.effect : (w && l ? (w.rank > l.rank ? 'swap' : 'hold') : (w ? 'hold' : 'enter'));

  if (effect === 'swap' && w && l) {
    rec.from = w.rank; rec.to = l.rank;
    const wi = doc.players.indexOf(w), li = doc.players.indexOf(l);
    doc.players[wi] = l; doc.players[li] = w;
    renumber(doc);
  } else if (effect === 'enter' && l) {
    rec.from = null; rec.to = l.rank; rec.dropped = l.name;
    doc.players[doc.players.indexOf(l)] =
      { name: clean(m.winner), rank: l.rank, since: rec.date, w: 0, l: 0 };
    renumber(doc);
  } else {
    rec.from = w ? w.rank : null; rec.to = w ? w.rank : null;
  }

  /* Records follow the player, wherever they end up. */
  if (!rec.forfeit) {
    const wNow = find(doc, rec.winner), lNow = find(doc, rec.loser);
    if (wNow) wNow.w = (wNow.w || 0) + 1;
    if (lNow) lNow.l = (lNow.l || 0) + 1;
  }

  doc.matches.unshift(rec);
  /* A place handed over on a forfeit isn't a match anyone paid for. */
  if (!rec.forfeit) doc.potMatches = (doc.potMatches || 0) + 1;
  return { match: rec, detail: check.detail || '' };
}

/* ── a player puts their own match up ───────────────────────────────
   No password: anyone who played may report it. It goes nowhere near
   the ladder until an officer approves it, so the worst a bad entry
   can do is waste an officer ten seconds. The rules are checked here
   all the same, so the player is told straight away if the challenge
   wasn't a legal one. */
async function submit(env, doc, body) {
  const winner = clean(body.winner), loser = clean(body.loser);
  if (!winner || !loser) return json({ ok: false, error: 'Both names are needed.' }, 400);
  if (key(winner) === key(loser)) return json({ ok: false, error: 'That\u2019s the same player twice.' }, 400);

  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !asDate(date)) {
    return json({ ok: false, error: 'The date the match was played is needed.' }, 400);
  }
  if (date > today()) return json({ ok: false, error: 'That date hasn\u2019t happened yet.' }, 400);

  const check = ruleCheck(doc, winner, loser);
  if (!check.ok) return json({ ok: false, error: check.why }, 400);

  const already = (doc.pending || []).some(x =>
    key(x.winner) === key(winner) && key(x.loser) === key(loser) && x.date === date);
  if (already) return json({ ok: false, error: 'That match is already waiting on an officer.' }, 409);
  if ((doc.pending || []).length >= MAX_PENDING) {
    return json({ ok: false, error: 'There are too many matches waiting already \u2014 catch an officer.' }, 429);
  }

  doc.pending = [{
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    winner, loser, date,
    score: parseScore(body.score),
    at: new Date().toISOString(),
    will: check.detail || '',
  }, ...(doc.pending || [])];

  /* Not on the undo stack: a submission changes nothing an officer
     would want to roll back. */
  await write(env, doc, null);
  return json({
    ok: true,
    said: 'Thanks \u2014 an officer will check it, then it shows up on the ladder.',
    ladder: publicView(doc),
  });
}

export async function onRequestOptions() { return json({ ok: true }); }

export async function onRequestGet({ env }) {
  try {
    return json({ ok: true, ladder: publicView(await read(env)) });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }

  let doc;
  try { doc = await read(env); }
  catch (e) { return json({ ok: false, error: e.message }, 500); }

  const action = String(body.action || '');

  /* The one thing the public may post. */
  if (action === 'submit') {
    try { return await submit(env, doc, body); }
    catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  if ((request.headers.get('X-League-Pass') || '') !== pass(env)) {
    return json({ ok: false, error: 'Wrong password.' }, 401);
  }

  const before = JSON.parse(JSON.stringify(doc));
  let said = '';

  switch (action) {

    /* Does this password work? Changes nothing. */
    case 'ping':
      return json({ ok: true, said: '', ladder: adminView(doc) });

    /* Start the ladder from the names the officer picked off the
       standings. Only allowed on an empty ladder unless they mean it. */
    case 'seed': {
      const names = (Array.isArray(body.players) ? body.players : [])
        .map(clean).filter(Boolean).slice(0, SIZE);
      if (names.length < 2) return json({ ok: false, error: 'Needs at least two players.' }, 400);
      if (doc.players.length && !body.force) {
        return json({ ok: false, error: 'The ladder already has players on it. Tick the box to start it over.' }, 409);
      }
      doc.players = names.map((n, i) => ({ name: n, rank: i + 1, since: today(), w: 0, l: 0 }));
      doc.seededAt = today();
      doc.matches = body.keepHistory ? doc.matches : [];
      if (!body.keepHistory) { doc.payouts = []; doc.potMatches = 0; }
      said = `Ladder started with ${names.length} players.`;
      break;
    }

    /* A challenge goes out on Facebook or straight to the player, and
       they have 48 hours to answer and get a night in the book. If they
       don't, the place changes hands with no match played — so no
       money moves and nothing goes in the envelope. */
    case 'forfeit': {
      const out = applyMatch(doc, {
        winner: body.challenger, loser: body.holder, date: body.date,
        note: body.note, force: body.force, forfeit: true,
      });
      if (out.error) return json({ ok: false, error: out.error }, 400);
      said = `${clean(body.holder)} didn’t answer inside 48 hours. ` + (out.detail || '');
      break;
    }

    case 'match': {
      const out = applyMatch(doc, body);
      if (out.error) return json({ ok: false, error: out.error }, 400);
      said = out.detail || 'Match recorded.';
      break;
    }

    /* A match a player put up, now signed off. The officer may fix the
       score or the date on the way through. */
    case 'approve': {
      const at = (doc.pending || []).findIndex(x => x.id === String(body.id || ''));
      if (at < 0) return json({ ok: false, error: 'That one is gone \u2014 another officer may have handled it.' }, 404);
      const p = doc.pending[at];
      const out = applyMatch(doc, {
        winner: p.winner, loser: p.loser,
        date: body.date || p.date,
        score: body.score === undefined ? p.score : body.score,
        force: body.force,
      });
      if (out.error) return json({ ok: false, error: out.error }, 400);
      doc.pending.splice(at, 1);
      said = `${p.winner} over ${p.loser} approved. ` + (out.detail || '');
      break;
    }

    /* Didn't happen, or didn't happen like that. */
    case 'decline': {
      const at = (doc.pending || []).findIndex(x => x.id === String(body.id || ''));
      if (at < 0) return json({ ok: false, error: 'That one is gone \u2014 another officer may have handled it.' }, 404);
      const p = doc.pending[at];
      doc.pending.splice(at, 1);
      said = `${p.winner} over ${p.loser} turned down.`;
      break;
    }

    /* Someone quit, moved away, or went on the list by mistake. */
    case 'remove': {
      const p = find(doc, body.name);
      if (!p) return json({ ok: false, error: 'Not on the ladder.' }, 404);
      doc.players.splice(doc.players.indexOf(p), 1);
      renumber(doc);
      said = `${p.name} removed.`;
      break;
    }

    /* Fill an empty place, or add a name to the bottom. */
    case 'add': {
      const name = clean(body.name);
      if (!name) return json({ ok: false, error: 'Needs a name.' }, 400);
      if (find(doc, name)) return json({ ok: false, error: 'Already on the ladder.' }, 409);
      if (doc.players.length >= SIZE && !body.force) {
        return json({ ok: false, error: `The ladder is full at ${SIZE}. Someone has to come off first.` }, 409);
      }
      const at = Math.max(1, Math.min(doc.players.length + 1, parseInt(body.rank) || doc.players.length + 1));
      doc.players.splice(at - 1, 0, { name, rank: at, since: today(), w: 0, l: 0 });
      renumber(doc);
      said = `${name} added at #${at}.`;
      break;
    }

    /* A hand correction: put a player at a place and shuffle the rest. */
    case 'move': {
      const p = find(doc, body.name);
      if (!p) return json({ ok: false, error: 'Not on the ladder.' }, 404);
      const to = Math.max(1, Math.min(doc.players.length, parseInt(body.rank) || p.rank));
      doc.players.splice(doc.players.indexOf(p), 1);
      doc.players.splice(to - 1, 0, p);
      renumber(doc);
      said = `${p.name} moved to #${to}.`;
      break;
    }

    /* Close the week out: the envelope goes to whoever is on top. */
    case 'payout': {
      const on = body.date || today();
      const week = weekOf(on);
      /* Everything still unpaid that was played on or before the
         Tuesday being closed out. */
      const covered = (doc.matches || []).filter(m =>
        !m.forfeit && !m.paid && String(m.date || '') <= week.end);
      const amount = body.amount != null
        ? Math.max(0, parseInt(body.amount) || 0)
        : covered.length * PER_MATCH;
      const winner = clean(body.winner) || (doc.players[0] ? doc.players[0].name : '');
      if (!winner) return json({ ok: false, error: 'Nobody on the ladder to pay.' }, 400);
      doc.payouts.unshift({
        date: on, amount, winner, matches: covered.length,
        weekStart: week.start, weekEnd: week.end, note: clean(body.note || ''),
      });
      const stamp = `${week.start}:${on}`;
      covered.forEach(m => { m.paid = stamp; });
      doc.paidThrough = week.end;
      doc.potMatches = 0;
      said = `$${amount} to ${winner} for the week of ${week.start}.`;
      break;
    }

    /* Straight back to how it was before the last change. */
    case 'undo': {
      const stack = doc.undo || [];
      if (!stack.length) return json({ ok: false, error: 'Nothing to undo.' }, 400);
      const prev = JSON.parse(stack[0]);
      prev.undo = stack.slice(1);
      await write(env, prev, null);
      return json({ ok: true, said: 'Last change undone.', ladder: adminView(prev) });
    }

    /* The note at the top of the public page. */
    case 'notice': {
      doc.notice = clean(body.notice || '').slice(0, 280);
      said = doc.notice ? 'Notice updated.' : 'Notice cleared.';
      break;
    }

    default:
      return json({ ok: false, error: 'Unknown action.' }, 400);
  }

  await write(env, doc, before);
  return json({ ok: true, said, ladder: adminView(doc) });
}
