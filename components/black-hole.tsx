"use client";

import { useEffect, useRef } from "react";

// The Nillad "brain": a real-time WebGL raymarched black hole (true gravitational
// lensing). Doppler-split streamer palette (approaching side periwinkle, receding
// fiery red), white-hot photon ring, detailed clustered starfield + rare shooting
// star. Tuned for phones: low step count + reduced internal resolution. Swipe to
// orbit (the hole spins + stars sweep); it eases back to the hero framing on
// release. Flares on the global `nillad-absorb` event (chat-bar new-chat). Pauses
// when the tab is hidden.

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FS = `
precision highp float;
uniform vec2 R; uniform float T; uniform float uAbsorb; uniform vec2 uDrag;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}
vec3 sat(vec3 c, float s){ float l=dot(c,vec3(0.2126,0.7152,0.0722)); return max(l+(c-l)*s, 0.0); }
vec3 diskCol(float t, float side){
  vec3 hot=vec3(1.0,0.90,0.78);
  vec3 rM=vec3(1.0,0.24,0.04), rO=vec3(0.72,0.04,0.04);   // more saturated red
  vec3 bM=vec3(0.32,0.40,1.0), bO=vec3(0.15,0.09,0.72);   // more saturated periwinkle
  vec3 r=t<0.5?mix(hot,rM,t*2.):mix(rM,rO,(t-.5)*2.);
  vec3 b=t<0.5?mix(hot,bM,t*2.):mix(bM,bO,(t-.5)*2.);
  return mix(r,b,clamp(side*0.5+0.5,0.0,1.0));
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;
  uv.y-=0.26;   // screen-vertical shift FIRST → hole sits in the upper third, stays centered
  { float a=-0.4363; float ca=cos(a),sa=sin(a); uv=vec2(ca*uv.x-sa*uv.y, sa*uv.x+ca*uv.y); }  // 25° CCW roll, about the hole
  uv*=(1.0-uAbsorb*0.18);
  float aspect=R.x/R.y;
  // camera, orbited by drag (yaw + pitch) so a swipe spins the hole / sweeps stars
  vec3 ro=vec3(0.0,3.0,-32.0);
  // perpetual slow "float" (Lissajous) so stars sweep behind the hole + the
  // lensing shows off — plus whatever the user is dragging.
  float yaw = uDrag.x + sin(T*0.13)*0.13 + cos(T*0.071)*0.06;
  float pit = uDrag.y + sin(T*0.10+1.3)*0.05;
  { float y=yaw; ro.xz=mat2(cos(y),sin(y),-sin(y),cos(y))*ro.xz; }
  { float pc=pit; ro.yz=mat2(cos(pc),sin(pc),-sin(pc),cos(pc))*ro.yz; }
  vec3 ww=normalize(-ro);
  vec3 uu=normalize(cross(vec3(0,1,0),ww));
  vec3 vv=cross(ww,uu);
  vec3 rd=normalize(uv.x*uu+uv.y*vv+(aspect*2.0)*ww);
  vec3 p=ro; vec3 vel=rd;
  vec3 hc=cross(p,vel); float h2=dot(hc,hc);
  float Rs=1.0, rIn=2.3, rOut=8.0;
  vec3 col=vec3(0.0); float trans=1.0; bool horizon=false; float minr=1e9;
  for(int i=0;i<256;i++){
    float r2=dot(p,p), r=sqrt(r2); minr=min(minr,r);
    if(r<Rs){horizon=true;break;}
    vec3 acc=-1.5*h2*p/pow(r2,2.5);
    float dt=0.16;
    vec3 pn=p+vel*dt+0.5*acc*dt*dt;
    vel+=acc*dt;
    if(p.y*pn.y<0.0){
      float f=p.y/(p.y-pn.y); vec3 h=mix(p,pn,f); float rr=length(h.xz);
      if(rr>rIn&&rr<rOut){
        float t=(rr-rIn)/(rOut-rIn);
        float ang=atan(h.z,h.x);
        float sw=ang*3.0 - T*(0.45+uAbsorb*2.4) - 8.0/rr;
        float turb=fbm(vec2(sw, rr*1.1));
        turb=mix(turb, fbm(vec2(sw*2.3+5.0, rr*2.1)), 0.4);
        float dens=smoothstep(1.0,0.45,t)*(0.35+1.05*turb);
        float side=sin(ang+1.6);
        float dopp=1.0+0.32*side;
        vec3 c=diskCol(t,side)*dens*dopp;
        c+=diskCol(0.0,side)*smoothstep(0.16,0.0,t)*0.9;
        c=sat(c,1.45);                                    // punch the wing colors
        col+=trans*c*(3.0+uAbsorb*3.5); trans*=0.72;
      }
    }
    p=pn;
    if(r>42.0)break;
  }
  if(!horizon){
    float ls=smoothstep(5.5,2.2,minr);
    vec3 sd=normalize(mix(rd, vel, ls));
    vec2 q=vec2(atan(sd.z,sd.x)*0.159155+0.5, acos(clamp(sd.y,-1.0,1.0))*0.31831);
    float scl=220.0; vec2 g=q*scl; vec2 id=floor(g), gv=fract(g)-0.5;
    float cluster=smoothstep(0.38,0.84, fbm(q*9.0));
    float thr=mix(0.90,0.70,cluster);
    float hcell=hash(id); float star=0.0; vec3 stint=vec3(0.9);
    if(hcell>thr){
      vec2 sp=(vec2(hash(id+1.3),hash(id+2.7))-0.5)*0.62;
      float d=length(gv-sp);
      float sz=mix(0.045,0.18,pow(hash(id+9.1),3.0));
      float br=0.25+0.85*hash(id+5.1);
      star=smoothstep(sz,0.0,d)*br;
      star+=smoothstep(sz*2.8,0.0,d)*br*0.16*step(0.12,sz);
      float tw=0.7+0.3*sin(T*2.0+hash(id+4.2)*30.0);
      star*=tw;
      stint=mix(vec3(0.78,0.85,1.05), vec3(1.05,0.95,0.82), hash(id+3.7));
    }
    col+=trans*star*stint;
    // dense fine background stars (the "realistic deep-space" layer)
    { float s2=470.0; vec2 g2=q*s2; vec2 i2=floor(g2), v2=fract(g2)-0.5; float hc=hash(i2+13.0);
      if(hc>0.83){ vec2 sp2=(vec2(hash(i2+1.7),hash(i2+4.3))-0.5)*0.6; float d2=length(v2-sp2);
        float tw2=0.7+0.3*sin(T*1.7+hash(i2)*40.0);
        col+=trans*smoothstep(0.11,0.0,d2)*(0.09+0.30*hash(i2+8.8))*tw2*vec3(0.85,0.88,1.0); } }
    // even finer dust stars for density
    { float s3=900.0; vec2 g3=q*s3; vec2 i3=floor(g3), v3=fract(g3)-0.5; float hc3=hash(i3+29.0);
      if(hc3>0.88){ float d3=length(v3-(vec2(hash(i3+5.1),hash(i3+6.2))-0.5)*0.6);
        col+=trans*smoothstep(0.09,0.0,d3)*(0.05+0.12*hash(i3+2.3))*vec3(0.8,0.85,1.0); } }
    // subtle broad haze for depth (always present, very low contrast)
    float haze=smoothstep(0.42,0.96, fbm(q*1.6+4.0))*0.12;
    col+=trans*haze*vec3(0.11,0.10,0.16);
    col+=trans*vec3(0.0018,0.0018,0.0022);
  }
  float ring=smoothstep(0.16,0.0,minr-Rs*1.5)*step(Rs*1.5,minr);
  if(!horizon) col+=vec3(1.0,0.94,0.86)*ring*(1.35+0.18*sin(T*0.9)+uAbsorb*2.0);
  {
    float period=12.0; float ph=mod(T,period); float seed=floor(T/period);
    if(ph<1.3){
      float k=ph/1.3;
      vec2 st=vec2(0.24, 0.30+hash(vec2(seed,2.0))*0.18);
      vec2 dir=normalize(vec2(-1.0,-0.32-hash(vec2(seed,3.0))*0.2));
      vec2 head=st+dir*k*0.95;
      vec2 rel=uv-head;
      float along=dot(rel,-dir);
      float perp=abs(dot(rel,vec2(-dir.y,dir.x)));
      float tail=smoothstep(0.26,0.0,along)*step(-0.02,along);
      float streak=smoothstep(0.004,0.0,perp)*tail*smoothstep(1.0,0.55,k)*smoothstep(0.0,0.12,k);
      col+=vec3(0.85,0.92,1.0)*streak*1.7;
    }
  }
  col=col/(col+0.72);
  col=pow(col,vec3(0.82));
  gl_FragColor=vec4(col,1.0);
}`;

