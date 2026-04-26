/**
 * Minimal GLSL pair for Phaser 4 `GameObjects.Shader` — samples an atlas and
 * replaces up to three source RGBs with destinations when within `uThresh`
 * (Euclidean distance in linear RGB). Used only by the #703 spike scene.
 *
 * Phaser's ShaderQuad supplies `inPosition`, `inTexCoord`, `uProjectionMatrix`,
 * and sets `uMainSampler` to texture unit 0 via setupUniforms.
 */

export const SPRITE_RECOLOR_PALETTE_VERT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform mat4 uProjectionMatrix;
attribute vec2 inPosition;
attribute vec2 inTexCoord;
varying vec2 outTexCoord;
void main () {
    gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);
    outTexCoord = inTexCoord;
}
`.trim();

export const SPRITE_RECOLOR_PALETTE_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMainSampler;
uniform vec3 uSrc0;
uniform vec3 uSrc1;
uniform vec3 uSrc2;
uniform vec3 uDst0;
uniform vec3 uDst1;
uniform vec3 uDst2;
uniform float uThresh;
varying vec2 outTexCoord;

void main () {
  vec4 tex = texture2D(uMainSampler, outTexCoord);
  vec3 c = tex.rgb;
  if (distance(c, uSrc0) < uThresh) {
    c = uDst0;
  } else if (distance(c, uSrc1) < uThresh) {
    c = uDst1;
  } else if (distance(c, uSrc2) < uThresh) {
    c = uDst2;
  }
  gl_FragColor = vec4(c, tex.a);
}
`.trim();
