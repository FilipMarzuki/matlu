import type { Catalog } from './index';
import { openingSv } from './sv/opening';
import { kitSv } from './sv/kit';
import { campSv } from './sv/camp';
import { mapSv } from './sv/map';
import { roadSv } from './sv/road';
import { peopleSv } from './sv/people';
import { journalSv } from './sv/journal';
import { roadlogSv } from './sv/roadlog';
import { encountersSv } from './sv/encounters';
import { claimsSv } from './sv/claims';
import { queueSv } from './sv/queue';
import { historySv } from './sv/history';
import { tabsSv } from './sv/tabs';
import { loreSv } from './sv/lore';
import { loreSv2 } from './sv/lore2';
import { loreSv3 } from './sv/lore3';
import { apiSv } from './sv/api';
import { weatherSv } from './sv/weather';

/**
 * Swedish (#1704). Written as Swedish for kids and grown-ups, not word for word from the English:
 * a line may say the same thing differently as long as it means the same in play.
 *
 * `Catalog` is Partial, so a key missing here shows its English instead of breaking the page; the
 * catalog test (i18n.test.ts) still fails until every key is here, with the same `{vars}`.
 *
 * Glossary, so the same thing has the same word everywhere (later phases: keep to these):
 *   Warden → väktare (the role; a Warden's own name stays as written)
 *   Vigor → Kraft (KRA) · Clarity → Klarhet (KLA) · Reserve → Reserv (RES)
 *   action → syssla · the queue → kön · run (a playthrough) → runda
 *   the thaw → tövädret · marks (money) → marker · the caravan road → karavanvägen
 *   rations → ransoner · the larder → skafferiet · camp → läger · ring → ring
 *   Scout gear keeps its Swedish scout names: patrull, kåsa, morakniv.
 *   Names stay names: Greywind Reach, Hollowford, Saltmere, Tobin...
 *
 * Added in phase 2 (#1707), the opening and a day at camp:
 *   the Reach → Reach (a name: no article, "i Reach", "Reach tar dig") · Artificer stays Artificer
 *   (the class, the top rank, an unnamed Warden) · hike → hajk · patrol → patrull
 *   the rings: Near/Far/Distant → Nära/Yttre/Fjärran ("den yttre ringen")
 *   scout (the action) → spana · explore → utforska · survey → kartlägga · track → spåra
 *   suspected → anad · observed → iakttagen · insight → insikt · concept → koncept
 *   Condition (the reserve) → Reserv · Constitution → Fysik (FYS), so the two never meet
 *   stores: food → mat · fuel/firewood → ved · materials → material (never "mat") · hides → hudar
 *   ranks: Apprentice → Lärling · Journeyman → Gesäll · Master → Mästare
 *   grades: crude → grov · sound → duglig · fine → fin · masterwork → mästerverk
 *   shelter → skydd · lean-to → vindskydd (as the tarp) · winterized → vinterbonat · cold pit → kylgrop
 *   the pack's things keep their scout names from kit.ts (sovsäck, kåsa, stormkök, morakniv...)
 *
 * Added in phase 3 (#1709), the road, its people and the journal:
 *   the wagon → vagnen · leg (of the route) → etapp · village → by · quest → uppdrag · lead → spår
 *   roles: trader → handlare · teacher → lärare · healer → helare · elder → byäldste · smith → smed
 *   · hunter → jägare · caravaneer → karavanförare · tinker → mekare
 *   trust words: wary → vaksam ... trusted → förtrolig · close → nära
 *   rumour → rykte · lie → lögn · a caught lie → en avslöjad lögn
 *   foraging → plockning · the Compact → Pakten · the Compact of Knowing → Kunskapspakten
 *   the Vidde Accords → Viddeavtalen · Deepwalkers → Djupvandrare · place and people names stay
 *   names (Kestrel Gate, Lövfolk...)
 *   The sim keeps its journal in English (the AI and the API read it); the page reads each line back
 *   through the catalog (artificer-app/sim-words.ts), so a journal line is a template here.
 */
