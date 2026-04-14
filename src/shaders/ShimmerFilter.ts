/**
 * ShimmerFilter — Phaser 4 filter replacement for the v3 ShimmerPostFX.
 *
 * Animated stone shimmer for the colosseum arena. Two noise layers:
 *   1. Micro-surface UV warp — barely perceptible, makes stone feel real.
 *   2. Drifting warm specular highlight — ambient light on polished patches.
 *
 * ## How to use (Phaser 4)
 * ```ts
 * // In scene create():
 * const shimmer = new ShimmerFilter(this.cameras.main);
 * this.cameras.main.filters.external.add(shimmer);
 * ```
 * Time is updated automatically via the game loop — no per-frame call needed
 * unless you want to pause/offset the animation.
 */

import * as Phaser from 'phaser';

const SHIMMER_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float     uTime;
varying vec2      outTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 shift = 0.003 * vec2(
    noise(outTexCoord * 8.0 + vec2(uTime * 0.20, 0.0)),
    noise(outTexCoord * 8.0 + vec2(0.0,          uTime * 0.15))
  );
  vec4 col = texture2D(uMainSampler, outTexCoord + shift);

  float spec = smoothstep(0.58, 0.85,
    noise(outTexCoord * 3.5 + vec2(uTime * 0.06, uTime * 0.04)));
  col.rgb += spec * 0.05 * vec3(1.0, 0.88, 0.65);

  gl_FragColor = col;
}
`;

const RENDER_NODE_KEY = 'FilterShimmer';

class FilterShimmerNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(
    manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager,
  ) {
    super(RENDER_NODE_KEY, manager, undefined, SHIMMER_FRAG);
  }

  run(
    controller: ShimmerFilter,
    inputDrawingContext: Phaser.Renderer.WebGL.DrawingContext,
    outputDrawingContext?: Phaser.Renderer.WebGL.DrawingContext,
    padding?: Phaser.Geom.Rectangle,
  ): Phaser.Renderer.WebGL.DrawingContext {
    // Self-source time from the game loop — no per-frame scene call needed.
    const time = this.manager.renderer.game.loop.time * 0.001;
    this.programManager.setUniform('uTime', time);
    return super.run(controller, inputDrawingContext, outputDrawingContext, padding);
  }
}

export class ShimmerFilter extends Phaser.Filters.Controller {
  /** Elapsed time in seconds */
  time = 0;

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    const renderer = camera.scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer.renderNodes.hasNode(RENDER_NODE_KEY)) {
      renderer.renderNodes.addNodeConstructor(RENDER_NODE_KEY, FilterShimmerNode);
    }

    super(camera, RENDER_NODE_KEY);
  }

  /** Update time from the scene's game loop. */
  setTime(seconds: number): this {
    this.time = seconds;
    return this;
  }
}
