/* ═══════════════════════════════════════════════════════════════
   Corrections to what FargoRate sends us.

   Jenkins typed a team name wrong when the 2026-27 division was set
   up. Rather than live with it on every standings table, schedule and
   stat sheet, the reports get patched as they arrive — one pass over
   the HTML before anything parses it.

   Delete an entry the day it's fixed at the source; delete the file
   when the list is empty. Nothing else depends on it.

   fargo-fixes v1.01
   ═══════════════════════════════════════════════════════════════ */

window.FARGO_FIXES = [
  /* their spelling                        what it should read */
  [/Brytches\s+and\s+Brytches/gi,          'Bytches &amp; Brytches'],
];

/* For a report fetched as HTML, before it is parsed. The replacement
   is written as HTML, so an ampersand goes in as &amp; and comes back
   out of textContent as "&". */
window.fixFargoHtml = function (html) {
  return window.FARGO_FIXES.reduce((out, [from, to]) => out.replace(from, to), String(html));
};

/* ───────────────────────────────────────────────────────────────
   The other half: the schedule itself.

   The posted schedule splits a night across two date headings and
   parks one match on the Thanksgiving week, where nobody plays. The
   matches are right; the dates they're filed under aren't. Rather
   than show the league a schedule we know is wrong, each report gets
   put back in order on the way in.

   To retire a move once Jenkins fixes it at the source, delete its
   line. A move that finds nothing does nothing, so an entry left
   behind can't hurt — and nights split in two are merged whatever
   the list says.
   ─────────────────────────────────────────────────────────────── */

window.SCHEDULE_FIXES = [
  /* this match …                                  … is filed here  … and belongs here */
  { home: '8Ball Magic', away: 'Pit Masters',       from: '2026-11-25', to: '2026-12-02',
    why: 'Thanksgiving week is off; this is the fourth Dec 2 match' },
];

/* Team names come back spelled every which way between reports. */
function schedTeam(name) {
  return String(name || '').toLowerCase()
    .replace(/&/g, 'and').replace(/\band\b/g, '').replace(/[^a-z0-9]/g, '');
}
/* "Wednesday, December 2, 2026" → "2026-12-02". */
function schedIso(text) {
  const d = new Date(String(text || '').replace(/^[a-z]+,\s*/i, '').trim());
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function schedLabel(iso) {
  const p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* Takes the parsed schedule — [{ date, matches: [{ home, away, … }] }] —
   and gives back the same shape with the nights put right. */
window.fixFargoBlocks = function (blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return blocks;

  const work = blocks.map(b => ({ ...b, iso: schedIso(b.date), matches: [...(b.matches || [])] }));

  /* 1. Lift out every match that's filed under the wrong night. */
  const moved = {};
  (window.SCHEDULE_FIXES || []).forEach(fix => {
    const h = schedTeam(fix.home), a = schedTeam(fix.away);
    work.forEach(b => {
      if (b.iso !== fix.from) return;
      for (let i = b.matches.length - 1; i >= 0; i--) {
        const m = b.matches[i];
        const mh = schedTeam(m.home), ma = schedTeam(m.away);
        if ((mh === h && ma === a) || (mh === a && ma === h)) {
          (moved[fix.to] = moved[fix.to] || []).push(b.matches.splice(i, 1)[0]);
        }
      }
    });
  });

  /* 2. One night, one heading — a date that appears twice is one
        week's matches split in two. */
  const byIso = [];
  const seen = {};
  work.forEach(b => {
    const key = b.iso || ('raw:' + b.date);
    if (seen[key]) { seen[key].matches.push(...b.matches); return; }
    seen[key] = b;
    byIso.push(b);
  });

  /* 3. Put the lifted matches down where they belong. */
  Object.keys(moved).forEach(iso => {
    let target = seen[iso];
    if (!target) {
      target = { date: schedLabel(iso), iso, matches: [] };
      seen[iso] = target;
      byIso.push(target);
    }
    target.matches.push(...moved[iso]);
  });

  /* 4. The same match listed twice on one night counts once. The copy
        carrying a match id wins, since that's the one with a sheet. */
  byIso.forEach(b => {
    const keep = [];
    b.matches.forEach(m => {
      const k = schedTeam(m.home) + '|' + schedTeam(m.away);
      const had = keep.findIndex(x => schedTeam(x.home) + '|' + schedTeam(x.away) === k);
      if (had < 0) { keep.push(m); return; }
      if (!keep[had].matchId && m.matchId) keep[had] = m;
    });
    b.matches = keep;
  });

  /* 5. A night with nothing left on it isn't a night. */
  const out = byIso.filter(b => b.matches.length);

  /* 6. In date order, whatever order they arrived in. */
  out.sort((x, y) => (x.iso && y.iso) ? x.iso.localeCompare(y.iso) : 0);
  return out;
};

/* For a name already pulled out of the markup as plain text. */
window.fixFargoText = function (text) {
  return window.FARGO_FIXES
    .reduce((out, [from, to]) => out.replace(from, to.replace(/&amp;/g, '&')), String(text));
};