export function BlackHole({ getIntensity }: { getIntensity?: () => number } = {}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const gl = cvs.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) return;

    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uR = gl.getUniformLocation(prog, "R");
    const uT = gl.getUniformLocation(prog, "T");
    const uA = gl.getUniformLocation(prog, "uAbsorb");
    const uD = gl.getUniformLocation(prog, "uDrag");

    const SCALE = Math.min(2, window.devicePixelRatio || 1); // HIGH-DETAIL: full retina resolution
    function resize() {
      if (!cvs) return;
      const w = Math.max(1, cvs.clientWidth), h = Math.max(1, cvs.clientHeight);
      cvs.width = Math.max(1, Math.round(w * SCALE));
      cvs.height = Math.max(1, Math.round(h * SCALE));
      gl!.viewport(0, 0, cvs.width, cvs.height);
      gl!.uniform2f(uR, cvs.width, cvs.height);
    }
    const robs = new ResizeObserver(resize);
    robs.observe(cvs);
    resize();

    // ---- drag-to-orbit ----
    let yaw = 0, pit = 0, yawT = 0, pitT = 0;
    let dragging = false, lastX = 0, lastY = 0;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const onDown = (x: number, y: number) => { dragging = true; lastX = x; lastY = y; };
    const onMove = (x: number, y: number) => {
      if (!dragging) return;
      yawT = clamp(yawT + (x - lastX) * 0.006, -0.7, 0.7);
      pitT = clamp(pitT - (y - lastY) * 0.004, -0.22, 0.22);
      lastX = x; lastY = y;
    };
    const up = () => { dragging = false; };
    const pd = (e: PointerEvent) => onDown(e.clientX, e.clientY);
    const pm = (e: PointerEvent) => onMove(e.clientX, e.clientY);
    cvs.addEventListener("pointerdown", pd);
    window.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    // ---- absorb flare ----
    let absorb = 0, absorbTarget = 0, absorbTimer = 0;
    const onAbsorb = () => {
      absorbTarget = 1;
      window.clearTimeout(absorbTimer);
      absorbTimer = window.setTimeout(() => { absorbTarget = 0; }, 1100);
    };
    window.addEventListener("nillad-absorb", onAbsorb);

    let raf = 0, running = true;
    const t0 = performance.now();
    function frame(now: number) {
      if (!dragging) { yawT *= 0.94; pitT *= 0.94; } // ease back to the hero framing
      yaw += (yawT - yaw) * 0.1;
      pit += (pitT - pit) * 0.1;
      absorb += (absorbTarget - absorb) * 0.12;
      const ext = getIntensity ? getIntensity() : 0;        // continuous drive (voice amplitude)
      gl!.uniform1f(uT, (now - t0) / 1000);
      gl!.uniform1f(uA, Math.max(absorb, ext));
      gl!.uniform2f(uD, yaw, pit);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(absorbTimer);
      cvs.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("nillad-absorb", onAbsorb);
      document.removeEventListener("visibilitychange", onVis);
      robs.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="block w-full h-full"
      style={{ touchAction: "none", background: "radial-gradient(ellipse at 50% 42%, #060509 0%, #020203 72%)" }}
    />
  );
}
