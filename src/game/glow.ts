import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

type Rgb = readonly [number, number, number];

/** Bloom and a light color grade for one time of day. */
export type Glow = {
  /** Display brightness (brightest channel) where bloom starts, and how softly it fades in. */
  threshold: number;
  knee: number;
  strength: number;
  saturation: number;
  contrast: number;
  /** How much the corners darken. */
  vignette: number;
  /** Tint added to the shadows, and a multiplier on the highlights. */
  lift: Rgb;
  gain: Rgb;
};

const UP_WEIGHT = 0.8;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Brightest channel rather than luma, so warm windows and lamps glow as much as white ones.
const BRIGHT = /* glsl */ `
  uniform sampler2D tFrame; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
  varying vec2 vUv;
  vec3 pick(vec2 uv) {
    vec3 c = texture2D(tFrame, uv).rgb;
    float m = max(c.r, max(c.g, c.b));
    float w = smoothstep(uThreshold - uKnee, uThreshold + uKnee, m);
    return c * c * w;
  }
  void main() {
    // Four bilinear taps cover a 4x4 block, so lights a pixel or two wide still count.
    vec3 c = pick(vUv + uTexel * vec2(-1.0, -1.0)) + pick(vUv + uTexel * vec2(1.0, -1.0))
           + pick(vUv + uTexel * vec2(-1.0, 1.0)) + pick(vUv + uTexel * vec2(1.0, 1.0));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;

// Dual-filter (Kawase) blur: cheap enough for phones, wide enough to glow.
const DOWN = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 h = uTexel;
    vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
    c += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb;
    c += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb;
    c += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb;
    c += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb;
    gl_FragColor = vec4(c / 8.0, 1.0);
  }`;

const UP = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
  varying vec2 vUv;
  void main() {
    vec2 h = uTexel;
    vec3 c = texture2D(tSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb;
    c += texture2D(tSrc, vUv + vec2(2.0 * h.x, 0.0)).rgb;
    c += texture2D(tSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb;
    c += texture2D(tSrc, vUv + vec2(0.0, 2.0 * h.y)).rgb;
    c += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    c += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
    c += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
    c += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
    gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
  }`;

const FINAL = /* glsl */ `
  uniform sampler2D tFrame; uniform sampler2D tBloom;
  uniform float uStrength; uniform float uNorm; uniform float uSaturation; uniform float uContrast; uniform float uVignette;
  uniform vec3 uLift; uniform vec3 uGain; uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tFrame, vUv).rgb;
    // Screen blend keeps the glow from clipping bright areas to flat white.
    vec3 b = clamp(sqrt(texture2D(tBloom, vUv).rgb * uNorm) * uStrength, 0.0, 1.0);
    c = 1.0 - (1.0 - c) * (1.0 - b);
    c = (c - 0.5) * uContrast + 0.5;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    c = c * uGain + uLift * (1.0 - c);
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(p));
    // A whisper of noise hides banding in the dark gradients.
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) + (n - 0.5) / 255.0, 1.0);
  }`;

function pass(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  blending: THREE.Blending,
) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    blending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Glow over the finished frame: copies what was just drawn, blooms the brightest parts and
 * draws it back with a light grade. Working on the finished frame keeps the scene's look,
 * fog and haze exactly as they are; this only adds light on top.
 */
export function createGlow(renderer: THREE.WebGLRenderer, look: Glow, levels: number) {
  const type =
    renderer.extensions.has("EXT_color_buffer_half_float") ||
    renderer.extensions.has("EXT_color_buffer_float")
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
  const size = new THREE.Vector2();
  let frame: THREE.FramebufferTexture | null = null;
  let mips: THREE.WebGLRenderTarget[] = [];

  const bright = pass(
    BRIGHT,
    {
      tFrame: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: look.threshold },
      uKnee: { value: look.knee },
    },
    THREE.NoBlending,
  );
  const down = pass(
    DOWN,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    THREE.NoBlending,
  );
  const up = pass(
    UP,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
    THREE.AdditiveBlending,
  );
  const final = pass(
    FINAL,
    {
      tFrame: { value: null },
      tBloom: { value: null },
      uStrength: { value: look.strength },
      uNorm: { value: 1 },
      uSaturation: { value: look.saturation },
      uContrast: { value: look.contrast },
      uVignette: { value: look.vignette },
      uLift: { value: new THREE.Vector3(...look.lift) },
      uGain: { value: new THREE.Vector3(...look.gain) },
      uAspect: { value: 1 },
    },
    THREE.NoBlending,
  );
  const quad = new FullScreenQuad(bright);

  function setSize() {
    renderer.getDrawingBufferSize(size);
    if (frame && frame.image.width === size.x && frame.image.height === size.y) return;
    frame?.dispose();
    frame = new THREE.FramebufferTexture(size.x, size.y);
    frame.minFilter = THREE.LinearFilter;
    frame.magFilter = THREE.LinearFilter;
    for (const rt of mips) rt.dispose();
    mips = [];
    let w = size.x;
    let h = size.y;
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      mips.push(
        new THREE.WebGLRenderTarget(w, h, {
          type,
          depthBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        }),
      );
    }
    final.uniforms.uAspect!.value = size.x / size.y;
    // The levels add up on the way back; scale the sum back to the bright pass's own range.
    let sum = 0;
    for (let i = 0; i < levels; i++) sum += UP_WEIGHT ** i;
    final.uniforms.uNorm!.value = 1 / sum;
  }

  function draw(target: THREE.WebGLRenderTarget | null, material: THREE.ShaderMaterial) {
    renderer.setRenderTarget(target);
    quad.material = material;
    quad.render(renderer);
  }

  return {
    /** Call right after the frame is drawn to the screen. */
    render() {
      setSize();
      if (!frame || !mips.length) return;
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(frame);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;

      bright.uniforms.tFrame!.value = frame;
      (bright.uniforms.uTexel!.value as THREE.Vector2).set(1 / size.x, 1 / size.y);
      draw(mips[0]!, bright);
      for (let i = 1; i < mips.length; i++) {
        const src = mips[i - 1]!;
        down.uniforms.tSrc!.value = src.texture;
        (down.uniforms.uTexel!.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
        draw(mips[i]!, down);
      }
      // Each level adds back into the one above it, so the glow has a tight core and a wide halo.
      for (let i = mips.length - 1; i > 0; i--) {
        const src = mips[i]!;
        up.uniforms.tSrc!.value = src.texture;
        (up.uniforms.uTexel!.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
        up.uniforms.uWeight!.value = UP_WEIGHT;
        draw(mips[i - 1]!, up);
      }

      final.uniforms.tFrame!.value = frame;
      final.uniforms.tBloom!.value = mips[0]!.texture;
      draw(null, final);
      renderer.autoClear = autoClear;
    },
    dispose() {
      frame?.dispose();
      for (const rt of mips) rt.dispose();
      for (const m of [bright, down, up, final]) m.dispose();
      quad.dispose();
    },
  };
}
