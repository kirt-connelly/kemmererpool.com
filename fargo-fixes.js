/* ═══════════════════════════════════════════════════════════════
   Corrections to what FargoRate sends us.

   Jenkins typed a team name wrong when the 2026-27 division was set
   up. Rather than live with it on every standings table, schedule and
   stat sheet, the reports get patched as they arrive — one pass over
   the HTML before anything parses it.

   Delete an entry the day it's fixed at the source; delete the file
   when the list is empty. Nothing else depends on it.

   fargo-fixes v1.00
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

/* For a name already pulled out of the markup as plain text. */
window.fixFargoText = function (text) {
  return window.FARGO_FIXES
    .reduce((out, [from, to]) => out.replace(from, to.replace(/&amp;/g, '&')), String(text));
};
