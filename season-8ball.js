/* ═══════════════════════════════════════════════════════════════
   8-Ball Fall/Winter 2026-27 — the season, in one place.

   index.html reads this for the "This Wednesday" panel and
   team-schedule.html reads it for each team's own sheet, so a
   correction is made once and both pages follow.

   Teams are numbered the way the Jenkins schedule sheet numbers
   them. Each week lists [home, visitor]; an empty week is a night
   off and OFF_NOTES says why.

   When Jenkins has the division up on FargoRate, both pages can go
   back to reading it live and this file retires.
   season-8ball v1.00
   ═══════════════════════════════════════════════════════════════ */

window.SEASON_8BALL = {
  label: '8-Ball Fall/Winter 2026–27',

  teams: {
    1: { name: 'Stock Sticks',         bar: 'Stock Exchange', captain: 'Bill Abriani',    slug: 'stock-sticks' },
    2: { name: 'Bytches & Brytches',   bar: 'Grumpies',       captain: 'Kylee Smith',     slug: 'bytches-brytches' },
    3: { name: 'English Teachers',     bar: 'Sage Lanes',     captain: 'Tanner Hansen',   slug: 'english-teachers' },
    4: { name: '8 Ball Magic',         bar: 'Grumpies',       captain: 'Rylee Roberts',   slug: '8-ball-magic' },
    5: { name: 'Rack Pack',            bar: 'Stock Exchange', captain: 'Andy Cass',       slug: 'rack-pack' },
    6: { name: 'Chalk is Cheap',       bar: 'Grumpies',       captain: 'Sable Abeyta',    slug: 'chalk-is-cheap' },
    7: { name: 'Three Dads and a Mitch', bar: 'Sage Lanes',   captain: 'Trevor Connelly', slug: 'three-dads-and-a-mitch' },
    8: { name: 'Pit Masters',          bar: 'Sage Lanes',     captain: 'Jeff Christen',   slug: 'pit-masters' },
  },

  weeks: [
    ['2026-10-21', [[1,8],[2,7],[3,6],[4,5]]],
    ['2026-10-28', [[1,2],[6,4],[7,3],[8,5]]],
    ['2026-11-04', [[2,8],[3,1],[4,7],[5,6]]],
    ['2026-11-11', [[1,4],[2,3],[7,5],[8,6]]],
    ['2026-11-18', [[3,8],[4,2],[5,1],[6,7]]],
    ['2026-11-25', []],
    ['2026-12-02', [[4,8],[5,3],[6,2],[7,1]]],
    ['2026-12-09', [[1,6],[2,5],[3,4],[8,7]]],
    ['2026-12-16', [[5,4],[6,3],[7,2],[8,1]]],
    ['2026-12-23', [[2,1],[3,7],[4,6],[5,8]]],
    ['2026-12-30', [[1,3],[6,5],[7,4],[8,2]]],
    ['2027-01-06', [[3,2],[4,1],[5,7],[6,8]]],
    ['2027-01-13', [[1,5],[2,4],[7,6],[8,3]]],
    ['2027-01-20', [[1,7],[2,6],[3,5],[8,4]]],
    ['2027-01-27', [[4,3],[5,2],[6,1],[7,8]]],
    ['2027-02-03', [[1,8],[2,7],[3,6],[4,5]]],
    ['2027-02-10', [[1,2],[6,4],[7,3],[8,5]]],
    ['2027-02-17', [[2,8],[3,1],[4,7],[5,6]]],
    ['2027-02-24', [[1,4],[2,3],[7,5],[8,6]]],
    ['2027-03-03', [[3,8],[4,2],[5,1],[6,7]]],
    ['2027-03-10', [[4,8],[5,3],[6,2],[7,1]]],
    ['2027-03-17', [[1,6],[2,5],[3,4],[8,7]]],
  ],

  offNotes: { '2026-11-25': 'Thanksgiving week — no play' },

  /* A date with no time zone in it, so a Wednesday never slides a day. */
  day(iso) { const p = iso.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); },

  /* The week being played now, or the next one to come. On a Wednesday
     it stays on that night all day rather than jumping ahead. */
  current() {
    const t = new Date(); t.setHours(0,0,0,0);
    return this.weeks.find(w => this.day(w[0]) >= t) || null;
  },

  /* Playing weeks only, so Mar 17 is week 21 and the Thanksgiving
     week has no number at all. */
  weekNumber(iso) {
    let n = 0;
    for (const [d, games] of this.weeks) {
      if (games.length) n++;
      if (d === iso) return games.length ? n : 0;
    }
    return 0;
  },

  /* Every night for one team: home or away, who, and which bar. */
  season(team) {
    const out = [];
    this.weeks.forEach(([iso, games]) => {
      if (!games.length) { out.push({ iso, off: true }); return; }
      games.forEach(([h,v]) => {
        if (h === team || v === team) {
          out.push({ iso, home: h === team, opp: h === team ? v : h, bar: this.teams[h].bar });
        }
      });
    });
    return out;
  },
};
