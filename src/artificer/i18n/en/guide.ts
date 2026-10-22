/**
 * English for the first-morning guide (#1792, artificer-app/reveal.ts, ui switch
 * `guide`): the line each element of the Plan screen says the first time it appears,
 * in the scout's own voice (one or two short lines), and the guide's controls under the help (?).
 */
export const guide = {
  // ── The lines, one per element (reveal.ts REVEALS) ─────────────────────────
  'guide.line.weather': "First thing, every morning: look at the sky. The leader always says the weather decides what the day can be.",
  'guide.line.vitals': "That took something out of you. Body and head run down with work, and the cold eats at them at night.",
  'guide.line.focus': "What your mind is on. Out here, staying alive comes first.",
  'guide.line.actions': "Start with the one that's glowing: get to know the land, and look for a dry place to sleep.",
  'guide.line.today': "One thing at a time for now. When you've done enough, end the day.",
  'guide.line.queue': "You're thinking a step ahead now: line up the day's work here.",
  'guide.line.runDay': "That's a plan. Run the day and see how it goes.",
  'guide.line.journal': "What happened, written down. Worth a look each morning.",
  'guide.line.stores': "What you've got laid by. Supper comes out of this every night.",
  'guide.line.sites': "A place you could camp. Make camp before the nights get really cold.",
  'guide.line.tools': "What you've made, and what making it taught you.",
  // ── The tabs, the first time each shows (#1794) ──
  'guide.line.camp': "Camp's made. All of it lives here now: the fire, the stores, the shelter you build.",
  'guide.line.land': "What you know of the land around you. Every trip out adds to it.",
  'guide.line.progress': "A few days in. Here's how the year is going, and what winter will still ask of you.",
  // ── Just-in-time tips for the rest of the run (#1794) ──
  'guide.line.injury': "You're hurt. Treat it before it gets worse, and go easy on it for a few days.",
  'guide.line.lock': "Something's gone badly wrong: survival has your whole mind now. Put that right and your focus comes back.",
  'guide.line.cold': "Frost tonight. A fire and a good roof keep it off: get firewood in before dark.",
  'guide.line.snow': "The snow has come to stay. Keep close to camp, keep the fire fed, and make what you've laid by last.",
  'guide.line.skill': "You get better at a thing by doing it. Put your focus on a skill and practice teaches you three times as much.",
  'guide.line.longQueue': "That's more than a day's work. Whatever doesn't fit today carries over to tomorrow.",
  'guide.ok': 'OK',
  'guide.label': 'A tip from the scout',

  // ── Under the help (?) ─────────────────────────────────────────────────────
  'guide.head': 'THE GUIDE',
  'guide.playedBefore': "I've played before",
  'guide.playedBeforeTip': 'Show everything from the start, with no tips',
  'guide.again': 'Show the guide again',
  'guide.againTip': 'The tips come back, one at a time',
} as const satisfies Record<string, string>;
