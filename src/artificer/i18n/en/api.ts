/**
 * The play API's own words (#1713, phase 5 of #1685): what a game played through the API, the MCP
 * server or the text console says around the views it shares with the page (src/artificer-play/view-words.ts).
 *
 * An English game doesn't read these: it reads the AI harness's observation, as it always has, so
 * its text stays byte for byte what the API tests pin. They're here because the English catalog is
 * the master (every key starts here), and because two kinds of them are read in English too:
 * - `api.no.*` are the session's refusals (session.ts `apply`), each exactly as the session writes
 *   it. view-words.ts `refusalText` matches the session's English against them and says the same
 *   in the game's language: so keep each one identical to the session's sentence. `{why}` is a
 *   reason from the game (said again through `simLine`), `{refusal}` another refusal, `{action}` an
 *   action id, `{ids}` a list of ids to send (quoted in another language); any other var is kept
 *   as it came (an id, a name). More specific first: the first that matches wins.
 * - `api.mcp.*` are the MCP server's lines around a game's text, for a game in another language.
 */

export const api = {
  'api.legend': 'Moves are in brackets: [do: X] is { "do": "X" }, [choose: X] is { "choose": "X" }, [ask: X] is { "ask": { "person": "X", "question": "…" } }, [set site: X] is { "set": { "site": "X" } } and [endDay] is { "endDay": true }. An action\'s choices go in { "do": { "q": "<id>", "opts": { "<choice>": "<value>" } } }.',
  'api.dayHead': 'DAY {n} · {weather} · {h}/{max} hours used',
  'api.canPlan': 'You can plan whole days: send { "plan": [ … ] } with the day\'s actions in order.',
  'api.oneAtATime': 'One thing at a time: each action happens as you send it. Once a skill first levels up, you can plan whole days.',
  'api.actions': 'Actions',
  'api.blocked': 'not now: {why}',
  'api.endDay': 'End the day',
  'api.askHow': 'Free questions: once per stay you may ask each person here one question in your own words, as { "ask": { "person": "<id>", "question": "…" } }, up to {n} characters.',
  'api.vitals': 'Vigor {vig}/{vigCap} · Clarity {cla}/{claCap} · Reserve {con}',
  'api.marks': 'marks {n}',
  'api.status.day': 'Day {n} · {h}/{max}h · {vitals} · food {food} · water {water} · firewood {wood} · rations {rations}',
  'api.status.road': 'Road day {n}/{total} · {h}/{max}h · {vitals} · marks {marks}',
  'api.status.meeting': 'The thaw, day {n} · meeting the caravan',
  'api.status.ended': 'Run over: {outcome}',
  'api.stayed': 'stayed in the Reach at the thaw',
  'api.outcome': '{what} on day {n}',
  'api.outcome.died': 'died on day {n}',
  'api.outcome.collapsed': 'collapsed on day {n}',
  'api.talkWith': 'Talk with {name}',
  'api.road.rest': 'Rest',
  'api.road.wait': 'Wait',
  'api.road.tend': 'Tend',
  'api.road.help': 'Help',

  // ── Refusals (session.ts apply): each exactly as the session writes it ─────
  'api.no.over': 'The run is over. Start a new game to play again.',
  'api.no.answerFirstChoose': 'Something needs an answer first: choose one of {ids}.',
  'api.no.answerFirst': 'Something needs an answer first.',
  'api.no.noOneToAsk': "There's no one to ask yet: free questions are for the people you meet on the road.",
  'api.no.questionsOff': 'Free questions are off in this game.',
  'api.no.noSuchPerson': 'There\'s no one called "{person}" here. Here: {list}.',
  'api.no.askTomorrow': 'The day is spent: end the day, and ask tomorrow.',
  'api.no.askedThisStay': "You've asked {name} your question this stay. Ask someone else, or ask again at the next stop.",
  'api.no.askSomething': 'Ask a question, in up to {n} characters.',
  'api.no.notAnAnswer': '"{option}" isn\'t an answer you can give now. Open: {ids}.',
  'api.no.notRoadAction': '"{id}" isn\'t a road action. Road actions are rest, wait, tend, help, or talk:/ask:/tell:/heal:/sell:/buy:/accept:/complete:/learn:/appraise:/craft:/study: followed by an id from the view. A free question is its own move: { "ask": { "person", "question" } }.',
  'api.no.onRoad': 'On the road: do one road action, end the day, or change your focus.',
  'api.no.oneAtATime': "You're taking it one thing at a time — you haven't learned to plan ahead yet. Do one thing at a time with { do }.",
  'api.no.inPlan': 'In the plan: {refusal}',
  'api.no.nothingPending': 'Nothing needs an answer now: do an action, end the day, or plan the day.',
  'api.no.noAction': 'There\'s no action "{q}". The actions are listed in the view (e.g. "explore", "gather@2").',
  'api.no.badRing': '"{q}" isn\'t a valid ring for {action} (rings are 1, 2 and 3).',
  'api.no.notOnLand': '"{q}" isn\'t a valid ring for {action}: it isn\'t done out on the land.',
  'api.no.lengthFixed': "Can't set a length on {action}: {fixed} has a fixed length; only {ids} take hours or until.",
  'api.no.lengthHours': 'Can\'t set a length on {action}: hours must be a number from 1 to 14, or "day".',
  'api.no.lengthUntil': "Can't set a length on {action}: until must be a whole number from 1 to 999.",
  'api.no.length': "Can't set a length on {action}: {why}.",
  'api.no.lengthsOff': 'Action lengths are off in this game: leave out hours and until.',
  'api.no.wayExplore': "You don't know the way to ring {ring} yet: explore the ring before it first.",
  'api.no.wayScout': "You don't know the way to ring {ring} yet: scout the ring before it first.",
  'api.no.blockedRing': "Can't {action} in ring {ring} now: {why}.",
  'api.no.blocked': "Can't {action} now: {why}.",
  'api.no.locked': "Can't {action}: {why}.",
  'api.no.daySpent': 'The day is spent. End the day.',
  'api.no.focus': '"{focus}" isn\'t a focus. Focus keys look like "goal:larder", "skill:hunting" or "concept:joinery", or "none".',
  'api.no.eating': 'Eating is one of {ids}.',
  'api.no.roadFeeds': 'On the road the caravan feeds you.',
  'api.no.site': 'A camp site is one of {ids}.',
  'api.no.campLeft': 'You left your camp behind.',

  // ── The MCP server's lines around a game in another language (mcp.ts) ──────
  'api.mcp.started': 'Game started. game_id: {id}\nPass this game_id to every other tool.',
  'api.mcp.weekly': 'This is the weekly world, {week}: everyone who plays this week plays the same one.',
  'api.mcp.features': 'Experimental features on in this game, by id: {ids}.',
  'api.mcp.moves': 'MOVES NOW (pass one to act, or just its action id):',
  'api.mcp.noMoves': 'No moves left: the run is over.',
  'api.mcp.nothingNew': '(nothing new)',
  'api.mcp.lookHint': '(look shows the full view and the moves open now.)',
  'api.mcp.refused': 'Refused: {why}',
} as const satisfies Record<string, string>;

export type ApiKey = keyof typeof api;
