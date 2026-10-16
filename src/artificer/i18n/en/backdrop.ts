/**
 * English for the living backdrop's one control (#1802, artificer-app/backdrop.ts, ui switch
 * `backdrop`): under the help (?), a way to keep the scene behind the boxes still on a slow tablet.
 */
export const backdrop = {
  'backdrop.head': 'THE BACKDROP',
  'backdrop.still': 'Keep it still',
  'backdrop.stillTip': 'Stop the rain, snow and fog moving behind the boxes (for a slow tablet)',
} as const satisfies Record<string, string>;
