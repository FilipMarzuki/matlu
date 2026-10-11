/**
 * Questions players would likely ask in each road village (#1610), for measuring how many free
 * questions the scope facts make answerable. No real questions had been asked yet when this was
 * written (0 rows in `artificer_questions`), so these stand in for them: written as a player who
 * has just walked in would type them, not tuned to the matcher. Each names who's asked and the
 * topic a good answer would come from (`want`), or null where no topic fits (news, small talk):
 * those are expected to stay unmatched, and count against the total.
 *
 * Replace or extend from the real list once it exists:
 *   select person, question from artificer_questions_unmatched limit 100;
 */

export interface ScopeQuestion { village: string; person: string; question: string; want: string | null }

const q = (village: string) => (person: string, question: string, want: string | null): ScopeQuestion => ({ village, person, question, want });
const hf = q('hollowford');
const sm = q('saltmere');
const kg = q('kestrel-gate');

export const SCOPE_QUESTIONS: readonly ScopeQuestion[] = [
  hf('hf-maren', "What's Hollowford like?", 'place:hollowford'),
  hf('hf-maren', 'What does Hollowford live on?', 'place:hollowford'),
  hf('hf-tobin', 'What is this village known for?', 'place:hollowford'),
  hf('hf-isa', 'Who is the elder here?', 'role:elder'),
  hf('hf-orrin', "Who's in charge in this village?", 'role:elder'),
  hf('hf-maren', 'Who can I trade with here?', 'role:trader'),
  hf('hf-isa', 'Is there a merchant in Hollowford?', 'role:trader'),
  hf('hf-maren', "Who's the healer?", 'role:healer'),
  hf('hf-orrin', "I'm hurt, who can help me?", 'role:healer'),
  hf('hf-tobin', "Who's Isa?", 'person:hf-isa'),
  hf('hf-isa', 'Who is Orrin?', 'person:hf-orrin'),
  hf('hf-maren', 'Who is Tobin?', 'person:hf-tobin'),
  hf('hf-tobin', 'Where do your hides go?', 'material:hides'),
  hf('hf-isa', 'Where does the stone for the walls come from?', 'material:stone'),
  hf('hf-maren', 'Who makes the ploughs here?', 'material:wood'),
  hf('hf-isa', 'How far is it to Saltmere?', 'place:north-road'),
  hf('hf-orrin', "What's on the road ahead?", 'place:north-road'),
  hf('hf-tobin', 'Is the road dangerous?', 'place:north-road'),
  hf('hf-maren', "What's happening with the high fields?", 'place:hollowford'),
  hf('hf-isa', 'What about the goblins in the quarry?', 'group:compact'),
  hf('hf-orrin', 'Where can I buy salt?', 'material:salt'),
  hf('hf-tobin', "What's in Mistheim?", 'place:mistheim'),
  hf('hf-maren', 'Any news?', null),
  hf('hf-isa', 'Who teaches around here?', 'role:teacher'),
  hf('hf-orrin', 'Where can I get iron?', 'material:iron'),

  sm('sm-gunnar', "What's wrong with the mere?", 'place:saltmere'),
  sm('sm-liv', 'Is the water safe to drink?', 'place:saltmere'),
  sm('sm-hedda', 'What does Saltmere trade in?', 'place:saltmere'),
  sm('sm-anselm', 'Where does the salt come from?', 'material:salt'),
  sm('sm-yrsa', "Who's the elder?", 'role:elder'),
  sm('sm-liv', 'Who is Gunnar?', 'person:sm-gunnar'),
  sm('sm-hedda', "Who's Anselm?", 'person:sm-anselm'),
  sm('sm-gunnar', 'Who is Yrsa?', 'person:sm-yrsa'),
  sm('sm-anselm', 'Who is Liv?', 'person:sm-liv'),
  sm('sm-yrsa', 'Is there a healer here?', 'role:healer'),
  sm('sm-gunnar', 'Who sells things here?', 'role:trader'),
  sm('sm-liv', 'Where can I find a merchant?', 'role:trader'),
  sm('sm-hedda', 'What are the Vidde Accords?', 'group:vidde-accords'),
  sm('sm-anselm', 'How far to Kestrel Gate?', 'place:north-road'),
  sm('sm-yrsa', 'What happens to the hides from Hollowford?', 'material:hides'),
  sm('sm-gunnar', "What's the road like to the Gate?", 'place:north-road'),
  sm('sm-liv', 'Who can teach me something?', 'role:teacher'),
  sm('sm-hedda', 'Who owes you money?', null),
  sm('sm-anselm', 'What is the book you keep?', null),
  sm('sm-yrsa', 'Where do you hunt?', 'role:hunter'),
  sm('sm-gunnar', 'Where can I buy iron?', 'material:iron'),
  sm('sm-liv', "What's in the lowlands?", 'place:mistheim'),
  sm('sm-hedda', 'How is business?', null),
  sm('sm-anselm', 'Who is the hunter here?', 'role:hunter'),
  sm('sm-yrsa', 'What is there to do in Saltmere?', 'place:saltmere'),

  kg('kg-runa', 'What is Kestrel Gate like?', 'place:kestrel-gate'),
  kg('kg-veit', 'Why is there a toll?', 'place:kestrel-gate'),
  kg('kg-sabine', "Who's in charge here?", 'role:elder'),
  kg('kg-arvid', 'Who is Veit?', 'person:kg-veit'),
  kg('kg-runa', 'Who is Sabine?', 'person:kg-sabine'),
  kg('kg-veit', 'Who is Arvid?', 'person:kg-arvid'),
  kg('kg-sabine', 'Who is the trader here?', 'role:trader'),
  kg('kg-arvid', 'Who teaches stonework?', 'role:teacher'),
  kg('kg-veit', 'Where does the iron come from?', 'material:iron'),
  kg('kg-runa', "What's the price of iron?", 'material:iron'),
  kg('kg-sabine', "What's the ash doing to the road?", 'place:north-road'),
  kg('kg-arvid', 'How far is Mistheim?', 'place:mistheim'),
  kg('kg-veit', 'Is there a healer at the Gate?', 'role:healer'),
  kg('kg-runa', 'Who are the goblins with tokens?', 'group:compact'),
  kg('kg-sabine', 'Where can I get salt?', 'material:salt'),
  kg('kg-arvid', 'Where do hides come from?', 'material:hides'),
  kg('kg-veit', "What's the wall made of?", 'material:stone'),
  kg('kg-runa', 'What news from the pass?', null),
  kg('kg-sabine', "Who's the hunter on this road?", 'role:hunter'),
  kg('kg-arvid', 'Tell me about the caravan master', 'role:caravaneer'),
  kg('kg-veit', 'What do people here do for a living?', 'place:kestrel-gate'),
  kg('kg-runa', 'Can someone fix my broken buckle?', 'role:tinker'),
  kg('kg-sabine', 'Do you work copper too?', 'material:copper'),
  kg('kg-arvid', 'What can I sell in the lowlands?', 'place:mistheim'),
  kg('kg-runa', 'What is the road like after the Gate?', 'place:north-road'),
];
