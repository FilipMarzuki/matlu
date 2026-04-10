/**
 * ShimmerPostFX — animated stone shimmer for the colosseum arena.
 *
 * Applied as a PostFX to the arena camera so the entire scene gets one cheap
 * render pass instead of one pass per tile. Two noise layers:
 *
 *   1. Micro-surface UV warp (0.003 amplitude) — barely perceptible but makes
 *      the stone feel like real polished/worn material with micro-imperfections.
 *   2. Drifting warm specular highlight — ambient light catching polished patches,
 *      giving the floor that "shifting material feel" from a moving light source.
 *
 * PostFXPipeline vs. regular WebGLPipeline:
 *   PostFXPipeline takes the already-rendered scene texture as input and applies
 *   the fragment shader to it — you only write a fragment shader, no vertex shader
 *   needed. Phaser handles all the UV coords and texture binding automatically.
 */

const SHIMMER_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float     uTime;
varying vec2      outTexCoord;

// Quick value noise — no texture lookup needed, entirely arithmetic.
// Returns [0, 1] for any 2-D lattice point.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Bilinear-interpolated value noise — smooth and cheap.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Hermite smoothstep on the fractional part kills grid artifacts
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  // ── Micro-surface UV warp ───────────────────────────────────────────────
  // Two independent noise samples offset the texture coordinate by a tiny
  // amount. The result looks like the surface has micro-bumps and grain —
  // same principle as a normal map but without the lighting math.
  vec2 shift = 0.003 * vec2(
    noise(outTexCoord * 8.0 + vec2(uTime * 0.20, 0.0)),
    noise(outTexCoord * 8.0 + vec2(0.0,          uTime * 0.15))
  );
  vec4 col = texture2D(uMainSampler, outTexCoord + shift);

  // ── Drifting warm specular ──────────────────────────────────────────────
  // A slowly moving noise field picks out "polished" patches and adds a
  // warm (travertine/limestone) reflection. Amplitude is very low (0.05)
  // so it reads as material variation, not a light source.
  float spec = smoothstep(0.58, 0.85,
    noise(outTexCoord * 3.5 + vec2(uTime * 0.06, uTime * 0.04)));
  col.rgb += spec * 0.05 * vec3(1.0, 0.88, 0.65);

  gl_FragColor = col;
}
`;

export class ShimmerPostFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'ShimmerPostFX',
      fragShader: SHIMMER_FRAG,
    });
  }

  /**
   * Called once per frame before rendering begins.
   * We update uTime here so all game objects sharing this pipeline see the
   * same timestamp — coherent animation without per-object uniform uploads.
   */
  onPreRender(): void {
    this.set1f('uTime', this.game.loop.time * 0.001);
  }
}
