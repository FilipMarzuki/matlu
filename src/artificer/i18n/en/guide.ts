/**
 * English for the first-morning guide (#1792, artificer-app/reveal.ts, ui switch
 * `guide`): the line each element of the Plan screen says the first time it appears,
 * in the scout's own voice (one or two short lines), and the guide's controls under the help (?).
 */
export const guide = {
  // ── The lines, one per element (reveal.ts REVEALS) ─────────────────────────
  'guide.line.weather': "First thing, every morning: look at the sky. The leader always says the weather decides what the day can be.",
  'guide.line.vitals': "Your body and your head. Both run down with work, and the cold eats at them at night.",
  'guide.line.focus': "What your mind is on. Out here, staying alive comes first.",
  'guide.line.actions': "Start with the one that's glowing: get to know the land, and look for a dry place to sleep.",
  'guide.line.today': "One thing at a time for now. When you've done enough, end the day.",
  'guide.line.queue': "You're thinking a step ahead now: line up the day's work here.",
  'guide.line.runDay': "That's a plan. Run the day and see how it goes.",
  'guide.line.journal': "What happened, written down. Worth a look each morning.",
  'guide.line.stores': "What you've got laid by. Supper comes out of this every night.",
  'guide.line.sites': "A place you could camp. Make camp before the nights get really cold.",
  'guide.line.tools': "What you've made, and what making it taught you.",
  'guide.ok': 'OK',
  'guide.label': 'A tip from the scout',

  // ── Under the help (?) ─────────────────────────────────────────────────────
  'guide.head': 'THE GUIDE',
  'guide.playedBefore': "I've played before",
  'guide.playedBeforeTip': 'Show everything from the start, with no tips',
  'guide.again': 'Show the guide again',
  'guide.againTip': 'The tips come back, one at a time',
} as const satisfies Record<string, string>;