/** The strings that live in this file rather than an area file under ./sv/. */
const core: Catalog = {
  // ── Språkväljaren ──────────────────────────────────────────────────────────
  'lang.name': 'Svenska',
  'lang.play': 'Spela på svenska',
  'picker.title': 'Välj språk',
  'picker.note': 'Du kan byta senare under ? (hjälp).',

  // ── Hur tal skrivs ─────────────────────────────────────────────────────────
  'fmt.decimal': ',',
  // Ett hårt mellanslag, så att "1 200" inte bryts över två rader.
  'fmt.group': ' ',

  // ── Överst ─────────────────────────────────────────────────────────────────
  'top.yourWarden': 'Din väktare',
  'top.run': 'RUNDA',
  'top.day': 'DAG',
  'top.playAi': 'SPELA MED DIN AI',
  'top.playAiTip': 'Låt din AI spela Greywind Reach',
  'top.week': '📅 VECKANS VÄRLD',
  'top.weekTip': 'Veckans värld: den som alla, både människor och AI:er, spelar den här veckan',
  'top.weekChipTip': 'Veckans värld ({week}): alla, både människor och AI:er, spelar den till måndag 00:00 UTC',
  'top.help': 'Hjälp',
  'top.newSave': '↺ NYTT SPEL',
  'top.features': '🧪 FUNKTIONER',
  'top.experiment': '🧪 EXPERIMENT',
  'top.experimentTip': 'Den här rundan provar experimentella funktioner: {names}. De kan ändras eller försvinna.',
  'top.roadTitleHtml': '🛞 KARAVAN<span class="mark">VÄGEN</span>',
  'top.marks': 'MARKER',
  'top.roadDay': 'DAG PÅ VÄGEN',
  'top.autumn.one': 'HÖST · SNÖ OM {n} DAG',
  'top.autumn.other': 'HÖST · SNÖ OM {n} DAGAR',
  'top.thaw': 'TÖVÄDER',
  'top.winter.one': 'VINTER · TÖ OM {n} DAG',
  'top.winter.other': 'VINTER · TÖ OM {n} DAGAR',

  // ── Statusraden ────────────────────────────────────────────────────────────
  'status.vig': 'KRA',
  'status.cla': 'KLA',
  'status.res': 'RES',
  'status.today': 'IDAG',
  'status.hungryTip': 'Nätter i rad utan mat',
  'status.thirstyTip': 'Nätter i rad utan vatten',
  'status.hungry': 'HUNGRIG',
  'status.thirsty': 'TÖRSTIG',
  'status.focus': 'FOKUS',
  'status.survival': 'ÖVERLEVNAD',
  'status.survivalTip': 'Att överleva har tagit över dina tankar',
  'status.focusTip': 'Det du går och tänker på',
  'status.frayed': 'splittrat',
  'status.frayedTip': 'Klarhet under {n}: du kan inte lita på ditt fokus',
  'status.rations': 'MAT',
  'status.full': 'HELT',
  'status.half': 'HALVT',
  'status.none': 'INGET',
  'status.fullTip': 'Ett mål mat varje kväll',
  'status.halfTip': 'Mat varannan kväll: skafferiet räcker längre, men kroppen tar stryk',
  'status.noneTip': 'Fasta: maten får ligga orörd',
  'status.tapToChange': '{tip}. Tryck för att ändra',
  'status.ready': 'REDO FÖR VINTERN',
  'status.notReady': 'INTE REDO',
  'status.short': 'RÄCKER INTE',
  'status.holding': 'RÄCKER',
  'status.outlookTip': 'Hur vintern ser ut',

  // ── Flikar ─────────────────────────────────────────────────────────────────
  'tab.plan': 'PLAN',
  'tab.camp': 'LÄGRET',
  'tab.land': 'LANDET',
  'tab.history': 'HISTORIA',
  'tab.warden': 'VÄKTAREN',
  'tab.progress': 'FRAMSTEG',
  'tab.road': 'VÄGEN',
  'tab.quests': 'UPPDRAG',
  'tab.journal': 'DAGBOK',
  'tab.dev': 'DEV',

  // ── Rubriker ───────────────────────────────────────────────────────────────
  'head.actionsQueue': 'SYSSLOR — tryck för att lägga till i kön',
  'head.actionsNow': 'SYSSLOR — tryck för att göra det nu',
  'head.queue': 'KÖN',
  'head.queueNew': 'KÖN — NYTT: PLANERA I FÖRVÄG',
  'head.oneThing': 'EN SAK I TAGET',
  'head.latest': 'SENASTE',
  'head.makeCamp': 'SLÅ LÄGER — välj din plats',
  'head.tools': 'VERKTYG & KUNSKAP',
  'head.warden': 'VÄKTAREN',
  'head.stores': 'FÖRRÅD',
  'head.site': 'PLATS & SKYDD',
  'head.land': 'LANDET — det du vet, ring för ring',
  'head.pins': 'NÅLAR — platser du minns',
  'head.landDescribed': 'LANDET — det du vet om det, sett från lägret',
  'head.yourMap': 'DIN KARTA — ritad efter det du har sett',
  'head.reachMap': 'REACH — en karta över det du vet',
  'head.history': 'REACH — dess historia',
  'head.lordships': 'HERRESÄTENA NU',
  'head.lordship': 'Herresäte',
  'head.people': 'Folk',
  'head.heldBy': 'Innehas av',
  'head.artificer': 'ARTIFICER',
  'head.rank': 'RANG',
  'head.focus': 'FOKUS',
  'head.statsAge': 'EGENSKAPER — {age} år, växer fortfarande',
  'head.statsGrown': 'EGENSKAPER — {age} år, fullvuxen',
  'head.stats': 'EGENSKAPER — det du är byggd för',
  'head.carrying': 'BÄRA — vad en tur kan få med sig hem',
  'head.pack': 'PACKNINGEN — det du tog med på haiken',
  'head.wounds': 'GAMLA SÅR — det kroppen minns',
  'head.talents': 'TALANGER',
  'head.quirks': 'EGENHETER — hur du är, så långt du vet',
  'head.skills': 'FÄRDIGHETER — blir bättre när du gör, mer med fokus; tekniker kommer med övning eller en lärare',
  'head.concepts': 'BEGREPP — fördjupas genom studier och hantverk',
  'head.roadKeeps': 'VÄGEN — marker & kontakter',
  'head.season': 'ÅRSTIDEN',
  'head.outlook': 'HUR VINTERN SER UT',
  'head.milestones': 'MILSTOLPAR',
  'head.pastRuns': 'TIDIGARE RUNDOR',
  'head.journal': 'DAGBOK',
  'head.roadJournal': 'DAGBOK — VÄGEN',
  'head.roadLast': 'DET SISTA AV VÄGEN',
  'head.records': 'REKORDEN',
  'head.features': '🧪 FUNKTIONER — DEV-LÄGE',
  'group.explore': 'UTFORSKA',
  'group.provision': 'SAMLA FÖRRÅD',
  'group.build': 'BYGGA',
  'group.craft': 'TILLVERKA VERKTYG',
  'group.carry': 'BÄRUTRUSTNING',
  'group.think': 'TÄNKA & VILA',
  'group.ringNote': '· {ring} ringen',
  'focus.goal': 'MÅL',
  'focus.skill': 'FÄRDIGHET',
  'focus.concept': 'BEGREPP',
  'focus.material': 'MATERIAL',
  'focus.place': 'PLATS',
  'focus.group': 'GRUPP',
  'focus.person': 'PERSON',
  'focus.quest': 'UPPDRAG',
  'focus.job': 'YRKE',
  'focus.none': 'Inget fokus',

  // ── Kön och dagen ──────────────────────────────────────────────────────────
  'queue.today': 'IDAG',
  'queue.day': 'DAG {n}',
  'queue.options': 'Val',
  'queue.remove': 'Ta bort',
  'queue.empty': 'Tom. Tryck på sysslor för att planera. En dag har {hours} vakna timmar; det som inte hinns med flyttas till nästa dag, och du sover emellan.',
  'queue.todayHours': 'Idag',
  'queue.spans.one': 'Räcker <b>{n}</b> dag',
  'queue.spans.other': 'Räcker <b>{n}</b> dagar',
  'queue.spent': 'Dagen är slut.',
  'queue.tapNow': 'Tryck på en syssla för att göra den nu.',
  'btn.runDay': '▶ KÖR DAGEN',
  'btn.passDay': '☾ LÅT DAGEN GÅ',
  'btn.runAll': '⏭ KÖR HELA KÖN',
  'btn.clear': 'RENSA',
  'btn.endDay': '☾ AVSLUTA DAGEN',
  'btn.newWarden': '✦ NY VÄKTARE',
  'btn.newWardenTip': 'Någon ny, som börjar med verktygen den här väktaren lämnade efter sig',
  'btn.backToMap': '← TILLBAKA TILL KARTAN',
  'btn.enter': 'GÅ IN I {name}',

  // ── Dagen på klockan ───────────────────────────────────────────────────────
  'timer.label': 'Dagen spelas upp',
  'timer.day': 'DAG {n}',
  'timer.days': ' · {n} AV {total} DAGAR',
  'timer.speed': 'Hastighet',
  'timer.skip': '⏭ HOPPA ÖVER',
  'timer.skipTip': 'Gör klart direkt (Esc)',
  'timer.action': 'Den här sysslan',

  // ── Inledningens knappar ───────────────────────────────────────────────────
  'intro.label': 'Ankomsten',
  'intro.skip': 'HOPPA ÖVER ›',
  'intro.next': 'FORTSÄTT ▸',
  'intro.begin': 'BÖRJA ▸',
  'intro.offWeGo': 'NU GÅR VI ▸',

  // ── Hjälp ──────────────────────────────────────────────────────────────────
  'help.ledeHtml': 'Du kommer hit ensam med nästan ingenting, och <b>vintern är på väg</b>. Fyll ett <b>skafferi</b>, bygg ett <b>skydd som klarar vintern</b>, samla <b>ved</b> och håll både kropp och huvud friska. Planera varje dag som en <b>kö av sysslor</b> och kör den. Varje syssla tar <b>timmar</b> och kostar <b>Kraft</b> (kroppen) eller <b>Klarhet</b> (huvudet). Varje kväll äter och dricker du: <b>vatten är livsviktigt</b>, för några kvällar utan vatten slår ut både kropp och huvud, medan <b>maten</b> kan vänta ett tag och kostar mindre att hoppa över. Ju fler nätter i rad utan, desto värre blir det. Spana först och ta dig sedan längre ut: när du arbetar i landet lär du känna det på riktigt. Snön kommer dag {winterDay}, och sedan finns ingen väg härifrån förrän till våren: <b>klara dig genom vintern tills tövädret kommer</b>. Spelet sparas i den här webbläsaren.',
  'help.language': 'SPRÅK',

  // ── Dev-läge ───────────────────────────────────────────────────────────────
  'dev.label': 'Utvecklare',
  'dev.on': 'Dev-läget är på i den här webbläsaren.',
  'dev.leave': 'LÄMNA DEV-LÄGET',
  'dev.password': 'Lösenord för utvecklare',
  'dev.placeholder': 'lösenord',
  'dev.unlock': 'LÅS UPP',
  'dev.wrong': 'Inte det.',
  'dev.noHash': 'Det här bygget har inget lösenord.',
  'dev.featOn': 'PÅ',
  'dev.featOff': 'AV',
  'dev.thisRun': 'den här rundan: <b>{state}</b>',
  'dev.runOn': 'på',
  'dev.runOff': 'av',
  'dev.rules': 'regler: från nästa nya spel',
  'dev.looks': 'utseende: direkt',
  'dev.featuresNoteHtml': 'Sparas i den här webbläsaren och används av textkonsolen också. Lägg till <code>?dev=truths</code> för att också se det spelet döljer: varje färdighets riktiga nivå, hur mycket varje person verkligen litar på dig, och regeln bakom varje sak i packningen. Dev-läget är avstängt för spelare och öppnas med lösenordet bakom ⚙ i hjälpen.',
  'dev.looksHead': 'FÖRHANDSVISA UTSEENDE',
  'dev.lookGame': 'SPELETS UTSEENDE ({look})',
  'dev.lookNote': 'Visas: {look}. En förhandsvisning ändrar bara den här sidan: spelet, sparfilen och rundans logg ser den aldrig.',
  'look.scout-1': 'Fältdagbok',
  'look.scout-2': 'Kartritare',
  'look.scout-3': 'Lantmätare',
  'look.steampunk-1': 'Mekarbänken',
  'look.steampunk-2': 'Mässingsmaskinen',
  'look.steampunk-3': 'Sot och ånga',
  'look.rune-1': 'Etsad skiffer',
  'look.rune-2': 'Vaknande runor',
  'look.rune-3': 'Full runteknik',

  // ── Rekorden ───────────────────────────────────────────────────────────────
  'records.working': 'Räknar ut hur rundan står sig…',
  'records.sent': 'Med i rekorden.',
  'records.compare': 'Se hur den står sig mot alla andras ›',
  'records.nickname': 'Smeknamn',
  'records.nicknameLabel': 'Ditt smeknamn i rekorden',
  'records.send': 'SKICKA TILL REKORDEN',
  'records.sending': 'SKICKAR…',
  'records.replayNote': 'Servern spelar om din runda från början innan den räknas. Bara ett smeknamn sparas, ett ord med bokstäver.',
  'records.unreachable': 'Det går inte att nå rekorden just nu. Försök igen om en stund.',
  'records.failed': 'Något gick fel ({status}). Försök igen om en stund.',

  // ── Veckans värld ──────────────────────────────────────────────────────────
  'weekly.unreachable': 'Det går inte att nå veckans värld just nu. Försök igen om en stund.',
  'weekly.leave': 'Lämna den här rundan och börja på veckans värld? Den här rundan går inte att ta upp igen.',
};

/** Every area by name, as en.ts has them (`enAreas`): duplicates.test.ts checks that no key is defined in two. */
export const svAreas: Record<string, Catalog> = { core, openingSv, kitSv, campSv, mapSv, roadSv, peopleSv, journalSv, roadlogSv, encountersSv, claimsSv, queueSv, historySv, tabsSv, loreSv3, loreSv2, loreSv, apiSv, weatherSv };

export const sv: Catalog = {
  ...core,
  // ── Fas 2 (#1707): öppningen, packningen, en dag i lägret, kartan ──────────
  ...openingSv,
  ...kitSv,
  ...campSv,
  ...mapSv,
  ...roadSv,
  ...peopleSv,
  ...journalSv,
  ...roadlogSv,
  ...encountersSv,
  ...claimsSv,
  ...queueSv,
  ...historySv,
  ...tabsSv,
  ...loreSv3,
  ...loreSv2,
  ...loreSv,
  ...apiSv,
  ...weatherSv,
};
