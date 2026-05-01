/**
 * i18n-codex.ts — client-side translation helper for Matlu Codex.
 *
 * Usage in Astro <script> blocks:
 *   import { t, getLanguage, setLanguage, applyTranslations } from '../lib/i18n-codex';
 *
 * Usage in HTML templates:
 *   <h1 data-i18n="home.title">The Matlu Multiworld</h1>
 *   <p data-i18n-html="home.lead">…rich text with <strong>tags</strong>…</p>
 *   <input data-i18n-placeholder="submit.creature_name_placeholder" />
 *
 * Language is persisted in localStorage under LANG_KEY. Defaults to 'sv' if the
 * browser's navigator.language starts with 'sv', otherwise 'en'.
 */

export type Lang = 'en' | 'sv';

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'sv'] as const;

const LANG_KEY = 'codex_lang';

// ── Translation map ────────────────────────────────────────────────────────

const translations: Record<Lang, Record<string, string>> = {
  en: {
    // Nav
    'nav.home':        'Home',
    'nav.lore':        'Lore',
    'nav.biomes':      'Biomes',
    'nav.creatures':   'Creatures',
    'nav.playtest':    'Playtest',
    'nav.backlog':     'Backlog',
    'nav.screenshots': 'Screenshots',
    'nav.credits':     'Credits',
    'nav.world_forge': 'World Forge →',
    'nav.dev_log':     'Dev Log →',

    // Index
    'home.title':                'The Matlu Multiworld',
    'home.lead':                 'The world companion for <strong>Core Warden</strong> — lore, biomes, creatures, and more. Explore the world, meet its peoples, and help bring its creatures to life.',
    'home.play_cta':             'Play Core Warden →',
    'home.lore_heading':         '📖 Lore',
    'home.browse_all':           'Browse all →',
    'home.lore_coming_soon':     'Lore entries coming soon.',
    'home.lore_visit':           'Visit the lore section →',
    'home.biomes_heading':       '🌍 Biomes',
    'home.biomes_coming_soon':   'Biome cards coming soon — from Meadow to Deep Sea.',
    'home.creatures_heading':    '🦎 Creatures',
    'home.creatures_coming_soon':'Creature gallery coming soon.',
    'home.creatures_submit':     'Submit a creature →',
    'home.contribute_heading':   'Contribute to the World',
    'home.contribute_desc':      'The Matlu multiworld grows with the community. Submit a creature you\'ve dreamed up, or play the game and share your feedback.',
    'home.submit_creature_btn':  'Submit a creature',
    'home.give_feedback_btn':    'Give feedback',

    // Lore
    'lore.title':       'Lore',
    'lore.subtitle':    'Stories, history, and the forces shaping the Matlu multiworld.',
    'lore.coming_soon': 'Lore entries coming soon.',

    // Biomes
    'biomes.title':             'Biomes',
    'biomes.subtitle':          'The twelve terrain types of Mistheim, from sea level to permanent snowfield.',
    'biomes.world_forge_heading':'World Forge',
    'biomes.world_forge_desc':  'Explore every biome in Core Warden — inspect tile palettes, decoration scatter, and biome boundaries in real time. Works in your browser.',
    'biomes.world_forge_btn':   'Open World Forge →',

    // Playtest
    'playtest.title':            'Playtest Matlu',
    'playtest.lead':             'Try the game in your browser, then share what worked and what didn\'t. Feedback goes directly to the development team.',
    'playtest.play_btn':         'Play Matlu →',
    'playtest.feedback_heading': 'Share your feedback',
    'playtest.feedback_desc':    'Takes about 60 seconds. No account needed.',
    'playtest.combat_label':     'How did combat feel?',
    'playtest.combat_hint':      '(1 = terrible, 5 = great)',
    'playtest.frustration_label':'What frustrated you most?',
    'playtest.bug_label':        'Any bugs?',
    'playtest.overall_label':    'Overall thoughts',
    'playtest.submit_btn':       'Submit feedback',
    'playtest.submitting':       'Submitting…',
    'playtest.success':          'Thanks! Your feedback has been recorded.',
    'playtest.error':            'Something went wrong — please try again.',
    'playtest.rating_required':  'Please select a combat feel rating.',

    // Creature submit — section headings
    'submit.title':          'Submit a Creature',
    'submit.lead':           'Share your fantasy creature with the Matlu world! Fill in as many fields as you can — the more detail you add, the better the chances it inspires a real in-game creature.',
    'submit.your_creature':  'Your creature',
    'submit.about_you':      'About you',
    'submit.picture':        'Picture',
    'submit.picture_desc':   'Upload a drawing, painting, or photo. Any style — pencil sketch, crayon, digital — is great. Max 5 MB. Accepted: JPG, PNG, GIF, WebP.',
    'submit.kind':           'What kind of creature is it?',
    'submit.habitat':        'Where does it live?',
    'submit.behaviour':      'How does it behave?',
    'submit.food':           'What does it eat?',
    'submit.special':        'Special things',
    'submit.story':          'The story',
    'submit.story_desc':     'Tell us about your creature in your own words. Where did it come from? What makes it special? What\'s it like to encounter one? At least 20 characters.',
    'submit.consent':        'Consent',
    // Labels
    'submit.creature_name':  'Creature name',
    'submit.world_name':     'Which world does it live in?',
    'submit.creator_name':   'Your name',
    'submit.maker_age':      'Your age',
    'submit.contact_email':  'Parent / guardian email',
    'submit.choose_image':   'Choose image',
    'submit.art_credit':     'Art credit',
    'submit.size':           'Size',
    'submit.movement':       'How does it move?',
    'submit.solitary':       'Does it live alone or in groups?',
    'submit.biome':          'Biome / habitat',
    'submit.climate':        'Climate',
    'submit.habitat_notes':  'Anything else about where it lives?',
    'submit.threat':         'How dangerous is it?',
    'submit.behaviour_notes':'Any other behaviour notes?',
    'submit.diet':           'Diet',
    'submit.food_notes':     'Favourite food or hunting style',
    'submit.special_ability':'Special ability or power',
    'submit.description':    'Description',
    'submit.lore_origin':    'Origin story',
    'submit.credits_opt_in': 'Credit me in the game if my creature is added',
    'submit.submit_btn':     'Submit creature',
    'submit.draft_resume':   'Resume',
    'submit.draft_fresh':    'Start fresh',
    // Status messages (used by JS)
    'submit.no_picture':     'Please add a picture.',
    'submit.uploading':      'Uploading picture…',
    'submit.saving':         'Saving your creature…',
    'submit.success':        '🎉 Thanks! Your creature is waiting to be approved. We\'ll review it soon!',
    'submit.upload_error':   'Could not upload your picture. Please try again.',
    'submit.save_error':     'Something went wrong saving your creature. Please try again.',
  },

  sv: {
    // Nav
    'nav.home':        'Hem',
    'nav.lore':        'Lore',
    'nav.biomes':      'Biomer',
    'nav.creatures':   'Varelser',
    'nav.playtest':    'Speltesta',
    'nav.backlog':     'Backlog',
    'nav.screenshots': 'Skärmdumpar',
    'nav.credits':     'Tack',
    'nav.world_forge': 'Världssmedjan →',
    'nav.dev_log':     'Devlogg →',

    // Index
    'home.title':                'Matlu Multiversum',
    'home.lead':                 'Världskompanjonen för <strong>Core Warden</strong> — lore, biomer, varelser och mer. Utforska världen, möt dess folk och hjälp till att väcka dess varelser till liv.',
    'home.play_cta':             'Spela Core Warden →',
    'home.lore_heading':         '📖 Lore',
    'home.browse_all':           'Bläddra alla →',
    'home.lore_coming_soon':     'Lore-inlägg kommer snart.',
    'home.lore_visit':           'Besök lore-sektionen →',
    'home.biomes_heading':       '🌍 Biomer',
    'home.biomes_coming_soon':   'Biomekort kommer snart — från äng till djuphav.',
    'home.creatures_heading':    '🦎 Varelser',
    'home.creatures_coming_soon':'Varelsebiblioteket kommer snart.',
    'home.creatures_submit':     'Skicka in en varelse →',
    'home.contribute_heading':   'Bidra till Världen',
    'home.contribute_desc':      'Matlu-multiversumet växer med gemenskapen. Skicka in en varelse du drömt om, eller spela spelet och dela din feedback.',
    'home.submit_creature_btn':  'Skicka in en varelse',
    'home.give_feedback_btn':    'Ge feedback',

    // Lore
    'lore.title':       'Lore',
    'lore.subtitle':    'Berättelser, historia och krafterna som formar Matlu-multiversumet.',
    'lore.coming_soon': 'Lore-inlägg kommer snart.',

    // Biomes
    'biomes.title':             'Biomer',
    'biomes.subtitle':          'De tolv terrängtyper i Mistheim, från havsnivå till permanent snöfält.',
    'biomes.world_forge_heading':'Världssmedjan',
    'biomes.world_forge_desc':  'Utforska varje biom i Core Warden — inspektera kakelpaletor, dekorationsutspridning och biomgränser i realtid. Fungerar i din webbläsare.',
    'biomes.world_forge_btn':   'Öppna Världssmedjan →',

    // Playtest
    'playtest.title':            'Speltesta Matlu',
    'playtest.lead':             'Prova spelet i din webbläsare och dela sedan vad som fungerade och vad som inte gjorde det. Feedback går direkt till utvecklingsteamet.',
    'playtest.play_btn':         'Spela Matlu →',
    'playtest.feedback_heading': 'Dela din feedback',
    'playtest.feedback_desc':    'Tar ungefär 60 sekunder. Inget konto behövs.',
    'playtest.combat_label':     'Hur kändes striderna?',
    'playtest.combat_hint':      '(1 = hemsk, 5 = fantastisk)',
    'playtest.frustration_label':'Vad frustrerade dig mest?',
    'playtest.bug_label':        'Några buggar?',
    'playtest.overall_label':    'Allmänna tankar',
    'playtest.submit_btn':       'Skicka feedback',
    'playtest.submitting':       'Skickar…',
    'playtest.success':          'Tack! Din feedback har registrerats.',
    'playtest.error':            'Något gick fel — försök igen.',
    'playtest.rating_required':  'Välj ett betyg för stridskänslan.',

    // Creature submit — section headings
    'submit.title':          'Skicka in en Varelse',
    'submit.lead':           'Dela din fantasivarelse med Matlu-världen! Fyll i så många fält du kan — ju mer detaljer du lägger till, desto större chans att den inspirerar en riktig spelvarelse.',
    'submit.your_creature':  'Din varelse',
    'submit.about_you':      'Om dig',
    'submit.picture':        'Bild',
    'submit.picture_desc':   'Ladda upp en teckning, målning eller foto. Alla stilar — blyertsteckning, krita, digital — är bra. Max 5 MB. Godkänt: JPG, PNG, GIF, WebP.',
    'submit.kind':           'Vad för slags varelse är det?',
    'submit.habitat':        'Var lever den?',
    'submit.behaviour':      'Hur beter den sig?',
    'submit.food':           'Vad äter den?',
    'submit.special':        'Speciella egenskaper',
    'submit.story':          'Berättelsen',
    'submit.story_desc':     'Berätta om din varelse med egna ord. Var kom den ifrån? Vad gör den speciell? Hur är det att stöta på en? Minst 20 tecken.',
    'submit.consent':        'Samtycke',
    // Labels
    'submit.creature_name':  'Varelsens namn',
    'submit.world_name':     'I vilken värld lever den?',
    'submit.creator_name':   'Ditt namn',
    'submit.maker_age':      'Din ålder',
    'submit.contact_email':  'Förälder / målsmans e-post',
    'submit.choose_image':   'Välj bild',
    'submit.art_credit':     'Bildkredit',
    'submit.size':           'Storlek',
    'submit.movement':       'Hur rör den sig?',
    'submit.solitary':       'Lever den ensam eller i grupp?',
    'submit.biome':          'Biom / biotop',
    'submit.climate':        'Klimat',
    'submit.habitat_notes':  'Något annat om var den lever?',
    'submit.threat':         'Hur farlig är den?',
    'submit.behaviour_notes':'Några andra beteendenoteringar?',
    'submit.diet':           'Kost',
    'submit.food_notes':     'Favoritkost eller jaktstil',
    'submit.special_ability':'Speciell förmåga eller kraft',
    'submit.description':    'Beskrivning',
    'submit.lore_origin':    'Ursprungshistoria',
    'submit.credits_opt_in': 'Ge mig kredit i spelet om min varelse läggs till',
    'submit.submit_btn':     'Skicka in varelse',
    'submit.draft_resume':   'Återuppta',
    'submit.draft_fresh':    'Börja om',
    // Status messages
    'submit.no_picture':     'Lägg till en bild.',
    'submit.uploading':      'Laddar upp bild…',
    'submit.saving':         'Sparar din varelse…',
    'submit.success':        '🎉 Tack! Din varelse väntar på godkännande. Vi granskar den snart!',
    'submit.upload_error':   'Kunde inte ladda upp din bild. Försök igen.',
    'submit.save_error':     'Något gick fel när din varelse sparades. Försök igen.',
  },
};

