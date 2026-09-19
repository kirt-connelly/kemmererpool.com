/**
 * GET /api/officers — the list of officer tools for officers.html.
 *
 * The list lives here rather than in the page so nobody can read the
 * addresses out of the page source without the league password (same
 * X-League-Pass check as leagueadmin.html: 'ktown', or LEAGUE_ADMIN_PW /
 * LEAGUE_KEY if set in the Pages environment variables).
 *
 * Add a page: add a line to the right section below. That's all.
 */

const DEFAULT_PW = 'ktown';

const SECTIONS = [
  {
    title: 'Sign-ups',
    links: [
      { href: 'leagueadmin.html', name: 'League Signup Admin', note: '8-Ball Fall/Winter 2026–27 teams, players looking and subs' },
      { href: 'tricityadmin.html', name: 'Tri City Admin', note: 'Tri City teams, rosters, paid, reported wins' },
      { href: 'league-signup.html', name: '8-Ball Signup', note: 'Public form: team, player or sub', public: true },
      { href: 'tricity.html?e=kemmerer', name: 'Tri City Signup — Kemmerer', note: 'Public team signup with Fargo lookup', public: true },
      { href: 'tricity-roster.html?e=kemmerer', name: 'Tri City Rosters — Kemmerer', note: 'Every team, one printed page each, with QR codes' },
    ],
  },
  {
    title: 'Tournament tools',
    links: [
      { href: 'admin.html', name: 'Tournament and Sign Up Admin', note: 'Create tournaments and signup sheets, codes and scoring links' },
      { href: 'tournament.html', name: 'Tournament (Fargo Rate Races)', note: 'Bracket with races set by Fargo' },
      { href: 'bracket.html', name: 'Tournament (Custom Races)', note: 'Bracket with races you set' },
      { href: 'chip.html', name: 'Chip Tournament', note: 'Winner-stays-on chip manager' },
      { href: 'tv.html', name: 'Tournament Board', note: 'TV view — needs a tournament code' },
      { href: 'signup.html', name: 'Tournament Signup', note: 'Signup sheet — needs a signup code', public: true },
      { href: 'calcutta.html', name: 'Calcutta Tracker', note: 'Auction, payments and payouts. Kept on the device you use it on' },
    ],
  },
  {
    title: 'Tri City tournament day',
    links: [
      { href: 'tricity-match.html?e=kemmerer', name: 'Handicap — Kemmerer', note: 'What the handicap QR opens' },
      { href: 'tricity-win.html?e=kemmerer', name: 'Report a Win — Kemmerer', note: 'What the report-a-win QR opens' },
    ],
  },
  {
    title: 'Public site',
    links: [
      { href: 'index.html', name: 'Home', public: true },
      { href: 'league.html?lg=8ball', name: '8-Ball League', note: 'Standings, players, ratings', public: true },
      { href: 'league.html?lg=10ball', name: '10-Ball League', public: true },
      { href: 'schedule.html?league=8ball', name: 'Schedule', public: true },
      { href: 'tournaments.html', name: 'Tournaments', public: true },
    ],
  },
];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const given = request.headers.get('X-League-Pass') || '';
  const ok = given && (given === (env.LEAGUE_ADMIN_PW || DEFAULT_PW) || (!!env.LEAGUE_KEY && given === env.LEAGUE_KEY));
  if (!ok) return json({ ok: false, error: 'That password was not accepted.' }, 403);
  return json({ ok: true, sections: SECTIONS });
}
