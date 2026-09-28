// Render pipeline: MSAA HDR opaque pass -> planar reflection -> refraction copy (color + linear depth)
// -> water & transparent effects -> god rays -> bloom -> filmic grade composite.
import * as THREE from 'three';
import { updateReflectionCamera, WATER } from './water.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Pipeline {
  constructor(renderer) {
    this.r = renderer;
    const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.main = new THREE.WebGLRenderTarget(4, 4, { ...hf, samples: 4, depthBuffer: true });
    this.main.depthTexture = new THREE.DepthTexture(4, 4);
    this.main.depthTexture.type = THREE.UnsignedIntType;
    this.refr = new THREE.WebGLRenderTarget(4, 4, { ...hf, depthBuffer: false });
    this.refl = new THREE.WebGLRenderTarget(4, 4, { ...hf, depthBuffer: true });
    this.rays = new THREE.WebGLRenderTarget(4, 4, { ...hf, depthBuffer: false });
    this.bloom = [];
    for (let i = 0; i < 6; i++) this.bloom.push(new THREE.WebGLRenderTarget(4, 4, { ...hf, depthBuffer: false }));
    this.quadScene = new THREE.Scene(); this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.quadScene.add(this.quad);
    const mk = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    this.copyMat = mk(`uniform sampler2D tColor; uniform sampler2D tDepth; uniform float uNear, uFar; varying vec2 vUv;
      void main(){ float d = texture2D(tDepth, vUv).x; float z = d*2.0-1.0; float lin = 2.0*uNear*uFar/(uFar+uNear - z*(uFar-uNear));
        gl_FragColor = vec4(texture2D(tColor, vUv).rgb, lin); }`, { tColor: { value: null }, tDepth: { value: null }, uNear: { value: 0.3 }, uFar: { value: 9000 } });
    this.raysMat = mk(`uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uStr; uniform vec3 uTint; varying vec2 vUv;
      void main(){
        vec2 delta = (vUv - uSun) * (0.92/48.0);
        vec2 uv = vUv; float illum = 1.0; vec3 acc = vec3(0.0);
        float jit = fract(sin(dot(vUv*1000.0, vec2(12.9898,78.233)))*43758.5453);
        uv -= delta*jit;
        for (int i=0;i<48;i++){
          uv -= delta;
          float d = texture2D(tDepth, uv).x;
          float sky = step(0.99999, d);
          vec3 c = min(texture2D(tColor, uv).rgb, vec3(6.0));
          acc += sky*c*illum; illum *= 0.972;
        }
        gl_FragColor = vec4(acc/48.0*uStr*uTint, 1.0); }`, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uStr: { value: 0 }, uTint: { value: new THREE.Color(1, 0.9, 0.75) } });
    this.brightMat = mk(`uniform sampler2D tColor; uniform float uThr; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 c = vec3(0.0);
        c += texture2D(tColor, vUv + uTexel*vec2(-1.,-1.)).rgb; c += texture2D(tColor, vUv + uTexel*vec2(1.,-1.)).rgb;
        c += texture2D(tColor, vUv + uTexel*vec2(-1.,1.)).rgb; c += texture2D(tColor, vUv + uTexel*vec2(1.,1.)).rgb; c *= 0.25;
        c = min(c, vec3(40.0));
        float l = max(c.r, max(c.g, c.b)); float k = max(l - uThr, 0.0); k = k*k/(l*0.5 + k + 1e-4);
        gl_FragColor = vec4(c * (k / max(l, 1e-4)), 1.0); }`, { tColor: { value: null }, uThr: { value: 1.0 }, uTexel: { value: new THREE.Vector2() } });
    this.downMat = mk(`uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tColor, vUv).rgb*4.0;
        c += texture2D(tColor, vUv + uTexel*vec2(-1.,-1.)).rgb; c += texture2D(tColor, vUv + uTexel*vec2(1.,-1.)).rgb;
        c += texture2D(tColor, vUv + uTexel*vec2(-1.,1.)).rgb; c += texture2D(tColor, vUv + uTexel*vec2(1.,1.)).rgb;
        gl_FragColor = vec4(c/8.0, 1.0); }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = mk(`uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 c = vec3(0.0);
        c += texture2D(tColor, vUv + uTexel*vec2(-2.,0.)).rgb; c += texture2D(tColor, vUv + uTexel*vec2(2.,0.)).rgb;
        c += texture2D(tColor, vUv + uTexel*vec2(0.,-2.)).rgb; c += texture2D(tColor, vUv + uTexel*vec2(0.,2.)).rgb;
        c += texture2D(tColor, vUv + uTexel*vec2(-1.,-1.)).rgb*2.0; c += texture2D(tColor, vUv + uTexel*vec2(1.,-1.)).rgb*2.0;
        c += texture2D(tColor, vUv + uTexel*vec2(-1.,1.)).rgb*2.0; c += texture2D(tColor, vUv + uTexel*vec2(1.,1.)).rgb*2.0;
        gl_FragColor = vec4(c/12.0, 1.0); }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat.blending = THREE.AdditiveBlending; this.upMat.transparent = true;
    this.compMat = mk(`uniform sampler2D tColor, tBloom, tRays, tDepth; uniform float uExpo, uSat, uWarm, uBloom, uVig, uFade, uTime, uContrast, uLift, uFlash, uNear, uFar;
      uniform vec3 uFadeCol, uShadowTint, uHiTint; uniform vec2 uRes; varying vec2 vUv;
      vec3 RRTODT(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
      vec3 aces(vec3 c){
        const mat3 inM = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
        const mat3 outM = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
        return clamp(outM*RRTODT(inM*c), 0.0, 1.0); }
      vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb;
        c += texture2D(tBloom, vUv).rgb*uBloom;
        c += texture2D(tRays, vUv).rgb;
        c *= uExpo;
        c *= vec3(1.0 + uWarm*0.1, 1.0 + uWarm*0.01, 1.0 - uWarm*0.13);
        c = aces(c);
        float l = dot(c, vec3(0.2126,0.7152,0.0722));
        c = mix(vec3(l), c, uSat);
        c = mix(c, c*uShadowTint, (1.0-smoothstep(0.0,0.45,l))*0.5);
        c = mix(c, c*uHiTint, smoothstep(0.5,1.0,l)*0.4);
        c = (c - 0.5)*uContrast + 0.5;
        c = c + uLift*(1.0 - c);
        vec2 q = vUv - 0.5; q.x *= uRes.x/uRes.y;
        c *= mix(1.0, smoothstep(1.05, 0.25, length(q)), uVig);
        c = mix(c, uFadeCol, uFade);
        float n = fract(sin(dot(vUv*uRes + fract(uTime)*97.0, vec2(12.9898,78.233)))*43758.5453);
        c += (n - 0.5)*0.014;
        gl_FragColor = vec4(toSRGB(clamp(c,0.0,1.0)), 1.0);
      }`, {
      tColor: { value: null }, tBloom: { value: null }, tRays: { value: null }, tDepth: { value: null },
      uExpo: { value: 1 }, uSat: { value: 1 }, uWarm: { value: 0 }, uBloom: { value: 0.6 }, uVig: { value: 0.5 }, uFade: { value: 0 }, uTime: { value: 0 }, uContrast: { value: 1.04 }, uLift: { value: 0.018 }, uFlash: { value: 0 },
      uNear: { value: 0.3 }, uFar: { value: 9000 }, uFadeCol: { value: new THREE.Color(0.85, 0.88, 0.9) }, uShadowTint: { value: new THREE.Color(0.94, 1.0, 1.06) }, uHiTint: { value: new THREE.Color(1.04, 1.0, 0.95) }, uRes: { value: new THREE.Vector2(1, 1) },
    });
    this.w = 4; this.h = 4; this.reflDiv = 2;
  }
  setQuality(samples, reflDiv) { this.main.samples = samples; this.main.dispose(); this.reflDiv = reflDiv; this.setSize(this.w, this.h); }
  setSize(w, h) {
    this.w = w; this.h = h;
    this.main.setSize(w, h); this.refr.setSize(w, h);
    const hw = Math.max(2, Math.floor(w / 2)), hh = Math.max(2, Math.floor(h / 2));
    this.refl.setSize(Math.max(2, Math.floor(w / this.reflDiv)), Math.max(2, Math.floor(h / this.reflDiv))); this.rays.setSize(hw, hh);
    let bw = hw, bh = hh;
    for (const b of this.bloom) { b.setSize(Math.max(2, bw), Math.max(2, bh)); bw = Math.floor(bw / 2); bh = Math.floor(bh / 2); }
    this.compMat.uniforms.uRes.value.set(w, h);
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.quadScene, this.quadCam); }
  render(scene, camera, P) {
    const r = this.r;
    r.autoClear = false;
    // 1. opaque world (+ grass layer 4)
    camera.layers.mask = 0; camera.layers.enable(0); camera.layers.enable(4);
    r.setRenderTarget(this.main); r.setClearColor(0x000000, 1); r.clear(true, true, true);
    r.shadowMap.needsUpdate = true;
    r.render(scene, camera);
    // 2. planar reflection
    const wm = WATER.mat.uniforms;
    if (updateReflectionCamera(camera)) {
      r.setRenderTarget(this.refl); r.clear(true, true, true);
      r.render(scene, WATER.virtualCam);
    }
    // 3. refraction copy: color + linear depth
    const cu = this.copyMat.uniforms; cu.tColor.value = this.main.texture; cu.tDepth.value = this.main.depthTexture; cu.uNear.value = camera.near; cu.uFar.value = camera.far;
    this.pass(this.copyMat, this.refr);
    wm.tRefl.value = this.refl.texture; wm.tRefr.value = this.refr.texture;
    // 4. water + transparent effects + mist
    camera.layers.mask = 0; camera.layers.enable(1); camera.layers.enable(2); camera.layers.enable(3);
    r.setRenderTarget(this.main);
    r.render(scene, camera);
    camera.layers.mask = 0; camera.layers.enable(0);
    // 5. god rays
    const ru = this.raysMat.uniforms;
    ru.tColor.value = this.main.texture; ru.tDepth.value = this.main.depthTexture; ru.uSun.value.copy(P.sunUV); ru.uStr.value = P.rays; ru.uTint.value.copy(P.raysTint);
    if (P.rays > 0.001) this.pass(this.raysMat, this.rays);
    else { r.setRenderTarget(this.rays); r.setClearColor(0x000000, 1); r.clear(true, false, false); }
    // 6. bloom
    const bu = this.brightMat.uniforms; bu.tColor.value = this.main.texture; bu.uThr.value = P.bloomThr; bu.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.brightMat, this.bloom[0]);
    for (let i = 1; i < this.bloom.length; i++) { const d = this.downMat.uniforms; d.tColor.value = this.bloom[i - 1].texture; d.uTexel.value.set(1 / this.bloom[i - 1].width, 1 / this.bloom[i - 1].height); this.pass(this.downMat, this.bloom[i]); }
    for (let i = this.bloom.length - 1; i > 0; i--) { const u = this.upMat.uniforms; u.tColor.value = this.bloom[i].texture; u.uTexel.value.set(1 / this.bloom[i].width, 1 / this.bloom[i].height); this.pass(this.upMat, this.bloom[i - 1]); }
    // 7. composite
    const c = this.compMat.uniforms;
    c.tColor.value = this.main.texture; c.tBloom.value = this.bloom[0].texture; c.tRays.value = this.rays.texture; c.tDepth.value = this.main.depthTexture;
    c.uExpo.value = P.exposure; c.uSat.value = P.sat; c.uWarm.value = P.warm; c.uBloom.value = P.bloom; c.uFade.value = P.fade; c.uTime.value = P.time; c.uVig.value = P.vig;
    c.uFadeCol.value.copy(P.fadeCol);
    this.pass(this.compMat, null);
    r.autoClear = true;
  }
}
