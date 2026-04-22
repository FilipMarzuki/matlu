/**
 * CorruptionFilter — Phaser 4 filter replacement for the v3 CorruptionPostFX.
 *
 * Full-viewport corruption visual effect driven by the world's cleanse percentage.
 * Passthrough at zero corruption. As the world becomes more corrupted:
 *
 *   1. Domain-warped UV distortion — the world visually "breathes" and warps.
 *   2. Purple desaturation — RGB lerps toward luminance-preserving violet.
 *   3. Pulsing vignette — sinusoidal darkness closes in from screen edges.
 *   4. Corruption artefacts — rare bright violet pixel flickers.
 *
 * ## How to use (Phaser 4)
 * ```ts
 * // In scene create():
 * const corruption = new CorruptionFilter(this.cameras.main);
 * this.cameras.main.filters.external.add(corruption);
 *
 * // In scene update():
 * corruption.setCorruption(globalCorruption01);
 * ```
 */

import * as Phaser from 'phaser';

// ── GLSL fragment shader ──────────────────────────────────────────────────────
// Identical to the v3 version. outTexCoord + uMainSampler are the standard
// Phaser 4 filter varyings/uniforms (same names as v3 PostFXPipeline).

const CORRUPTION_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float     uTime;
uniform float     uCorruption;
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

float fbm(vec2 p) {
  float  v     = 0.0;
  float  amp   = 0.5;
  vec2   shift = vec2(100.0);
  for (int i = 0; i < 3; i++) {
    v  += amp * noise(p);
    p   = p * 2.1 + shift;
    amp *= 0.5;
  }
  return v;
}

void main() {
  if (uCorruption < 0.01) {
    gl_FragColor = texture2D(uMainSampler, outTexCoord);
    return;
  }

  vec2 warp = vec2(
    fbm(outTexCoord * 3.0 + vec2(uTime * 0.12, 0.0)),
    fbm(outTexCoord * 3.0 + vec2(0.0,          uTime * 0.09))
  );
  vec2 uv = outTexCoord + warp * 0.014 * uCorruption;
  vec4 col = texture2D(uMainSampler, clamp(uv, 0.001, 0.999));

  float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  // Keep biome identity visible by tinting relative to source colour first,
  // then push only the darker bands toward deep purple-black.
  col.rgb = mix(col.rgb, col.rgb * vec3(0.90, 0.72, 1.08), uCorruption * 0.24);
  float shadowMask = 1.0 - smoothstep(0.14, 0.58, lum);
  vec3 shadowTint  = vec3(0.10, 0.03, 0.16);
  vec3 shadowGrade = col.rgb * vec3(0.46, 0.30, 0.72) + shadowTint * 0.42;
  col.rgb = mix(col.rgb, shadowGrade, uCorruption * shadowMask * 0.72);
  // Slight contrast boost keeps biome bands from collapsing into flat grey.
  col.rgb = clamp((col.rgb - 0.5) * (1.0 + uCorruption * 0.28) + 0.5, 0.0, 1.0);

  float pulse    = 0.5 + 0.5 * sin(uTime * 1.3);
  float dist     = length(outTexCoord - 0.5) * 1.7;
  float vignette = 1.0 - smoothstep(0.30, 0.88, dist);
  col.rgb       *= mix(1.0, vignette, uCorruption * 0.52 * (0.65 + 0.35 * pulse));

  float flicker = step(0.977,
    noise(outTexCoord * 22.0 + vec2(uTime * 9.0, uTime * 3.5)));
  col.rgb += flicker * vec3(0.62, 0.05, 0.86) * uCorruption * 0.28;

  gl_FragColor = vec4(col.rgb, col.a);
}
`;

// ── Render node (BaseFilterShader) ────────────────────────────────────────────
// Registered once at boot, shared by all CorruptionFilter controller instances.

const RENDER_NODE_KEY = 'FilterCorruption';

class FilterCorruptionNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(
    manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager,
  ) {
    super(RENDER_NODE_KEY, manager, undefined, CORRUPTION_FRAG);
  }

  /**
   * Called by the filter pipeline for each controller using this node.
   * Sets uniforms from the controller, then delegates to the base run().
   */
  run(
    controller: CorruptionFilter,
    inputDrawingContext: Phaser.Renderer.WebGL.DrawingContext,
    outputDrawingContext?: Phaser.Renderer.WebGL.DrawingContext,
    padding?: Phaser.Geom.Rectangle,
  ): Phaser.Renderer.WebGL.DrawingContext {
    const time = this.manager.renderer.game.loop.time * 0.001;
    this.programManager.setUniform('uTime', time);
    this.programManager.setUniform('uCorruption', controller.corruption);
    return super.run(controller, inputDrawingContext, outputDrawingContext, padding);
  }
}

// ── Controller (public API) ───────────────────────────────────────────────────

export class CorruptionFilter extends Phaser.Filters.Controller {
  /** 0.0 = fully clean, 1.0 = maximum corruption */
  corruption = 0;

  /** Elapsed time in seconds — updated each frame by the scene */
  time = 0;

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    // Ensure the render node is registered (idempotent).
    const renderer = camera.scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer.renderNodes.hasNode(RENDER_NODE_KEY)) {
      renderer.renderNodes.addNodeConstructor(RENDER_NODE_KEY, FilterCorruptionNode);
    }

    super(camera, RENDER_NODE_KEY);
  }

  /**
   * Call from the scene's update() loop every frame.
   * @param value 0.0 = fully clean, 1.0 = maximum corruption
   */
  setCorruption(value: number): this {
    this.corruption = Math.max(0, Math.min(1, value));
    return this;
  }

  /**
   * Call from the scene's update() to keep the shader time in sync.
   * Typically: `filter.setTime(this.game.loop.time * 0.001)`
   */
  setTime(seconds: number): this {
    this.time = seconds;
    return this;
  }
}
