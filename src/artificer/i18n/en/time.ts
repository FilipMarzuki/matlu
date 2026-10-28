/**
 * English for the time of day in words (#1740, switch `time-words`): the queue box's "now" line,
 * each task's length, where the day's plan ends, and the action buttons, the status bar and the
 * timer, instead of hours, until the Warden has a way to tell the hour.
 *
 * Built from the bands in time-words.ts (the part of the day, the light, a task's span). The AI
 * reads the same keys in English.
 */
export const time = {
  // Now: the part of the day, and the light in the early morning and the evening.
  'time.now.early.dark': 'Early morning, still dark.',
  'time.now.early.grey': 'Early morning, the first grey light.',
  'time.now.early.sun': 'Early morning, the sun just up.',
  'time.now.morning': 'Morning, the sun climbing.',
  'time.now.midday': 'Around midday, the sun as high as it gets.',
  'time.now.afternoon': 'Afternoon, the shadows lengthening.',
  'time.now.evening.sun': 'Evening, the sun low over the trees.',
  'time.now.evening.dusk': 'Dusk, the light going.',
  'time.now.night': 'Night has fallen.',
  // The part of the day in a word or two: the status bar and the timer's clock.
  'time.short.early': 'EARLY MORNING',
  'time.short.morning': 'MORNING',
  'time.short.midday': 'MIDDAY',
  'time.short.afternoon': 'AFTERNOON',
  'time.short.evening': 'EVENING',
  'time.short.night': 'NIGHT',
  // How long a task takes, from when it starts.
  'time.moment': 'a short while',
  'time.most': 'most of the day',
  'time.all.morning': 'all morning',
  'time.all.midday': 'the midday hours',
  'time.all.afternoon': 'all afternoon',
  'time.all.evening': 'all evening',
  'time.all.night': 'long after dark',
  'time.part.morning': 'part of the morning',
  'time.part.midday': 'around midday',
  'time.part.afternoon': 'part of the afternoon',
  'time.part.evening': 'part of the evening',
  'time.part.night': 'a while after dark',
  'time.rest.morning': 'the rest of the morning',
  'time.rest.midday': 'the rest of midday',
  'time.rest.afternoon': 'the rest of the afternoon',
  'time.rest.evening': 'the rest of the evening',
  'time.rest.night': 'on into the night',
  // Across parts of the day: "{from} and into {to}", "from {from} until {until}".
  'time.into': '{from} and into {to}',
  'time.span': 'from {from} until {until}',
  'time.pastDark': 'from {from} until past dark',
  'time.from.morning': 'the morning',
  'time.from.midday': 'midday',
  'time.from.afternoon': 'the afternoon',
  'time.from.evening': 'the evening',
  'time.to.midday': 'midday',
  'time.to.afternoon': 'the afternoon',
  'time.to.evening': 'the evening',
  'time.until.afternoon': 'the afternoon',
  'time.until.evening': 'dusk',
  // Where today's plan ends.
  'time.end.early': "You'd be done early in the morning.",
  'time.end.morning': "You'd be done before midday.",
  'time.end.midday': "You'd be done around midday.",
  'time.end.afternoon': "You'd be done in the afternoon.",
  'time.end.evening': "You'd be done around dusk.",
  'time.end.night': 'This runs past dark.',
  // The empty queue, without the day's hours.
  'time.queueEmpty': "Empty — tap actions to plan. What doesn't fit in today spills into the next day, and you sleep between.",
  // The AI's observation and the API's text: the label before the "now" line.
  'time.label': 'Time of day',

  // ── The day's result as a card (#1929, ui switch `day-card`, artificer-app/day-card.ts) ──
  'daycard.title': 'Day {n} is done',
  'daycard.titleDays': 'Days {from}–{to} are done',
  'daycard.brought': 'Brought back',
  'daycard.night': 'The night',
  'daycard.tomorrow': 'Tomorrow',
  // A key metric's change, `{n}` already signed: "+3 food", "−4 firewood".
  'daycard.food': '{n} food',
  'daycard.water': '{n} water',
  'daycard.firewood': '{n} firewood',
  'daycard.nothing': 'Nothing brought back today.',
  'daycard.quiet': 'A quiet night.',
  'daycard.more': '…and {n} more in the journal.',
  'daycard.journal': 'Journal',
  'daycard.ok': 'On to day {n} ▸',
  // The journal as a sheet, one tap from the status bar.
  'jsheet.open': 'Journal',
  'jsheet.title': 'Journal',
  'jsheet.close': 'Close',
};
