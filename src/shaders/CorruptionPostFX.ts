/**
 * CorruptionPostFX — full-viewport corruption material effect for GameScene.
 *
 * Applied to the main camera and driven by the world's cleanse percentage.
 * The effect is a full passthrough at zero corruption. As the world becomes
 * more corrupted (player ignores shrines):
 *
 *   1. Domain-warped UV distortion — the world visually "breathes" and warps,
 *      like looking through diseased air. Uses fBm (fractal Brownian motion),
 *      the same algorithm as GameScene's terrain noise, applied to UV coords.
 *   2. Purple desaturation — RGB is lerped toward a luminance-preserving violet,
 *      draining warmth from the palette the way corruption drains life from the land.
 *   3. Pulsing vignette — a sinusoidal darkness closes in from the screen edges,
 *      giving a "closing darkness" feeling that intensifies with time.
 *   4. Corruption artefacts — rare bright violet pixel flickers, like the corruption
 *      breaking through the surface of reality.
 *
 * ## How to use
 * ```ts
 * // In scene create():
 * this.renderer.pipelines.addPostPipeline('CorruptionFX', CorruptionPostFX);
 * this.cameras.main.setPostPipeline('CorruptionFX');
 * this.corruptPipeline = this.cameras.main.getPostPipeline('CorruptionFX') as CorruptionPostFX;
 *
 * // In scene update():
 * this.corruptPipeline.setCorruption(globalCorruption01);
 * ```
 */

const CORRUPTION_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float     uTime;
uniform float     uCorruption;   // 0.0 = clean world, 1.0 = fully corrupted
varying vec2      outTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Fractal Brownian Motion — 3 octaves, same structure as GameScene's terrain.
// The octave loop gives depth and scale variation to the warp, preventing it
// from looking like simple noise repetition.
float fbm(vec2 p) {
  float  v     = 0.0;
  float  amp   = 0.5;
  vec2   shift = vec2(100.0); // DC offset prevents octaves from aliasing at origin
  for (int i = 0; i < 3; i++) {
    v  += amp * noise(p);
    p   = p * 2.1 + shift;
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Fast early-exit for the clean world (no corruption).
  // Avoids running any noise when uCorruption == 0.
  if (uCorruption < 0.01) {
    gl_FragColor = texture2D(uMainSampler, outTexCoord);
    return;
  }

  // ── 1. Domain-warped UV distortion ─────────────────────────────────────
  // Sample two independent fBm values to warp X and Y separately.
  // The time offsets make the warp animate — the world "breathes".
  // Amplitude scales with corruption so a clean world is perfectly still.
  vec2 warp = vec2(
    fbm(outTexCoord * 3.0 + vec2(uTime * 0.12, 0.0)),
    fbm(outTexCoord * 3.0 + vec2(0.0,          uTime * 0.09))
  );
  vec2 uv = outTexCoord + warp * 0.014 * uCorruption;
  vec4 col = texture2D(uMainSampler, clamp(uv, 0.001, 0.999));

  // ── 2. Purple desaturation ──────────────────────────────────────────────
  // Luminance-preserving recolour: compute perceptual brightness, then remap
  // to a violet using the same brightness. The mix ratio scales with corruption.
  float lum    = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  vec3  violet = vec3(lum * 0.55, lum * 0.28, lum * 0.75 + 0.08);
  col.rgb      = mix(col.rgb, violet, uCorruption * 0.45);

  // ── 3. Pulsing dark vignette ────────────────────────────────────────────
  // sin() creates a 1.3 Hz pulse. The vignette is darkest at the screen edges
  // (distance from centre > 0.4) and brightest at centre.
  float pulse    = 0.5 + 0.5 * sin(uTime * 1.3);
  float dist     = length(outTexCoord - 0.5) * 1.7;
  float vignette = 1.0 - smoothstep(0.35, 0.90, dist);
  col.rgb       *= mix(1.0, vignette, uCorruption * 0.35 * (0.7 + 0.3 * pulse));

  // ── 4. Corruption artefacts ─────────────────────────────────────────────
  // High-frequency noise animated quickly. step() keeps >97.5% of pixels dark,
  // making the bright violet flickers feel rare and unsettling rather than noisy.
  float flicker = step(0.975,
    noise(outTexCoord * 22.0 + vec2(uTime * 9.0, uTime * 3.5)));
  col.rgb += flicker * vec3(0.45, 0.0, 0.65) * uCorruption * 0.35;

  gl_FragColor = vec4(col.rgb, col.a);
}
`;

export class CorruptionPostFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'CorruptionPostFX',
      fragShader: CORRUPTION_FRAG,
    });
  }

  onPreRender(): void {
    // Guard: currentShader is undefined until the first render pass binds it.
    if (this.currentShader) this.set1f('uTime', this.game.loop.time * 0.001);
  }

  /**
   * Call from the scene's update() loop every frame.
   * @param value 0.0 = fully clean, 1.0 = maximum corruption
   */
  setCorruption(value: number): void {
    // Guard: currentShader may be unbound if called before the first render
    // (e.g., during a forced scene tick in tests before WebGL initialises).
    if (this.currentShader) this.set1f('uCorruption', value);
  }
}
