# Animal SFX

Place the following CC0 audio files here to activate FIL-47 positional animal sounds:

| File | Description | Source |
|------|-------------|--------|
| `bird-call.ogg` | Bird / crow call | Freesound.org CC0 — search "crow call" or "bird call forest" |
| `deer-call.ogg` | Deer / stag call | Freesound.org CC0 — search "deer call" |
| `hare-rustle.ogg` | Hare rustle / movement | Freesound.org CC0 — search "rabbit rustle" |
| `fox-bark.ogg` | Fox bark | Freesound.org CC0 — search "fox bark" |

Alternatively: [Kenney Animal Pack](https://kenney.nl/assets/animal-pack-redux) (CC0, free).

Then point the sound's entry in `src/data/audio-manifest.json` at the file
(`animal-bird`, `animal-deer`, `animal-hare`, `animal-fox`; e.g.
`"files": ["assets/audio/animal/bird-call.ogg"]`). Until then those entries have
`"files": []` and the game doesn't request them: a missing file isn't a 404 here,
the server answers with index.html, and decoding that failed on every page load
(#1489). The dev/ audio editor's Replace button uploads a file and updates the
manifest in one step.

Once files are committed, remove the `blocked` label from FIL-47 and add `ready`.
