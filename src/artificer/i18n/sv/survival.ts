import type { survival } from '../en/survival';

/** Vägen till överlevnad på svenska (#1793, `guide`): FOKUS-knappens steg och väljarens checklista. */
export const survivalSv: Record<keyof typeof survival, string> = {
  'path.chip': 'Överleva {n}/{total}:',
  'path.chipTip': 'Överleva, steg {n} av {total}: {step}. Tryck för stegen.',
  'path.step.site': 'hitta en lägerplats',
  'path.step.camp': 'slå läger',
  'path.step.roof': 'tak över huvudet',
  'path.step.food': 'mat i förråd',
  'path.step.winter': 'redo för vintern',
  'path.hint.site': 'Utforska tills du hittar en bra plats att slå läger på.',
  'path.hint.camp': 'Slå läger på en av platserna du känner till.',
  'path.hint.roof': 'Bygg ett skydd i lägret.',
  'path.hint.food': 'Lägg undan mat för {n} nätter: {have} hittills.',
  'path.hint.winter': 'Fyll skafferiet och vedtraven, och gör skyddet varmt nog för vintern.',
  'path.head': 'ÖVERLEVA',
  'path.done': 'klart',
  'path.now': 'nu',
  'path.suggest': 'Fokus: {goal}',
  'path.suggestTip': 'Sätt ditt fokus på {goal}: det hjälper med det här steget',
  'path.focused': 'Ditt fokus: {goal}',
};
