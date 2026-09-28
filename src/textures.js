// GPU procedural texture generation: tileable PBR-ish sets (albedo+roughness, normal+AO)
// and alpha foliage cards. Everything is generated at load time, no external assets.
import * as THREE from 'three';

const COMMON = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uSeed;
#define PI 3.14159265
vec2 hash22(vec2 p){ p += uSeed*1.731; p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453123); }
float hash12(vec2 p){ p += uSeed*0.917; vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
float pnoise(vec2 p, vec2 per){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*f*(f*(f*6.-15.)+10.);
  vec2 g00=hash22(mod(i,per))*2.-1., g10=hash22(mod(i+vec2(1,0),per))*2.-1., g01=hash22(mod(i+vec2(0,1),per))*2.-1., g11=hash22(mod(i+1.,per))*2.-1.;
  return mix(mix(dot(g00,f),dot(g10,f-vec2(1,0)),u.x), mix(dot(g01,f-vec2(0,1)),dot(g11,f-1.),u.x), u.y)*1.4;
}
float pfbm(vec2 uv, vec2 fr, int oct){ float s=0., a=0.5; vec2 f=fr; for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*pnoise(uv*f, f); f*=2.; a*=0.5; } return s; }
float pridge(vec2 uv, vec2 fr, int oct){ float s=0., a=0.5; vec2 f=fr; for(int i=0;i<8;i++){ if(i>=oct) break; float n=1.-abs(pnoise(uv*f,f)); s+=a*n*n; f*=2.; a*=0.5; } return s; }
// periodic voronoi: x=F1, y=F2, z=cell id hash, w = edge distance approx
vec4 pvor(vec2 uv, vec2 fr, float jit){
  vec2 p=uv*fr; vec2 i=floor(p), f=fract(p);
  float F1=8., F2=8.; vec2 id=vec2(0); vec2 mr=vec2(0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 n=vec2(x,y); vec2 c=mod(i+n,fr); vec2 o=0.5+(hash22(c)-0.5)*jit;
    vec2 r=n+o-f; float d=dot(r,r);
    if(d<F1){ F2=F1; F1=d; id=c; mr=r; } else if(d<F2){ F2=d; }
  }
  // edge distance
  float md=8.;
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 n=vec2(x,y); vec2 c=mod(i+n,fr); vec2 o=0.5+(hash22(c)-0.5)*jit;
    vec2 r=n+o-f; if(dot(mr-r,mr-r)>0.0001) md=min(md, dot(0.5*(mr+r), normalize(r-mr)));
  }
  return vec4(sqrt(F1), sqrt(F2), hash12(id*1.37+0.5), md);
}
`;
const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

export class TexGen {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  pass(size, frag, uniforms = {}, opt = {}) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: opt.float ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: opt.mips !== false, minFilter: opt.mips !== false ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false,
    });
    rt.texture.anisotropy = this.aniso;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMMON + frag,
      uniforms: Object.assign({ uSeed: { value: opt.seed ?? 1 } }, uniforms),
      depthTest: false, depthWrite: false,
    });
    this.quad.material = mat;
    this.r.setRenderTarget(rt);
    this.r.render(this.scene, this.cam);
    this.r.setRenderTarget(null);
    mat.dispose();
    return rt;
  }
  // Material set: heightSrc sets `vec4 H` (x=height 0..1, yzw aux); colorSrc uses H and sets `vec4 A` (rgb linear albedo, a roughness)
  material(size, heightSrc, colorSrc, opt = {}) {
    const hRT = this.pass(size, `void main(){ vec2 uv=vUv; vec4 H=vec4(0); ${heightSrc} gl_FragColor=H; }`, {}, { seed: opt.seed, mips: false, float: true });
    const aRT = this.pass(size, `uniform sampler2D tH; void main(){ vec2 uv=vUv; vec4 H=texture2D(tH,uv); vec4 A=vec4(0.5,0.5,0.5,0.8); ${colorSrc} gl_FragColor=A; }`, { tH: { value: hRT.texture } }, { seed: opt.seed });
    const nRT = this.pass(size, `uniform sampler2D tH; uniform float uStr; uniform float uTexel; uniform float uAO;
      void main(){ vec2 uv=vUv; float e=uTexel;
        float hl=texture2D(tH,uv-vec2(e,0)).x, hr=texture2D(tH,uv+vec2(e,0)).x, hd=texture2D(tH,uv-vec2(0,e)).x, hu=texture2D(tH,uv+vec2(0,e)).x;
        vec3 n=normalize(vec3((hl-hr)*uStr, (hd-hu)*uStr, 1.0));
        float h=texture2D(tH,uv).x; float avg=0.;
        for(int i=0;i<8;i++){ float a=float(i)*0.785398; avg+=texture2D(tH,uv+vec2(cos(a),sin(a))*e*5.).x; }
        avg/=8.; float ao=clamp(1.0-(avg-h)*uAO,0.35,1.0);
        gl_FragColor=vec4(n*0.5+0.5, ao); }`,
      { tH: { value: hRT.texture }, uStr: { value: opt.normal ?? 6 }, uTexel: { value: 1 / size }, uAO: { value: opt.ao ?? 4 } }, { seed: opt.seed });
    hRT.dispose();
    aRT.texture.colorSpace = THREE.NoColorSpace; nRT.texture.colorSpace = THREE.NoColorSpace;
    return { map: aRT.texture, nrm: nRT.texture };
  }
  card(size, src, opt = {}) {
    const rt = this.pass(size, `void main(){ vec2 uv=vUv; vec4 C=vec4(0); ${src} gl_FragColor=C; }`, {}, { seed: opt.seed, mips: opt.mips });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    return rt.texture;
  }
}

export const TEX = {};

export function generateAll(tg, q = 1) {
  const S = q > 0.8 ? 1024 : 512;
  // ---------- ground: grass
  TEX.grass = tg.material(S, `
    float n = pfbm(uv, vec2(6.), 6);
    float blades = pnoise(vec2(uv.x*220., uv.y*60.), vec2(220.,60.))*0.5+0.5;
    H = vec4(0.45+0.25*n+0.25*blades, n, pfbm(uv+0.3, vec2(3.),4), 0.);
  `, `
    vec3 g1=srgb(vec3(0.3,0.37,0.17)), g2=srgb(vec3(0.39,0.43,0.22)), g3=srgb(vec3(0.5,0.46,0.3)), g4=srgb(vec3(0.2,0.26,0.13));
    float t=H.z*0.5+0.5;
    vec3 c=mix(g4,g1,smoothstep(0.2,0.5,t)); c=mix(c,g2,smoothstep(0.5,0.75,t)); c=mix(c,g3,smoothstep(0.72,0.95,t)*0.8);
    c*=0.75+0.5*H.x;
    vec2 fc = uv*180.; float fl = step(0.992, hash12(floor(fc))) * smoothstep(0.32, 0.18, length(fract(fc)-0.5));
    c=mix(c, srgb(vec3(0.93,0.9,0.86)), fl*0.35);
    A=vec4(c, 0.85);
  `, { seed: 3, normal: 3 });
  // ---------- dirt / earth
  TEX.dirt = tg.material(S, `
    float n=pfbm(uv, vec2(5.), 6);
    vec4 v=pvor(uv, vec2(40.), 1.0);
    float st=smoothstep(0.42,0.2,v.x)*step(0.62,v.z);
    H=vec4(0.4+0.3*n+0.35*st*(0.5+0.5*v.z), n, st, v.z);
  `, `
    vec3 a=srgb(vec3(0.36,0.27,0.19)), b=srgb(vec3(0.48,0.38,0.27)), s=srgb(vec3(0.55,0.52,0.47));
    vec3 c=mix(a,b,H.y*0.8+0.5); c=mix(c, s*(0.7+0.5*H.w), H.z);
    c*=0.8+0.4*H.x;
    A=vec4(c, 0.92-0.2*H.z);
  `, { seed: 5, normal: 5 });
  // ---------- rock
  TEX.rock = tg.material(S, `
    float r=pridge(uv, vec2(3.,2.), 7);
    float n=pfbm(uv+0.1, vec2(4.), 6);
    float strata = pnoise(vec2(uv.x*2.0 + n*0.6, uv.y*18.0 + n*2.5), vec2(2.,18.))*0.5+0.5;
    vec4 v=pvor(uv + n*0.04, vec2(4.,3.), 1.0);
    float crack=mix(1.0, smoothstep(0.0,0.012,v.w), 0.35);
    H=vec4(0.2+0.4*r+0.2*n+0.2*strata - (1.-crack)*0.06, n, v.z, crack);
  `, `
    vec3 g1=srgb(vec3(0.4,0.39,0.37)), g2=srgb(vec3(0.56,0.54,0.5)), w=srgb(vec3(0.5,0.44,0.36));
    vec3 c=mix(g1,g2,smoothstep(0.2,0.8,H.x)); c=mix(c,w,smoothstep(0.3,0.8,H.y*0.5+0.5)*0.35);
    float lich = smoothstep(0.55,0.78, pfbm(uv+0.7, vec2(9.),5)*0.5+0.5);
    c=mix(c, srgb(vec3(0.6,0.64,0.5)), lich*0.4);
    float moss = smoothstep(0.62,0.8, pfbm(uv+0.2, vec2(5.),5)*0.5+0.5);
    c=mix(c, srgb(vec3(0.3,0.38,0.16)), moss*0.5);
    c*=mix(0.62,1.0,H.w);
    A=vec4(c, 0.8);
  `, { seed: 9, normal: 6, ao: 5 });
  // ---------- pebbles (river bed / gravel bars)
  TEX.pebble = tg.material(S, `
    vec4 v=pvor(uv, vec2(15.), 0.95);
    vec4 v2=pvor(uv+0.37, vec2(44.), 0.95);
    float peb = sqrt(max(0.,1.-pow(v.x/0.55,2.)));
    float peb2 = sqrt(max(0.,1.-pow(v2.x/0.5,2.)));
    float sandN = pfbm(uv, vec2(40.), 4);
    float h = max(peb*smoothstep(0.0,0.08,v.w)*0.9, peb2*0.5) ;
    H=vec4(0.15+0.8*h + sandN*0.05, v.z, v2.z, step(0.02,h));
  `, `
    float id=H.y;
    vec3 c1=srgb(vec3(0.58,0.57,0.54)), c2=srgb(vec3(0.47,0.46,0.45)), c3=srgb(vec3(0.6,0.55,0.47)), c4=srgb(vec3(0.4,0.4,0.41)), c5=srgb(vec3(0.54,0.48,0.44));
    vec3 c = id<0.25?c1: id<0.45?c2: id<0.65?c3: id<0.82?c4:c5;
    c *= 0.88+0.22*hash12(vec2(id*91.,3.));
    c *= 0.7 + 0.45*smoothstep(0.15, 0.9, H.x);
    vec3 sand=srgb(vec3(0.55,0.5,0.42));
    c = mix(sand*(0.85+0.3*H.z), c, smoothstep(0.2,0.35,H.x));
    A=vec4(c, 0.55+0.3*(1.-H.x));
  `, { seed: 11, normal: 5, ao: 6 });
  // ---------- moss
  TEX.moss = tg.material(S, `
    float n=pfbm(uv, vec2(8.), 6); float f=pnoise(uv*120., vec2(120.))*0.5+0.5;
    H=vec4(0.5+0.3*n+0.2*f, n, f, 0.);
  `, `
    vec3 a=srgb(vec3(0.24,0.36,0.1)), b=srgb(vec3(0.45,0.52,0.18));
    vec3 c=mix(a,b,H.y+0.5)*(0.75+0.45*H.z);
    A=vec4(c,0.95);
  `, { seed: 13, normal: 3 });
  // ---------- cherry bark (u around, v along)
  TEX.barkCherry = tg.material(S, `
    float n=pfbm(uv, vec2(4.,8.), 6);
    float bands = pfbm(vec2(uv.x, uv.y), vec2(3.,40.), 3);
    vec4 v=pvor(vec2(uv.x*1.0, uv.y), vec2(10.,90.), 1.0);
    float lent = smoothstep(0.35,0.1, length(vec2(v.x*0.7,v.x)) ) * step(0.4,v.z);
    float rough = pridge(uv, vec2(6.,12.), 5);
    H=vec4(0.45+0.25*n+0.25*rough - lent*0.25 + bands*0.1, n, lent, rough);
  `, `
    vec3 a=srgb(vec3(0.24,0.17,0.15)), b=srgb(vec3(0.42,0.33,0.3)), g=srgb(vec3(0.5,0.48,0.44));
    vec3 c=mix(a,b,H.x); c=mix(c,g,smoothstep(0.55,0.8,H.w)*0.45);
    c=mix(c, srgb(vec3(0.62,0.52,0.42)), H.z*0.6);
    float lich = smoothstep(0.6,0.8,pfbm(uv+0.3, vec2(5.,6.),5)*0.5+0.5);
    c=mix(c, srgb(vec3(0.55,0.62,0.45)), lich*0.35);
    A=vec4(c,0.85);
  `, { seed: 17, normal: 8, ao: 5 });
  // ---------- conifer bark (vertical plates)
  TEX.barkPine = tg.material(S, `
    vec4 v=pvor(uv, vec2(8.,24.), 1.0);
    float plate=smoothstep(0.0,0.06,v.w);
    float n=pfbm(uv, vec2(6.,12.), 5);
    float fib = pnoise(vec2(uv.x*60., uv.y*6.), vec2(60.,6.))*0.5+0.5;
    H=vec4(0.3+0.4*plate+0.15*n+0.15*fib*plate, v.z, plate, fib);
  `, `
    vec3 a=srgb(vec3(0.22,0.14,0.1)), b=srgb(vec3(0.5,0.34,0.24)), g=srgb(vec3(0.45,0.42,0.38));
    vec3 c=mix(a,b,H.z*(0.5+0.5*H.y)); c=mix(c,g,H.w*0.25*H.z);
    A=vec4(c,0.9);
  `, { seed: 19, normal: 8, ao: 6 });
  // ---------- weathered wood planks (grain along v)
  TEX.wood = tg.material(S, `
    float n=pfbm(vec2(uv.x, uv.y), vec2(3.,1.), 5);
    float grain = pnoise(vec2(uv.x*50.+n*4., uv.y*2.), vec2(50.,2.));
    float fine = pnoise(vec2(uv.x*240., uv.y*8.), vec2(240.,8.));
    float board = fract(uv.x*4.);
    float seam = smoothstep(0.0,0.02,board)*smoothstep(1.0,0.98,board);
    float id = hash12(vec2(floor(uv.x*4.), 1.));
    H=vec4(0.5+0.18*grain+0.08*fine - (1.-seam)*0.35, grain, id, seam);
  `, `
    vec3 a=srgb(vec3(0.47,0.36,0.26)), b=srgb(vec3(0.62,0.5,0.37)), grey=srgb(vec3(0.5,0.47,0.43));
    vec3 c=mix(a,b,H.y*0.6+0.5); c=mix(c,grey,0.25+0.35*H.z); c*=0.85+0.3*H.z; c*=mix(0.4,1.,H.w);
    A=vec4(c,0.8);
  `, { seed: 23, normal: 5 });
  // ---------- vermilion paint over wood
  TEX.paint = tg.material(S, `
    float n=pfbm(uv, vec2(4.), 6);
    float grain = pnoise(vec2(uv.x*40., uv.y*3.), vec2(40.,3.));
    float wear = smoothstep(0.25,0.45, pfbm(uv+0.5, vec2(6.),6)*0.5+0.5 + grain*0.08);
    H=vec4(0.55+0.05*grain - (1.-wear)*0.06 + 0.03*n, wear, n, grain);
  `, `
    vec3 red=srgb(vec3(0.82,0.2,0.1)), dark=srgb(vec3(0.62,0.12,0.07)), wood=srgb(vec3(0.33,0.22,0.15));
    vec3 c=mix(dark,red,H.z*0.5+0.6); c=mix(wood, c, H.y);
    c*=0.92+0.1*H.w;
    A=vec4(c, mix(0.8,0.55,H.y));
  `, { seed: 29, normal: 2 });
  // ---------- roof tiles (u lateral: 1 unit = 4 tile columns, v downslope: 1 unit = 4 courses)
  TEX.tile = tg.material(S, `
    float col = fract(uv.x*4.); float course = fract(uv.y*4.);
    float round_ = sin(col*PI);
    float lap = smoothstep(0.0,0.08,course)*0.6+0.4*course;
    float n = pfbm(uv, vec2(8.), 5);
    float id = hash12(floor(vec2(uv.x*4., uv.y*4.)));
    H=vec4(0.35+0.35*round_*lap+0.05*n, id, course, n);
  `, `
    vec3 a=srgb(vec3(0.24,0.25,0.27)), b=srgb(vec3(0.36,0.37,0.39));
    vec3 c=mix(a,b,H.y); c*=0.75+0.4*smoothstep(0.,0.3,H.z);
    c=mix(c, srgb(vec3(0.42,0.46,0.34)), smoothstep(0.55,0.8,H.w*0.5+0.5)*0.35);
    A=vec4(c,0.55);
  `, { seed: 31, normal: 4 });
  // ---------- dry stone wall (irregular horizontal stones)
  TEX.stonewall = tg.material(S, `
    vec4 v=pvor(vec2(uv.x, uv.y), vec2(5.,8.), 0.85);
    float edge=smoothstep(0.0,0.07,v.w);
    float dome=smoothstep(0.0,0.3,v.w);
    float n=pfbm(uv, vec2(10.),5);
    H=vec4(0.15+0.6*dome*edge+0.12*n, v.z, edge, n);
  `, `
    vec3 a=srgb(vec3(0.5,0.49,0.46)), b=srgb(vec3(0.66,0.62,0.56)), d=srgb(vec3(0.38,0.36,0.33));
    vec3 c=mix(a,b,H.y); c=mix(c,d,step(0.8,H.y)*0.6);
    c*=mix(0.25,1.0,H.z); c*=0.85+0.25*H.w;
    float moss=smoothstep(0.1,0.6,(1.-H.z)+H.w*0.8-0.4);
    c=mix(c, srgb(vec3(0.28,0.38,0.14)), moss*0.55);
    A=vec4(c,0.85);
  `, { seed: 37, normal: 8, ao: 6 });
  // ---------- granite (cut stone)
  TEX.granite = tg.material(S, `
    float n=pfbm(uv, vec2(6.),6); float sp=hash12(floor(uv*400.));
    H=vec4(0.5+0.1*n+0.04*sp, n, sp, 0.);
  `, `
    vec3 a=srgb(vec3(0.56,0.55,0.52)), b=srgb(vec3(0.68,0.66,0.62));
    vec3 c=mix(a,b,H.y*0.6+0.5); c*=0.8+0.35*step(0.5,H.z)*H.z; c*=1.0-0.35*step(0.93,H.z);
    float lich=smoothstep(0.6,0.8,pfbm(uv+0.4,vec2(7.),5)*0.5+0.5);
    c=mix(c, srgb(vec3(0.5,0.55,0.38)), lich*0.4);
    A=vec4(c,0.8);
  `, { seed: 41, normal: 2 });
  // ---------- woven reed mat
  TEX.reed = tg.material(S, `
    vec2 p=uv*vec2(48.,24.);
    vec2 c=floor(p); vec2 f=fract(p);
    float over = mod(c.x+c.y,2.);
    float strandU = sin(f.y*PI)*(0.6+0.4*sin(f.x*PI));
    float strandV = sin(f.x*PI)*(0.6+0.4*sin(f.y*PI));
    float h = over>0.5 ? strandU : strandV*0.8;
    float n=pfbm(uv, vec2(8.),4);
    H=vec4(0.3+0.6*h+0.05*n, over, hash12(c), n);
  `, `
    vec3 a=srgb(vec3(0.62,0.52,0.32)), b=srgb(vec3(0.75,0.66,0.44)), g=srgb(vec3(0.5,0.47,0.38));
    vec3 c=mix(a,b,H.z); c=mix(c,g,0.3+0.2*H.w); c*=0.6+0.5*H.x;
    A=vec4(c,0.9);
  `, { seed: 43, normal: 5 });
  // ---------- straw fibres (bales, cape, hat)
  TEX.straw = tg.material(S, `
    float f = pnoise(vec2(uv.x*120., uv.y*5.), vec2(120.,5.))*0.5+0.5;
    float f2 = pnoise(vec2(uv.x*300.+3., uv.y*9.), vec2(300.,9.))*0.5+0.5;
    float n=pfbm(uv, vec2(4.),4);
    H=vec4(0.3+0.4*f+0.3*f2, f, n, f2);
  `, `
    vec3 a=srgb(vec3(0.58,0.47,0.27)), b=srgb(vec3(0.8,0.7,0.46)), g=srgb(vec3(0.48,0.44,0.34));
    vec3 c=mix(a,b,H.y*H.w+0.2); c=mix(c,g,smoothstep(0.1,0.6,H.z)*0.4); c*=0.6+0.5*H.x;
    A=vec4(c,0.9);
  `, { seed: 47, normal: 5 });
  // ---------- plaster
  TEX.plaster = tg.material(512, `
    float n=pfbm(uv, vec2(5.),6); H=vec4(0.5+0.08*n, n, pfbm(uv+0.2,vec2(3.),4), 0.);
  `, `
    vec3 c=srgb(vec3(0.9,0.87,0.8))*(0.92+0.1*H.y); c=mix(c, srgb(vec3(0.7,0.66,0.58)), smoothstep(0.2,0.7,H.z)*0.3);
    A=vec4(c,0.9);
  `, { seed: 53, normal: 1.5 });
  // ---------- cloth weave (neutral, tinted by material color)
  TEX.cloth = tg.material(512, `
    vec2 p=uv*vec2(90.); vec2 f=fract(p); float over=mod(floor(p.x)+floor(p.y),2.);
    float h= over>0.5? sin(f.y*PI): sin(f.x*PI);
    float n=pfbm(uv, vec2(4.),4);
    H=vec4(0.4+0.4*h+0.1*n, n, 0.,0.);
  `, `
    vec3 c=vec3(0.8)*(0.8+0.25*H.x)*(0.9+0.15*H.y); A=vec4(c,0.95);
  `, { seed: 59, normal: 2 });

  // ---------- foliage cards ----------
  TEX.blossom = tg.card(S, `
    vec3 col=srgb(vec3(0.98,0.8,0.86)); float a=0.;
    // twigs
    for(int i=0;i<5;i++){
      float fi=float(i); vec2 p0=vec2(0.5+0.35*(hash12(vec2(fi,1.))-0.5), 0.05); vec2 p1=vec2(hash12(vec2(fi,2.)), hash12(vec2(fi,3.))*0.6+0.35);
      vec2 pa=uv-p0, ba=p1-p0; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); float d=length(pa-ba*h);
      float tw=smoothstep(0.006,0.002,d);
      col=mix(col, srgb(vec3(0.25,0.15,0.12)), tw*(1.-a)); a=max(a,tw);
    }
    // flowers
    for(int i=0;i<150;i++){
      float fi=float(i);
      float ci = floor(fi/6.0);
      float ra = sqrt(hash12(vec2(ci,7.)))*0.36; float aa = hash12(vec2(ci,9.))*6.283;
      vec2 cc = 0.5 + vec2(cos(aa), sin(aa))*ra;
      float fa = hash12(vec2(fi,19.))*6.283; float fr = 0.03 + 0.045*hash12(vec2(fi,23.));
      vec2 c = cc + vec2(cos(fa), sin(fa))*fr;
      float rr = 0.032+0.026*hash12(vec2(fi,11.));
      vec2 d=uv-c; float r=length(d)/rr; if(r>1.2) continue;
      float ang=atan(d.y,d.x)+hash12(vec2(fi,13.))*6.28;
      float petal = 0.72+0.28*cos(ang*5.);
      float notch = 1.0-0.18*smoothstep(0.96,1.0,cos(ang*5.))*step(0.7,r);
      float shape = step(r, petal*notch);
      if(shape<0.5) continue;
      vec3 pink = mix(srgb(vec3(1.0,0.86,0.9)), srgb(vec3(0.97,0.66,0.76)), hash12(vec2(fi,17.))*0.9);
      pink = mix(pink, srgb(vec3(1.0,0.97,0.97)), smoothstep(0.2,0.9,r)*0.5);
      pink = mix(srgb(vec3(0.85,0.35,0.45)), pink, smoothstep(0.12,0.3,r));
      float stam = step(r,0.22)*step(0.5,fract(ang*3.));
      pink = mix(pink, srgb(vec3(0.95,0.8,0.35)), stam*0.7);
      pink *= 0.85+0.2*(1.-r);
      col = pink; a = 1.;
    }
    C=vec4(col, a);
  `, { seed: 61 });
  TEX.leafMaple = tg.card(S, `
    vec3 col=vec3(0.8); float a=0.;
    for(int i=0;i<34;i++){
      float fi=float(i);
      vec2 c=0.5+(vec2(hash12(vec2(fi,3.)), hash12(vec2(fi,5.)))-0.5)*0.8;
      float rr=0.07+0.04*hash12(vec2(fi,7.));
      vec2 d=uv-c; float rot=hash12(vec2(fi,9.))*6.28;
      d=mat2(cos(rot),-sin(rot),sin(rot),cos(rot))*d;
      float r=length(d)/rr; float ang=atan(d.y,d.x);
      float lobes = 0.55+0.45*pow(abs(cos(ang*3.5)),0.7);
      float shape = step(r, lobes) * step(-0.95, sin(ang)+0.9);
      if(shape<0.5) continue;
      float vein = smoothstep(0.08,0.0,abs(fract(ang/6.2832*7.+0.5)-0.5))*0.25;
      float v = 0.75+0.3*hash12(vec2(fi,13.)) - vein + 0.15*(1.-r);
      col=vec3(v); a=1.;
    }
    C=vec4(col,a);
  `, { seed: 67 });
  TEX.leafBroad = tg.card(S, `
    vec3 col=vec3(0.8); float a=0.;
    for(int i=0;i<120;i++){
      float fi=float(i);
      float ra = sqrt(hash12(vec2(fi,3.)))*0.42; float aa = hash12(vec2(fi,5.))*6.283;
      vec2 c=0.5+vec2(cos(aa),sin(aa))*ra;
      float rot=hash12(vec2(fi,9.))*6.28; vec2 d=uv-c;
      d=mat2(cos(rot),-sin(rot),sin(rot),cos(rot))*d;
      float L=0.065+0.04*hash12(vec2(fi,7.));
      vec2 q=d/vec2(L*0.45,L);
      float shape=step(length(q), 1.0-0.3*q.y*q.y*0.0) * step(abs(q.x), (1.-q.y*q.y)*1.0);
      if(shape<0.5) continue;
      float vein=smoothstep(0.1,0.0,abs(q.x))*0.2;
      float v=0.7+0.35*hash12(vec2(fi,13.)) - vein + 0.12*q.x;
      col=vec3(v); a=1.;
    }
    C=vec4(col,a);
  `, { seed: 71 });
  TEX.needles = tg.card(S, `
    vec3 col=vec3(0.7); float a=0.;
    for(int i=0;i<11;i++){
      float fi=float(i);
      float ang = -1.25 + fi*0.25 + (hash12(vec2(fi,1.))-0.5)*0.2;
      vec2 dir = vec2(sin(ang), cos(ang));
      vec2 base = vec2(0.5, 0.1);
      vec2 pa = uv - base; float along = dot(pa, dir); float lat = dot(pa, vec2(dir.y,-dir.x));
      float L = 0.58 + 0.25*hash12(vec2(fi,2.));
      if (along < 0.0 || along > L) continue;
      float t = along / L;
      float width = 0.11*sin(3.14*pow(t,0.65)) + 0.012;
      float needle = pnoise(vec2(along*110., lat*14.+fi*3.), vec2(110.,14.))*0.5+0.5;
      float edge = abs(lat)/width;
      if (edge < 1.0 - needle*0.5) { a = 1.0; col = vec3(0.5 + 0.5*needle) * (0.7 + 0.3*t) * (0.82 + 0.18*hash12(vec2(fi,5.))); }
      if (abs(lat) < 0.0045 && t < 0.92) { col = vec3(0.3,0.22,0.15); a = 1.0; }
    }
    C=vec4(col,a);
  `, { seed: 73 });
  TEX.fern = tg.card(512, `
    // frond along v (0 base -> 1 tip), centred at u=0.5
    float t=uv.y; float half_=0.42*sin(PI*pow(t,0.8))*(1.-t*0.3);
    float x=abs(uv.x-0.5);
    float rachis=smoothstep(0.012,0.004,x)*step(t,0.98);
    float seg=fract(t*22.); float within = step(x, half_) ;
    float leaflet = within * step(abs(seg-0.5)*2., 1.0-x/max(half_,0.001)*0.9) ;
    float a=max(rachis, leaflet);
    vec3 c=vec3(0.75+0.25*(1.-x/0.4))*(0.8+0.2*t);
    C=vec4(c, a);
  `, { seed: 79 });
  TEX.flowers = tg.card(512, `
    // 4 columns: white daisy, yellow, violet, pale blue
    float colI=floor(uv.x*4.); vec2 p=vec2(fract(uv.x*4.), uv.y);
    vec3 col=srgb(vec3(0.3,0.45,0.18)); float a=0.;
    // stems
    for(int i=0;i<4;i++){ float fi=float(i); float sx=0.2+0.2*fi+0.05*(hash12(vec2(fi,colI))-0.5);
      float top=0.55+0.35*hash12(vec2(fi,colI+3.));
      float d=abs(p.x-sx-0.03*sin(p.y*6.+fi)); float st=smoothstep(0.02,0.008,d)*step(p.y,top);
      if(st>0.){ col=srgb(vec3(0.3,0.45,0.18)); a=max(a,st); }
      vec2 fc=vec2(sx+0.03*sin(top*6.+fi), top); vec2 d2=p-fc; float r=length(d2*vec2(1.,1.6))/0.085; float ang=atan(d2.y,d2.x);
      float pet = step(r, 0.7+0.3*cos(ang*(colI==2.?5.:8.)));
      if(pet>0.){
        vec3 pc = colI==0.?srgb(vec3(0.97,0.96,0.92)): colI==1.?srgb(vec3(0.98,0.82,0.2)): colI==2.?srgb(vec3(0.6,0.4,0.85)): srgb(vec3(0.62,0.72,0.95));
        pc = mix(pc, srgb(vec3(0.95,0.75,0.2)), step(r,0.28));
        col=pc; a=1.;
      }
    }
    C=vec4(col,a);
  `, { seed: 83 });
  TEX.petal = tg.card(128, `
    vec2 p=uv-0.5; p.y+=0.1; float r=length(p*vec2(1.5,1.0));
    float notch = smoothstep(0.02,0.06, length(p-vec2(0.,0.4)));
    float a=smoothstep(0.42,0.38,r)*notch;
    vec3 c=mix(srgb(vec3(1.0,0.8,0.86)), srgb(vec3(0.99,0.93,0.94)), uv.y);
    c=mix(srgb(vec3(0.92,0.55,0.65)), c, smoothstep(0.0,0.3,uv.y));
    C=vec4(c,a);
  `, { seed: 89, mips: false });
  TEX.moon = tg.card(512, `
    vec2 p=uv*2.-1.; float r=length(p);
    float sph = sqrt(max(0.,1.-r*r));
    vec3 n=vec3(p, sph);
    vec2 q=vec2(atan(n.x,n.z), asin(n.y))*vec2(0.5,1.0);
    float mare = smoothstep(0.1,0.4, pfbm(q*0.5+0.5, vec2(3.),5)*0.5+0.5);
    float cr=0.;
    for(int i=0;i<3;i++){ vec4 v=pvor(q*0.5+0.5+float(i)*0.31, vec2(6.+float(i)*9.), 1.); float rim=smoothstep(0.35,0.28,v.x)-smoothstep(0.28,0.1,v.x)*0.6; cr+=rim*(0.5/(1.+float(i))); }
    float alb = 0.72 - mare*0.3 + cr*0.35 + pfbm(q+0.2,vec2(20.),4)*0.08;
    float limb = pow(sph,0.35);
    C=vec4(vec3(alb*limb), smoothstep(1.0,0.985,r));
  `, { seed: 97 });
  // tileable cloud noise (4 octave bands in channels)
  TEX.noise = tg.pass(512, `void main(){ vec2 uv=vUv;
      gl_FragColor=vec4(pfbm(uv,vec2(4.),6)*0.5+0.5, pfbm(uv+0.3,vec2(8.),6)*0.5+0.5, pridge(uv,vec2(6.),5), pfbm(uv+0.7,vec2(16.),5)*0.5+0.5); }`, {}, { seed: 101 }).texture;
  // water ripple normals (tileable)
  TEX.waterN = tg.pass(512, `
    float hgt(vec2 uv){
      float h=0.;
      h += pfbm(uv, vec2(8.), 5)*0.6;
      h += pnoise(vec2(uv.x*24., uv.y*6.), vec2(24.,6.))*0.25;
      h += pnoise(vec2(uv.x*10.+uv.y*6., uv.y*14.), vec2(10.,14.))*0.2;
      return h;
    }
    void main(){ vec2 uv=vUv; float e=1./512.;
      float hl=hgt(uv-vec2(e,0.)), hr=hgt(uv+vec2(e,0.)), hd=hgt(uv-vec2(0.,e)), hu=hgt(uv+vec2(0.,e));
      vec3 n=normalize(vec3((hl-hr)*40., (hd-hu)*40., 1.));
      gl_FragColor=vec4(n*0.5+0.5, hgt(uv)*0.5+0.5); }`, {}, { seed: 103 }).texture;
}
