/*
 * Glaux — Video Clarity
 * Content script: finds <video> elements, renders an upscaled + sharpened copy
 * of each frame on a WebGL2 canvas laid exactly over the video, and adds
 * in-player controls (native YouTube buttons or a floating frosted pill) plus a
 * draggable before/after split.
 *
 * Pipeline (all on the GPU, nothing leaves the device):
 *   1. Catmull-Rom bicubic upscale to the real on-screen pixel size, with a
 *      2x2 min/max clamp to suppress ringing halos.
 *   2. Contrast-adaptive sharpening (RCAS-style lobe) with optional noise
 *      guard so compression blocks and grain are not amplified.
 */
(() => {
  'use strict';
  if (window.__glauxLoaded) return;
  window.__glauxLoaded = true;

  // Same code on Chromium (chrome.*) and Firefox (browser.*, promise-based).
  const api = globalThis.browser ?? globalThis.chrome;
  const t = (key, subs) => {
    try { return api.i18n.getMessage(key, subs) || key; } catch { return key; }
  };

  // ---------------------------------------------------------------- settings
  const DEFAULTS = {
    enabled: true,
    autoOn: false,
    sharpness: 60,
    denoise: true,
    showButton: true,
    maxOutput: 3840,
    disabledSites: []
  };
  let settings = { ...DEFAULTS };
  const HOST = location.hostname;
  const siteDisabled = () => settings.disabledSites.includes(HOST);
  const allowed = () => settings.enabled && !siteDisabled();

  const MIN_W = 200, MIN_H = 112;
  const instances = new Map(); // HTMLVideoElement -> Enhancer
  let uid = 0;

  // ---------------------------------------------------------------- shaders
  const VS = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  // Pass 1: Catmull-Rom upscale (9 bilinear taps) + anti-halo clamp
  const FS_UPSCALE = `#version 300 es
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uSrcSize;
  uniform vec4 uCrop;          // xy = scale, zw = offset (object-fit)
  in vec2 vUv;
  out vec4 outColor;

  void main(){
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y) * uCrop.xy + uCrop.zw;
    vec2 sp  = uv * uSrcSize;
    vec2 tp1 = floor(sp - 0.5) + 0.5;
    vec2 f   = sp - tp1;

    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 off12 = w2 / w12;

    vec2 t0  = (tp1 - 1.0) / uSrcSize;
    vec2 t3  = (tp1 + 2.0) / uSrcSize;
    vec2 t12 = (tp1 + off12) / uSrcSize;

    vec3 c = vec3(0.0);
    c += texture(uTex, vec2(t0.x,  t0.y )).rgb * w0.x  * w0.y;
    c += texture(uTex, vec2(t12.x, t0.y )).rgb * w12.x * w0.y;
    c += texture(uTex, vec2(t3.x,  t0.y )).rgb * w3.x  * w0.y;
    c += texture(uTex, vec2(t0.x,  t12.y)).rgb * w0.x  * w12.y;
    c += texture(uTex, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
    c += texture(uTex, vec2(t3.x,  t12.y)).rgb * w3.x  * w12.y;
    c += texture(uTex, vec2(t0.x,  t3.y )).rgb * w0.x  * w3.y;
    c += texture(uTex, vec2(t12.x, t3.y )).rgb * w12.x * w3.y;
    c += texture(uTex, vec2(t3.x,  t3.y )).rgb * w3.x  * w3.y;

    // anti-ringing: clamp to min/max of the 4 nearest texels
    ivec2 maxI = ivec2(uSrcSize) - 1;
    ivec2 i0 = clamp(ivec2(floor(sp - 0.5)), ivec2(0), maxI);
    ivec2 i1 = clamp(i0 + 1, ivec2(0), maxI);
    vec3 a = texelFetch(uTex, i0, 0).rgb;
    vec3 b = texelFetch(uTex, ivec2(i1.x, i0.y), 0).rgb;
    vec3 d = texelFetch(uTex, ivec2(i0.x, i1.y), 0).rgb;
    vec3 e = texelFetch(uTex, i1, 0).rgb;
    vec3 mn = min(min(a, b), min(d, e));
    vec3 mx = max(max(a, b), max(d, e));
    outColor = vec4(clamp(c, mn, mx), 1.0);
  }`;

  // Pass 2: contrast-adaptive sharpening (RCAS-style) + before/after split
  const FS_SHARPEN = `#version 300 es
  precision highp float;
  uniform sampler2D uUp;       // upscaled image (output resolution)
  uniform sampler2D uSrc;      // original video ("before" side)
  uniform vec4 uCrop;
  uniform float uSharp;        // 0..1
  uniform float uDenoise;      // 0 ou 1
  uniform float uSplit;        // <0 disabled; otherwise x position in pixels
  uniform vec2 uOutSize;
  in vec2 vUv;
  out vec4 outColor;

  const float LIMIT = 0.25 - (1.0 / 16.0);

  float luma(vec3 c){ return c.g + 0.5 * (c.r + c.b); }

  void main(){
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 mx = ivec2(uOutSize) - 1;

    if (uSplit >= 0.0) {
      float x = gl_FragCoord.x;
      if (abs(x - uSplit) < 1.0) { outColor = vec4(1.0, 0.12, 0.31, 1.0); return; }
      if (x < uSplit) {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y) * uCrop.xy + uCrop.zw;
        outColor = vec4(texture(uSrc, uv).rgb, 1.0);
        return;
      }
    }

    vec3 e = texelFetch(uUp, p, 0).rgb;
    if (uSharp <= 0.001) { outColor = vec4(e, 1.0); return; }

    vec3 b = texelFetch(uUp, clamp(p + ivec2( 0,  1), ivec2(0), mx), 0).rgb;
    vec3 d = texelFetch(uUp, clamp(p + ivec2(-1,  0), ivec2(0), mx), 0).rgb;
    vec3 f = texelFetch(uUp, clamp(p + ivec2( 1,  0), ivec2(0), mx), 0).rgb;
    vec3 h = texelFetch(uUp, clamp(p + ivec2( 0, -1), ivec2(0), mx), 0).rgb;

    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));

    vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1e-5);
    vec3 hitMax = (1.0 - max(mx4, e)) / (4.0 * mn4 - 4.0 - 1e-5);
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(-LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharp;

    if (uDenoise > 0.5) {
      float bl = luma(b), dl = luma(d), fl = luma(f), hl = luma(h), el = luma(e);
      float nz = 0.25 * (bl + dl + fl + hl) - el;
      float range = max(max(max(bl, dl), max(fl, hl)), el) - min(min(min(bl, dl), min(fl, hl)), el);
      nz = clamp(abs(nz) / max(range, 1e-5), 0.0, 1.0);
      lobe *= -0.5 * nz + 1.0;
    }

    vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
    outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader: ' + log);
    }
    return s;
  }
  function program(gl, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  // ---------------------------------------------------------------- renderer
  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: 'high-performance', desynchronized: true
      });
      if (!gl) throw new Error('WebGL2 unavailable');
      this.gl = gl;
      this.up = program(gl, FS_UPSCALE);
      this.sh = program(gl, FS_SHARPEN);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.srcTex = this._tex(gl.LINEAR);
      this.upTex = this._tex(gl.NEAREST);
      this.fbo = gl.createFramebuffer();
      this.fboW = 0; this.fboH = 0;
    }
    _tex(filter) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    _ensureFbo(w, h) {
      if (w === this.fboW && h === this.fboH) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.upTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.upTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.fboW = w; this.fboH = h;
    }
    // Throws SecurityError for cross-origin video without CORS.
    draw(video, outW, outH, crop, opts) {
      const gl = this.gl;
      const vw = video.videoWidth, vh = video.videoHeight;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

      this._ensureFbo(outW, outH);
      gl.bindVertexArray(this.vao);

      // pass 1 -> FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, outW, outH);
      gl.useProgram(this.up.p);
      gl.uniform1i(this.up.u.uTex, 0);
      gl.uniform2f(this.up.u.uSrcSize, vw, vh);
      gl.uniform4f(this.up.u.uCrop, crop[0], crop[1], crop[2], crop[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // pass 2 -> screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, outW, outH);
      gl.useProgram(this.sh.p);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.upTex);
      gl.uniform1i(this.sh.u.uUp, 1);
      gl.uniform1i(this.sh.u.uSrc, 0);
      gl.uniform4f(this.sh.u.uCrop, crop[0], crop[1], crop[2], crop[3]);
      gl.uniform1f(this.sh.u.uSharp, opts.sharp);
      gl.uniform1f(this.sh.u.uDenoise, opts.denoise ? 1 : 0);
      gl.uniform1f(this.sh.u.uSplit, opts.split);
      gl.uniform2f(this.sh.u.uOutSize, outW, outH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  // ---------------------------------------------------------------- icons (24-unit grid, like YouTube's)
  const SPARK = 'M12 2.5c.7 4.6 4.3 8.2 9 9-4.7.7-8.3 4.3-9 9-.7-4.7-4.3-8.3-9-9 4.7-.8 8.3-4.4 9-9z';
  const iconSpark = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="rf-spark" d="${SPARK}" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`;
  const iconCompare = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 3h2v18h-2z" fill="#fff"/>
      <path d="M9.5 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4.5v-2H5V8h4.5zM14.5 6H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4.5z" fill="#fff"/>
    </svg>`;

  // ---------------------------------------------------------------- styles
  // Same "frosted" material as YouTube's own player controls:
  //   pills:    rgba(0,0,0,.3) + backdrop-filter: blur(16px), radius 28px
  //   overlays: rgba(0,0,0,.6) + blur(16px)
  const FONT = '"YouTube Sans", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
  const UI_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .frost { background: rgba(0,0,0,.3); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
      color: #fff; text-shadow: 0 0 2px rgba(0,0,0,.5); }
    .frost.dense { background: rgba(0,0,0,.6); }
    .fade { transition: opacity .2s ease, transform .2s ease; }

    /* floating pill, centered at the top of the video */
    .pill { position: fixed; z-index: 2147483646; display: flex; align-items: center; height: 40px; padding: 0 4px;
      border-radius: 28px; font: 500 14px/1 ${FONT};
      opacity: 0; transform: translateY(-4px); pointer-events: none; }
    .pill.show { opacity: 1; transform: none; pointer-events: auto; }
    .pill button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; height: 40px;
      padding: 0 14px 0 12px; border-radius: 28px; white-space: nowrap; transition: background .15s; }
    .pill button:hover { background: rgba(255,255,255,.1); }
    .pill button:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.9); }
    .pill button.cmp { padding: 0 12px; }
    .pill button.cmp[hidden] { display: none; }
    .pill button.cmp.on { background: rgba(255,255,255,.2); }
    .pill button.na { opacity: .5; cursor: not-allowed; }
    .pill svg { width: 24px; height: 24px; flex: none; }
    .pill .tag { opacity: .7; font-variant-numeric: tabular-nums; }
    .pill .sep { width: 1px; height: 20px; background: rgba(255,255,255,.2); }
    .pill .sep[hidden] { display: none; }
    .rf-spark { fill: none; stroke: #fff; }
    .on .rf-spark { fill: #fff; }

    /* before/after split */
    .split { position: fixed; z-index: 2147483645; pointer-events: none; display: none; }
    .split.show { display: block; }
    .line { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff;
      box-shadow: 0 0 4px rgba(0,0,0,.6); }
    .knob { position: absolute; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      pointer-events: auto; cursor: ew-resize; display: grid; place-items: center; touch-action: none;
      box-shadow: inset 0 0 0 2px #fff; transition: transform .15s; }
    .knob:hover { background: rgba(0,0,0,.45); }
    .knob:active { transform: scale(1.08); }
    .knob:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    .knob svg { width: 24px; height: 24px; }
    .chip { position: absolute; bottom: 64px; height: 28px; padding: 0 12px; display: flex; align-items: center;
      border-radius: 28px; font: 500 13px/1 ${FONT}; transition: opacity .2s; }
    .chip.l { right: calc(100% - var(--x) + 12px); }
    .chip.r { left: calc(var(--x) + 12px); }

    /* toast, like YouTube's bezel text */
    .toast { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px 0 12px;
      border-radius: 28px; font: 500 14px/1 ${FONT};
      opacity: 0; transform: translate(-50%, -6px); pointer-events: none; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .toast svg { width: 22px; height: 22px; }
    .toast .tag { opacity: .7; font-variant-numeric: tabular-nums; }

    @media (prefers-reduced-transparency: reduce) {
      .frost { background: rgba(20,20,20,.92); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    @media (prefers-reduced-motion: reduce) { .fade { transition: opacity .1s; transform: none !important; } }
  `;

  // Styles for the buttons we inject into YouTube's own control bar (page DOM).
  const YT_CSS = `
    .glaux-yt-btn { position: relative; display: inline-flex !important; align-items: center; justify-content: center; vertical-align: top; }
    .glaux-yt-btn svg { width: 24px; height: 24px; pointer-events: none; }
    .glaux-yt-btn .rf-spark { fill: none; stroke: #fff; }
    .glaux-yt-btn[aria-pressed="true"] .rf-spark { fill: #fff; }
    .glaux-yt-btn[aria-pressed="true"]::after { content: ""; position: absolute; left: 50%; bottom: 4px; width: 4px; height: 4px;
      margin-left: -2px; border-radius: 50%; background: #fff; }
    .glaux-yt-btn.glaux-na { opacity: .45; }
    .glaux-yt-cmp[hidden] { display: none !important; }
  `;
  function ensureYtStyle() {
    if (document.getElementById('glaux-yt-style')) return;
    const s = document.createElement('style');
    s.id = 'glaux-yt-style';
    s.textContent = YT_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------------------------------------------------------------- per-video controller
  class Enhancer {
    constructor(video) {
      this.video = video;
      this.id = ++uid;
      this.active = false;
      this.compare = false;
      this.split = 0.5;
      this.unsupported = '';
      this.canvas = null;
      this.renderer = null;
      this.vfc = 0;
      this.raf = 0;
      this.outW = 0; this.outH = 0;
      this.ytBtn = null; this.ytCmp = null;
      this._buildUI();
      this.ensureYtButtons();
      this.ro = new ResizeObserver(() => { this.renderOnce(); this.syncOverlay(); });
      this.ro.observe(video);
      this._onMeta = () => { this.renderOnce(); this._refreshUI(); };
      video.addEventListener('loadedmetadata', this._onMeta);
      video.addEventListener('seeked', this._onMeta);
      if (settings.autoOn && allowed()) this.setActive(true, true);
    }

    // ---------- shadow UI
    _buildUI() {
      this.host = document.createElement('glaux-ui');
      const root = this.host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${UI_CSS}</style>
        <div class="pill frost fade" part="pill">
          <button class="main" type="button">${iconSpark()}<span class="lbl">Glaux</span><span class="tag"></span></button>
          <span class="sep" hidden></span>
          <button class="cmp" type="button" hidden>${iconCompare()}</button>
        </div>
        <div class="split">
          <div class="chip l frost dense">${t('labelOriginal')}</div>
          <div class="chip r frost dense">${t('labelEnhanced')}</div>
          <div class="line"></div>
          <div class="knob frost" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-label="${t('splitHandle')}" title="${t('splitHandle')}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>
        <div class="toast frost dense fade"><span class="ti on">${iconSpark()}</span><span class="tt"></span><span class="tag"></span></div>`;
      this.root = root;
      this.pill = root.querySelector('.pill');
      this.btn = root.querySelector('.main');
      this.tag = root.querySelector('.pill .tag');
      this.cmpBtn = root.querySelector('.cmp');
      this.sep = root.querySelector('.sep');
      this.splitEl = root.querySelector('.split');
      this.lineEl = root.querySelector('.line');
      this.knob = root.querySelector('.knob');
      this.chipL = root.querySelector('.chip.l');
      this.chipR = root.querySelector('.chip.r');
      this.toastEl = root.querySelector('.toast');
      this.toastText = root.querySelector('.toast .tt');
      this.toastTag = root.querySelector('.toast .tag');

      const swallow = (e) => e.stopPropagation();
      for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown']) {
        this.pill.addEventListener(ev, swallow);
        this.knob.addEventListener(ev, swallow);
      }
      this.btn.addEventListener('click', (e) => { e.preventDefault(); this.toggle(); });
      this.cmpBtn.addEventListener('click', (e) => { e.preventDefault(); this.toggleCompare(); });

      // draggable split handle
      this.knob.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.knob.setPointerCapture(e.pointerId);
        this.dragging = true;
      });
      this.knob.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        const cr = this._contentRect(this.video.getBoundingClientRect());
        this._setSplit((e.clientX - cr.left) / cr.width);
      });
      const end = () => { this.dragging = false; };
      this.knob.addEventListener('pointerup', end);
      this.knob.addEventListener('pointercancel', end);
      this.knob.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowLeft') this._setSplit(this.split - step);
        else if (e.key === 'ArrowRight') this._setSplit(this.split + step);
        else if (e.key === 'Home') this._setSplit(0);
        else if (e.key === 'End') this._setSplit(1);
        else if (e.key === 'Escape') this.toggleCompare();
        else return;
        e.preventDefault();
      });
      this._mountUI();
      this._refreshUI();
    }
    _setSplit(v) {
      this.split = Math.min(1, Math.max(0, v));
      this.syncOverlay();
      if (this.video.paused || this.video.ended) this.renderOnce();
    }
    _mountUI() {
      const fs = document.fullscreenElement;
      const parent = fs && fs !== this.video && fs.contains(this.video) ? fs : document.documentElement;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    // ---------- native YouTube buttons
    ensureYtButtons() {
      const player = this.video.closest('.html5-video-player');
      if (!player) return;
      const bar = player.querySelector('.ytp-right-controls');
      if (!bar) return;
      if (this.ytBtn && this.ytBtn.isConnected && this.ytBtn.parentNode === bar) return;
      if (bar.querySelector('.glaux-yt-main')) return; // another instance already owns it
      ensureYtStyle();
      const mk = (cls, html, onClick) => {
        const b = document.createElement('button');
        b.className = 'ytp-button glaux-yt-btn ' + cls;
        b.type = 'button';
        b.innerHTML = html;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return b;
      };
      this.ytBtn = mk('glaux-yt-main', iconSpark(), () => this.toggle());
      this.ytCmp = mk('glaux-yt-cmp', iconCompare(), () => this.toggleCompare());
      bar.prepend(this.ytCmp);
      bar.prepend(this.ytBtn);
      this._refreshUI();
    }
    get onYouTube() { return !!(this.ytBtn && this.ytBtn.isConnected); }

    _refreshUI() {
      const v = this.video;
      const res = this.active && v.videoHeight && this.outH ? `${v.videoHeight}p → ${this.outH}p` : '';
      const title = this.unsupported || (this.active ? t('btnDisable') : t('btnEnable'));
      // pill
      this.btn.classList.toggle('on', this.active);
      this.btn.classList.toggle('na', !!this.unsupported);
      this.btn.title = title;
      this.btn.setAttribute('aria-pressed', String(this.active));
      this.tag.textContent = this.unsupported ? '✕' : res;
      this.cmpBtn.hidden = !this.active;
      this.sep.hidden = !this.active;
      this.cmpBtn.classList.toggle('on', this.compare);
      this.cmpBtn.title = t('btnCompare');
      this.cmpBtn.setAttribute('aria-pressed', String(this.compare));

      // youtube
      if (this.ytBtn) {
        const show = settings.showButton && allowed();
        this.ytBtn.hidden = !show;
        this.ytBtn.setAttribute('aria-pressed', String(this.active));
        this.ytBtn.setAttribute('aria-label', title);
        this.ytBtn.title = res ? `${title} · ${res}` : title;
        this.ytBtn.classList.toggle('glaux-na', !!this.unsupported);
        this.ytCmp.hidden = !(show && this.active);
        this.ytCmp.setAttribute('aria-pressed', String(this.compare));
        this.ytCmp.setAttribute('aria-label', t('btnCompare'));
        this.ytCmp.title = t('btnCompare');
      }
      this.syncOverlay();
    }

    updateHover(x, y) {
      const r = this.video.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      // On YouTube, follow the player's own control visibility (autohide).
      const player = this.onYouTube ? this.video.closest('.html5-video-player') : null;
      const ytHidden = !!(player && player.classList.contains('ytp-autohide'));
      const show = settings.showButton && allowed() && inside && !ytHidden &&
        r.width >= MIN_W && r.height >= MIN_H;
      if (show) {
        this._mountUI();
        // centered at the top of the video
        this.pill.style.top = (r.top + 14) + 'px';
        this.pill.style.left = (r.left + r.width / 2 - this.pill.offsetWidth / 2) + 'px';
      }
      this.pill.classList.toggle('show', show);
    }

    // split + toast follow the visible picture area
    syncOverlay() {
      const on = this.active && this.compare && this.canvas && this.canvas.style.display !== 'none';
      this.splitEl.classList.toggle('show', !!on);
      if (!on) return;
      this._mountUI();
      const cr = this._contentRect(this.video.getBoundingClientRect());
      const s = this.splitEl.style;
      s.left = cr.left + 'px'; s.top = cr.top + 'px';
      s.width = cr.width + 'px'; s.height = cr.height + 'px';
      const x = this.split * cr.width;
      s.setProperty('--x', x + 'px');
      this.lineEl.style.left = x + 'px';
      this.knob.style.left = x + 'px';
      this.knob.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
      this.chipL.style.opacity = x > 110 ? '1' : '0';
      this.chipR.style.opacity = cr.width - x > 110 ? '1' : '0';
    }
    _toast(on) {
      const r = this.video.getBoundingClientRect();
      if (r.width < MIN_W) return;
      this._mountUI();
      const cr = this._contentRect(r);
      this.toastEl.style.left = (cr.left + cr.width / 2) + 'px';
      this.toastEl.style.top = (cr.top + 60) + 'px';
      this.toastText.textContent = on ? t('toastOn') : t('toastOff');
      this.toastEl.querySelector('.ti').classList.toggle('on', on);
      const v = this.video;
      this.toastTag.textContent = on && v.videoHeight && this.outH ? `${v.videoHeight}p → ${this.outH}p` : '';
      this.toastEl.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 1500);
    }

    // ---------- state
    toggle() { this.setActive(!this.active); }
    toggleCompare() {
      if (!this.active) { this.setActive(true); if (!this.active) return; }
      this.compare = !this.compare;
      if (this.compare) this.split = 0.5;
      this._refreshUI();
      this.renderOnce();
      if (this.compare) this.knob.focus({ preventScroll: true });
    }
    setActive(on, silent) {
      if (on && (!allowed() || this.unsupported)) { this._refreshUI(); return; }
      if (on === this.active) return;
      this.active = on;
      if (on) {
        try { this._start(); }
        catch (err) { this._fail(err && err.message === 'drm' ? t('errDrm') : t('errGpu')); return; }
      } else {
        this._stop();
        this.compare = false;
      }
      this._refreshUI();
      if (!silent) this._toast(on);
    }
    _fail(msg) {
      this.unsupported = msg;
      this.active = false;
      this.compare = false;
      this._stop();
      this._refreshUI();
    }
    _start() {
      if (this.video.mediaKeys) throw new Error('drm');
      const c = document.createElement('canvas');
      c.className = 'glaux-canvas';
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:absolute;pointer-events:none;margin:0;padding:0;border:0;' +
        'display:block;transform:none;max-width:none;max-height:none;';
      const z = getComputedStyle(this.video).zIndex;
      if (z && z !== 'auto') c.style.zIndex = z;
      this.video.insertAdjacentElement('afterend', c);
      this.canvas = c;
      c.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this._stop();
        this.active = false;
        this.compare = false;
        this._refreshUI();
      });
      this.renderer = new Renderer(c);
      this._loop();
      this.renderOnce();
    }
    _stop() {
      if (this.vfc && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.vfc);
      if (this.raf) cancelAnimationFrame(this.raf);
      this.vfc = 0; this.raf = 0;
      if (this.renderer) {
        const ext = this.renderer.gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
      this.renderer = null;
      if (this.canvas) this.canvas.remove();
      this.canvas = null;
    }
    destroy() {
      this._stop();
      this.ro.disconnect();
      this.video.removeEventListener('loadedmetadata', this._onMeta);
      this.video.removeEventListener('seeked', this._onMeta);
      this.host.remove();
      if (this.ytBtn) this.ytBtn.remove();
      if (this.ytCmp) this.ytCmp.remove();
    }

    // ---------- render
    _loop() {
      const v = this.video;
      if (typeof v.requestVideoFrameCallback === 'function') {
        const cb = () => { if (!this.active) return; this.renderOnce(); this.vfc = v.requestVideoFrameCallback(cb); };
        this.vfc = v.requestVideoFrameCallback(cb);
      } else {
        const cb = () => { if (!this.active) return; if (!v.paused) this.renderOnce(); this.raf = requestAnimationFrame(cb); };
        this.raf = requestAnimationFrame(cb);
      }
    }
    // Rectangle where the picture actually appears (object-fit aware).
    _contentRect(r) {
      const v = this.video, vw = v.videoWidth || 16, vh = v.videoHeight || 9;
      const fit = getComputedStyle(v).objectFit;
      if (fit === 'fill' || fit === 'cover') return { left: r.left, top: r.top, width: r.width, height: r.height, fit };
      const s = Math.min(r.width / vw, r.height / vh);
      const w = vw * s, h = vh * s;
      return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h, fit };
    }
    _layout() {
      const v = this.video, c = this.canvas;
      const hidden = document.fullscreenElement === v || !v.isConnected || v.videoWidth === 0 ||
        getComputedStyle(v).visibility === 'hidden';
      if (hidden) { c.style.display = 'none'; return null; }
      if (c.previousElementSibling !== v) v.insertAdjacentElement('afterend', c);
      c.style.display = 'block';

      const r = v.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { c.style.display = 'none'; return null; }
      const cr = this._contentRect(r);

      // Position relative to the canvas' containing block.
      const cb = c.offsetParent;
      let ox, oy;
      if (!cb || (cb === document.body && getComputedStyle(cb).position === 'static')) {
        ox = -window.scrollX; oy = -window.scrollY;
      } else {
        const br = cb.getBoundingClientRect();
        ox = br.left + cb.clientLeft - cb.scrollLeft;
        oy = br.top + cb.clientTop - cb.scrollTop;
      }
      c.style.left = (cr.left - ox) + 'px';
      c.style.top = (cr.top - oy) + 'px';
      c.style.width = cr.width + 'px';
      c.style.height = cr.height + 'px';

      // Output resolution = real device pixels of the picture, capped.
      const dpr = window.devicePixelRatio || 1;
      let w = Math.round(cr.width * dpr), h = Math.round(cr.height * dpr);
      const big = Math.max(w, h), lim = settings.maxOutput;
      if (big > lim) { w = Math.round(w * lim / big); h = Math.round(h * lim / big); }
      w = Math.max(1, w); h = Math.max(1, h);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

      let crop = [1, 1, 0, 0];
      if (cr.fit === 'cover') {
        const va = v.videoWidth / v.videoHeight, ea = cr.width / cr.height;
        if (va > ea) { const sx = ea / va; crop = [sx, 1, (1 - sx) / 2, 0]; }
        else { const sy = va / ea; crop = [1, sy, 0, (1 - sy) / 2]; }
      }
      return { w, h, crop };
    }
    renderOnce() {
      if (!this.active || !this.renderer || !this.canvas) return;
      const v = this.video;
      if (v.readyState < 2) return;
      const L = this._layout();
      if (!L) { this.syncOverlay(); return; }
      const changed = L.h !== this.outH;
      this.outW = L.w; this.outH = L.h;
      try {
        this.renderer.draw(v, L.w, L.h, L.crop, {
          sharp: settings.sharpness / 100,
          denoise: settings.denoise,
          split: this.compare ? this.split * L.w : -1
        });
      } catch (err) {
        this._fail(err && err.name === 'SecurityError' ? t('errCors') : t('errGpu'));
        return;
      }
      if (changed) this._refreshUI();
      else if (this.compare) this.syncOverlay();
    }
  }

  // ---------------------------------------------------------------- video discovery
  function scan() {
    for (const v of document.querySelectorAll('video')) {
      const inst = instances.get(v);
      if (!inst) instances.set(v, new Enhancer(v));
      else inst.ensureYtButtons(); // YouTube may rebuild its control bar
    }
    for (const [v, inst] of instances) {
      if (!v.isConnected) { inst.destroy(); instances.delete(v); }
    }
  }
  let scanQueued = false;
  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => { scanQueued = false; scan(); }, 300);
  };
  new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('play', queueScan, true);
  document.addEventListener('loadeddata', queueScan, true);
  scan();

  // hover / overlay tracking
  let lastX = -1, lastY = -1, frameQueued = false;
  const onFrame = () => {
    frameQueued = false;
    for (const inst of instances.values()) { inst.updateHover(lastX, lastY); inst.syncOverlay(); }
  };
  const queueFrame = () => { if (!frameQueued) { frameQueued = true; requestAnimationFrame(onFrame); } };
  document.addEventListener('pointermove', (e) => { lastX = e.clientX; lastY = e.clientY; queueFrame(); },
    { passive: true, capture: true });
  document.addEventListener('scroll', queueFrame, { passive: true, capture: true });
  document.addEventListener('fullscreenchange', () => {
    for (const inst of instances.values()) {
      inst._mountUI();
      for (const ms of [60, 250, 600]) setTimeout(() => { inst.renderOnce(); inst.syncOverlay(); }, ms);
    }
  });
  window.addEventListener('resize', () => {
    for (const inst of instances.values()) { inst.renderOnce(); inst.syncOverlay(); }
  });

  // "Main" video = the largest visible one.
  function mainInstance() {
    let best = null, area = 0;
    for (const inst of instances.values()) {
      const r = inst.video.getBoundingClientRect();
      const vis = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
                  Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (vis > area && r.width >= MIN_W) { area = vis; best = inst; }
    }
    return best;
  }

  // ---------------------------------------------------------------- messaging & settings
  api.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'toggleMain') { const m = mainInstance(); if (m) m.toggle(); }
    else if (msg.type === 'toggleCompare') { const m = mainInstance(); if (m) m.toggleCompare(); }
    else if (msg.type === 'setAll') { for (const i of instances.values()) i.setActive(!!msg.on); }
    else if (msg.type === 'status') {
      if (window !== window.top && instances.size === 0) return; // let the top frame answer
      reply({
        host: HOST,
        videos: [...instances.values()].map((i) => ({
          active: i.active, src: i.video.videoHeight, out: i.outH, err: i.unsupported
        }))
      });
    }
  });

  function applySettings(next) {
    settings = { ...DEFAULTS, ...next };
    for (const inst of instances.values()) {
      if (!allowed()) inst.setActive(false, true);
      else if (settings.autoOn && !inst.active && !inst.unsupported) inst.setActive(true, true);
      inst._refreshUI();
      inst.renderOnce();
    }
  }
  api.storage.sync.get(DEFAULTS).then(applySettings, () => applySettings({}));
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...settings };
    for (const k in changes) next[k] = changes[k].newValue;
    applySettings(next);
  });
})();
