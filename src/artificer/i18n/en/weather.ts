/**
 * English for the weather in words (#1729, switch `weather-words`): the WEATHER box that replaces
 * the season strip and its numbers until the Warden earns them, and the header chip in words.
 *
 * Built from the sim's bands (weather-words.ts: the sky, the cold as felt, the snow underfoot, the
 * season as sensed, the tally), so these are its words. The sim still writes the same English
 * itself for the AI (`weatherReport().lines`); a test checks that these keys, filled with English,
 * say exactly that.
 */
export const weather = {
  'wx.head': 'WEATHER',
  // The sky and the wind: today's weather, by its winter name once winter has come.
  'wx.sky.clear': 'Clear skies, hardly a breath of wind.',
  'wx.sky.overcast': 'Cloudy, with a light breeze.',
  'wx.sky.rain': 'Rain from a low grey sky.',
  'wx.sky.fog': 'Fog lies thick over the ground, still and grey.',
  'wx.sky.wind': 'Cloudy and windy.',
  'wx.sky.storm': 'Stormy: rain driven sideways on a hard wind.',
  'wx.sky.storm.winter': 'A blizzard: snow on a howling wind, and you can barely see.',
  'wx.sky.snow': "Wet snow is falling, though it won't lie long.",
  'wx.sky.snow.winter': 'Snow is falling, soft and steady.',
  // The cold as you feel it in the morning, warmest first.
  'wx.felt.mild': 'Cool and fresh in the morning, mild by midday.',
  'wx.felt.cool': 'Cool; you can see your breath in the morning.',
  'wx.felt.chilly': "Cold; there's frost on the grass at dawn.",
  'wx.felt.frosty': 'Frosty; the puddles are iced over in the morning.',
  'wx.felt.hard': 'A hard frost; the cold bites at your face and fingers.',
  'wx.felt.bitter': 'Bitter cold; the air hurts to breathe and your lashes frost over.',
  // The snow underfoot.
  'wx.ground.thin': 'A thin cover of snow on the ground.',
  'wx.ground.ankle': 'The snow is ankle-deep.',
  'wx.ground.knee': 'The snow is knee-deep in places.',
  'wx.ground.deep': 'Deep snow everywhere; every step is wading.',
  // The season as you sense it.
  'wx.season.early': 'The birches are just starting to turn; it feels like early autumn.',
  'wx.season.mid': 'The birches are gold and the evenings are drawing in; autumn is well under way.',
  'wx.season.late': 'The birches are nearly bare; it feels like autumn closing in on winter.',
  'wx.season.snowSoon': "The leaves are down and the ground is hard in the mornings. The first snow can't be far off.",
  'wx.season.firstWinter': "The snow has come to stay; it's winter now.",
  'wx.season.deep': 'The days are as short as they get; this is the depth of winter.',
  'wx.season.lateWinter': 'The days are drawing out again, though the cold holds.',
  'wx.season.thawSoon': "The sun has some warmth in it at midday. The thaw can't be far off.",
  'wx.season.thaw': 'The snow is going; the thaw has come.',
  // Counting the days.
  'wx.noTally': "You've lost track of the date. You cut a notch in a stick each morning; give it a week and you'll trust the count.",
  'wx.tally.notebook': 'Day {n}, by the notebook.',
  'wx.tally.notches': 'Day {n}, by the notches on your stick.',
  'wx.toSnow.one': 'About a day to the first snow.',
  'wx.toSnow.other': 'About {n} days to the first snow.',
  'wx.toThaw.one': 'About a day to the thaw.',
  'wx.toThaw.other': 'About {n} days to the thaw.',
  // The header chip in words, and with a tally the snow's rough count.
  'wx.chip.early': 'EARLY AUTUMN',
  'wx.chip.mid': 'AUTUMN',
  'wx.chip.late': 'LATE AUTUMN',
  'wx.chip.snowSoon': 'LATE AUTUMN · SNOW SOON',
  'wx.chip.firstWinter': 'WINTER',
  'wx.chip.deep': 'DEEP WINTER',
  'wx.chip.lateWinter': 'LATE WINTER',
  'wx.chip.thawSoon': 'LATE WINTER · THAW SOON',
  'wx.chip.thaw': 'THE THAW',
  'wx.chip.snowIn.one': '{season} · SNOW IN ABOUT A DAY',
  'wx.chip.snowIn.other': '{season} · SNOW IN ABOUT {n} DAYS',
  // The season strip once it's earned: each day's bar, without its hours of light.
  'wx.dayTip': 'Day {d}',
  // The condensed box (#1788): one row of icon chips, each a short word; the full sentence is its tooltip.
  'wx.short.felt.mild': 'Mild',
  'wx.short.felt.cool': 'Cool',
  'wx.short.felt.chilly': 'Chilly',
  'wx.short.felt.frosty': 'Frosty',
  'wx.short.felt.hard': 'Hard frost',
  'wx.short.felt.bitter': 'Bitter',
  'wx.short.ground.thin': 'Thin',
  'wx.short.ground.ankle': 'Ankle-deep',
  'wx.short.ground.knee': 'Knee-deep',
  'wx.short.ground.deep': 'Deep',
  'wx.short.season.early': 'Early autumn',
  'wx.short.season.mid': 'Autumn',
  'wx.short.season.late': 'Late autumn',
  'wx.short.season.snowSoon': 'Snow soon',
  'wx.short.season.firstWinter': 'Winter',
  'wx.short.season.deep': 'Deep winter',
  'wx.short.season.lateWinter': 'Late winter',
  'wx.short.season.thawSoon': 'Thaw soon',
  'wx.short.season.thaw': 'Thaw',
  // A rough count once the days are tallied; an exact one in the numbers view or dev mode.
  'wx.short.about': '≈{n} d',
  'wx.short.days': '{n} d',
  'wx.full.toSnow.one': 'A day to the first snow.',
  'wx.full.toSnow.other': '{n} days to the first snow.',
  'wx.full.toThaw.one': 'A day to the thaw.',
  'wx.full.toThaw.other': '{n} days to the thaw.',
  'wx.chips': "Today's weather",
  // The first time the box is shown it's a card at the top of Plan, until the player says they've read it.
  'wx.ack': 'Got it',
  'wx.hint': 'Tap here for the details',
} as const;