// ── Core helpers ───────────────────────────────────────────────────────────

export function getLanguage(): Lang {
  if (typeof localStorage === 'undefined') return 'en';
  const stored = localStorage.getItem(LANG_KEY) as Lang | null;
  if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) return stored as Lang;
  if (typeof navigator !== 'undefined' && navigator.language.startsWith('sv')) return 'sv';
  return 'en';
}

export function setLanguage(lang: Lang): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lang);
  document.documentElement.setAttribute('lang', lang);
  applyTranslations(lang);
  window.dispatchEvent(new CustomEvent('codex:langchange', { detail: { lang } }));
}

/** Look up a translation key. Falls back to EN, then the raw key. */
export function t(key: string, lang?: Lang): string {
  const l = lang ?? getLanguage();
  return translations[l]?.[key] ?? translations.en[key] ?? key;
}

/**
 * Walk the DOM and swap all [data-i18n], [data-i18n-html], and
 * [data-i18n-placeholder] elements to the given language.
 */
export function applyTranslations(lang: Lang): void {
  // Plain text content
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const val = translations[lang]?.[el.dataset.i18n!] ?? translations.en[el.dataset.i18n!];
    if (val !== undefined) el.textContent = val;
  });
  // Inner HTML (for text that contains markup like <strong>)
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
    const val = translations[lang]?.[el.dataset.i18nHtml!] ?? translations.en[el.dataset.i18nHtml!];
    if (val !== undefined) el.innerHTML = val;
  });
  // Input / textarea placeholders
  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => {
    const val = translations[lang]?.[el.dataset.i18nPlaceholder!] ?? translations.en[el.dataset.i18nPlaceholder!];
    if (val !== undefined) (el as HTMLInputElement).placeholder = val;
  });
}
