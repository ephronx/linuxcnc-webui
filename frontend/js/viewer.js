/**
 * viewer.js — 2D/3D toolpath and machine workspace visualiser.
 *
 * View modes:
 *   XY  — orthographic top-down      (2D)
 *   XZ  — orthographic front view    (2D)
 *   YZ  — orthographic side view     (2D)
 *   3D  — orthographic with orbit    (3D, left-drag rotates, shift-drag pans)
 *
 * Architecture:
 *   Toolpath segments are pre-rendered to an OffscreenCanvas whenever the
 *   camera changes.  Each animation frame just blits that image and draws
 *   the live tool crosshair on top.  This keeps the RAF loop cheap.
 */

import { state, config, onUpdate, onConfig } from "./state.js";

// ---- DOM ----

const canvas   = document.getElementById("viewer-canvas");
const vposX    = document.getElementById("vpos-x");
const vposY    = document.getElementById("vpos-y");
const vposZ    = document.getElementById("vpos-z");
const fitBtn   = document.getElementById("btn-viewer-fit");
const statusEl = document.getElementById("viewer-status");

if (!canvas) throw new Error("viewer-canvas not found");
const ctx = canvas.getContext("2d");

// ---- Design tokens (mirror CSS vars) ----

const C = {
  bg:        "#0d0f12",
  grid:      "#1e2229",
  gridHi:    "#252b35",
  border:    "#2e3540",
  borderHi:  "#3d4758",
  textDim:   "#4a5568",
  textSec:   "#8a9bb5",
  accent:    "#00aaff",
  accentDim: "#0066aa",
  green:     "#22c55e",
  yellow:    "#f59e0b",
  red:       "#ef4444",
  rapid:     "#3d4758",
  feed:      "#00aaff",
  feedDeep:  "#0044aa",
  cut:       "#22c55e",   // executed feed segments — green "cut" trail
  cutDim:    "#14532d",   // executed rapid segments (very dim)
  trail:     "245,158,11", // amber — live tool motion trail (used as rgb components)
};

// ---- State ----

let _plane    = "XY";
let _segments = [];
let _extents  = null;   // {minU,maxU,minV,maxV} in WCS (add _wcsOffset to get machine coords)
let _bounds   = null;   // machine limits {X:[min,max], Y:[min,max], Z:[min,max]}
let _toolPos   = [0, 0, 0];  // machine coordinates (for viewer crosshair drawing)
let _toolTrail = [];         // recent tool positions [[x,y,z], …] newest at end
const TRAIL_MAX = 80;        // ~4 s of history at 20 Hz
let _wcsOffset = [0, 0, 0];  // g5x + g92 offset — adds to WCS to get machine coordinates
let _execLine = 0;           // program line currently executed (0 = nothing running)
let _offscreen    = null;
let _offscreenCam = null;   // snapshot of camera+rotation when offscreen was rendered
let _needsRedraw  = true;

// Camera: world-space orbit/pan centre + uniform scale (px/mm).
// cz is only used in 3D mode as the Z component of the orbit centre.
let _cam = { cx: 0, cy: 0, cz: 0, scale: 5 };

// 3D orbit rotation (degrees).  azimuth rotates around Z (turntable);
// elevation tilts the view up/down.  Clamped to [-89, 89] for elevation.
let _rot3d = { az: -30, el: 25 };

// ---- Plane helpers (2D modes) ----

function _uv(pos) {
  if (_plane === "XY") return [pos[0], pos[1]];
  if (_plane === "XZ") return [pos[0], pos[2]];
  /* YZ */             return [pos[1], pos[2]];
}

function _uvLabels() {
  if (_plane === "XY") return ["X", "Y"];
  if (_plane === "XZ") return ["X", "Z"];
  return ["Y", "Z"];
}

function _boundsUV() {
  const b = _bounds ?? { X: [0, 300], Y: [0, 200], Z: [-200, 0] };
  if (_plane === "XY") return { minU: b.X[0], maxU: b.X[1], minV: b.Y[0], maxV: b.Y[1] };
  if (_plane === "XZ") return { minU: b.X[0], maxU: b.X[1], minV: b.Z[0], maxV: b.Z[1] };
  return { minU: b.Y[0], maxU: b.Y[1], minV: b.Z[0], maxV: b.Z[1] };
}

// ---- World ↔ Canvas (2D modes) ----

function _w2c(u, v) {
  return {
    x: canvas.width  / 2 + (u - _cam.cx) * _cam.scale,
    y: canvas.height / 2 - (v - _cam.cy) * _cam.scale,
  };
}

function _c2w(cx, cy) {
  return {
    u: _cam.cx + (cx - canvas.width  / 2) / _cam.scale,
    v: _cam.cy - (cy - canvas.height / 2) / _cam.scale,
  };
}

// ---- 3D projection ----
//
// Orthographic projection (standard in CNC/CAM — measurements read correctly).
// Two-step rotation: first rotate around Z (azimuth / turntable), then around
// the resulting X axis (elevation / tilt).

function _project3d(wx, wy, wz) {
  // Translate to orbit centre
  const px = wx - _cam.cx;
  const py = wy - _cam.cy;
  const pz = wz - _cam.cz;

  const az = _rot3d.az * Math.PI / 180;
  const el = _rot3d.el * Math.PI / 180;

  // Rotate around Z (azimuth)
  const rx =  px * Math.cos(az) - py * Math.sin(az);
  const ry0 = px * Math.sin(az) + py * Math.cos(az);
  const rz0 = pz;

  // Rotate around new X (elevation) — positive el tilts camera downward so Z+ rises on screen
  const ry =  ry0 * Math.cos(el) + rz0 * Math.sin(el);
  const rz = -ry0 * Math.sin(el) + rz0 * Math.cos(el);

  return {
    sx:    canvas.width  / 2 + rx * _cam.scale,
    sy:    canvas.height / 2 - ry * _cam.scale,
    depth: rz,   // view-space depth for painter's algorithm
  };
}

// ---- Fit camera ----

function _fitTo2D(minU, maxU, minV, maxV, margin = 0.1) {
  const W = canvas.width  || 300;
  const H = canvas.height || 200;
  const rangeU = maxU - minU || 100;
  const rangeV = maxV - minV || 100;
  _cam.cx    = (minU + maxU) / 2;
  _cam.cy    = (minV + maxV) / 2;
  _cam.scale = Math.max(0.1, Math.min(W / rangeU, H / rangeV) * (1 - margin));
}

function _fitTo3D() {
  // Compute 3D bounding box of segments (or fall back to machine limits).
  let mnX = Infinity, mxX = -Infinity;
  let mnY = Infinity, mxY = -Infinity;
  let mnZ = Infinity, mxZ = -Infinity;

  for (const s of _segments) {
    for (const p of [s.from, s.to]) {
      // Shift WCS segment into machine space
      const mx = p[0] + _wcsOffset[0];
      const my = p[1] + _wcsOffset[1];
      const mz = p[2] + _wcsOffset[2];
      if (mx < mnX) mnX = mx; if (mx > mxX) mxX = mx;
      if (my < mnY) mnY = my; if (my > mxY) mxY = my;
      if (mz < mnZ) mnZ = mz; if (mz > mxZ) mxZ = mz;
    }
  }

  if (!isFinite(mnX)) {
    mnX = _bounds?.X[0] ?? 0; mxX = _bounds?.X[1] ?? 300;
    mnY = _bounds?.Y[0] ?? 0; mxY = _bounds?.Y[1] ?? 200;
    mnZ = _bounds?.Z[0] ?? -200; mxZ = _bounds?.Z[1] ?? 0;
  }

  // Orbit centre at bounding box centroid
  _cam.cx = (mnX + mxX) / 2;
  _cam.cy = (mnY + mxY) / 2;
  _cam.cz = (mnZ + mxZ) / 2;

  // Scale from bounding sphere radius
  const dx = mxX - mnX, dy = mxY - mnY, dz = mxZ - mnZ;
  const r  = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 || 100;
  const W  = canvas.width || 300;
  const H  = canvas.height || 200;
  _cam.scale = Math.max(0.1, Math.min(W, H) / (r * 2) * 0.80);
}

function _fitToContent() {
  // Measure the viewer *container* rather than the canvas element itself.
  // The canvas has flex:1 inside #shared-viewer, but its intrinsic pixel-buffer
  // size can fool getBoundingClientRect() before the ResizeObserver has updated
  // canvas.width/height after a layout change (e.g. gcode listing appearing).
  // Measuring the container + subtracting the toolbar is always correct.
  const viewer  = document.getElementById("shared-viewer");
  const toolbar = viewer?.querySelector(".viewer-toolbar");
  const vRect   = viewer?.getBoundingClientRect();
  const tH      = toolbar?.getBoundingClientRect().height ?? 0;
  if (vRect && vRect.width > 1) {
    const h = Math.max(Math.round(vRect.height - tH), 50);
    canvas.width  = Math.round(vRect.width);
    canvas.height = h;
    _offscreenCam = null;
  }

  if (_plane === "3D") {
    _fitTo3D();
  } else if (_extents) {
    // _extents are in WCS; shift into machine coords for comparison with _bounds
    const [offU, offV] = _uv(_wcsOffset);
    _fitTo2D(
      _extents.minU + offU, _extents.maxU + offU,
      _extents.minV + offV, _extents.maxV + offV
    );
  } else {
    const b = _boundsUV();
    _fitTo2D(b.minU, b.maxU, b.minV, b.maxV);
  }
  _needsRedraw = true;
}

// ---- G-code parser ----

function _parseGcode(text) {
  const segs = [];
  let pos     = [0, 0, 0];
  let motion  = 0;
  let abs     = true;
  let scale   = 1.0;
  let lineNum = 0;

  for (const raw of text.split(/\r?\n/)) {
    lineNum++;
    let l = raw.replace(/\(.*?\)/g, "").replace(/;.*$/, "").trim().toUpperCase();
    if (!l) continue;

    const words = {};
    for (const m of l.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)) {
      words[m[1]] = parseFloat(m[2]);
    }

    if ("G" in words) {
      const g = Math.round(words.G * 10) / 10;
      if ([0, 1, 2, 3].includes(g)) motion = g;
      if (g === 90) abs = true;
      if (g === 91) abs = false;
      if (g === 20) scale = 25.4;
      if (g === 21) scale = 1.0;
    }

    if (!("X" in words) && !("Y" in words) && !("Z" in words)) continue;

    const from = [...pos];
    const to   = [...pos];

    if (abs) {
      if ("X" in words) to[0] = words.X * scale;
      if ("Y" in words) to[1] = words.Y * scale;
      if ("Z" in words) to[2] = words.Z * scale;
    } else {
      if ("X" in words) to[0] += words.X * scale;
      if ("Y" in words) to[1] += words.Y * scale;
      if ("Z" in words) to[2] += words.Z * scale;
    }

    if (motion === 0) {
      segs.push({ type: "rapid", from, to, line: lineNum });
    } else if (motion === 1) {
      segs.push({ type: "feed", from, to, line: lineNum });
    } else {
      const arcSegs = _arcToSegs(from, to, words.I ?? 0, words.J ?? 0, scale, motion === 2);
      arcSegs.forEach(s => { s.line = lineNum; });
      segs.push(...arcSegs);
    }

    pos = to;
  }

  return segs;
}

function _arcToSegs(from, to, I, J, scale, cw) {
  I *= scale; J *= scale;
  const cx = from[0] + I, cy = from[1] + J;
  const r  = Math.sqrt(I * I + J * J);
  if (r < 0.001) return [{ type: "feed", from, to }];

  let a0 = Math.atan2(from[1] - cy, from[0] - cx);
  let a1 = Math.atan2(to[1]   - cy, to[0]   - cx);
  if (cw)  { if (a1 >= a0) a1 -= 2 * Math.PI; }
  else     { if (a1 <= a0) a1 += 2 * Math.PI; }

  let span = Math.abs(a1 - a0);
  if (span < 1e-4) span = 2 * Math.PI;

  const steps = Math.max(4, Math.ceil(span * r));
  const da    = (cw ? -1 : 1) * span / steps;
  const segs  = [];
  let prev    = [...from];

  for (let i = 1; i <= steps; i++) {
    const a    = a0 + da * i;
    const frac = i / steps;
    const next = [
      cx + r * Math.cos(a),
      cy + r * Math.sin(a),
      from[2] + (to[2] - from[2]) * frac,
    ];
    segs.push({ type: "feed", from: prev, to: [...next] });
    prev = next;
  }
  if (segs.length) segs[segs.length - 1].to = to;
  return segs;
}

// ---- Extents ----

function _computeExtents(segs) {
  if (!segs.length) return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const s of segs) {
    for (const p of [s.from, s.to]) {
      const [u, v] = _uv(p);
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
  }
  return { minU, maxU, minV, maxV };
}

// ---- Z range (for depth shading) ----

function _zRange() {
  let minZ = Infinity, maxZ = -Infinity;
  for (const s of _segments) {
    if (s.type === "feed") {
      if (s.to[2] < minZ) minZ = s.to[2];
      if (s.to[2] > maxZ) maxZ = s.to[2];
    }
  }
  return { minZ, maxZ, range: (maxZ - minZ) || 1 };
}

function _feedColour(z, minZ, range) {
  const t = Math.max(0, Math.min(1, (z - minZ) / range));
  return `rgb(0,${Math.round(68 + t * 102)},${Math.round(170 + t * 85)})`;
}

// ---- Offscreen render (2D planes) ----

function _renderOffscreen2D(oc) {
  const oct = oc.getContext("2d");
  const { minZ, range } = _zRange();

  // Helper: shift a WCS point into machine coordinates for drawing
  const mpt = p => [p[0] + _wcsOffset[0], p[1] + _wcsOffset[1], p[2] + _wcsOffset[2]];

  const exec = _execLine;

  // --- Pending rapids (not yet executed) ---
  oct.save();
  oct.setLineDash([4, 6]);
  oct.lineWidth = 0.8;
  oct.strokeStyle = C.rapid;
  oct.beginPath();
  for (const s of _segments) {
    if (s.type !== "rapid" || s.line <= exec) continue;
    const [u0, v0] = _uv(mpt(s.from)), [u1, v1] = _uv(mpt(s.to));
    const p0 = _w2c(u0, v0), p1 = _w2c(u1, v1);
    oct.moveTo(p0.x, p0.y); oct.lineTo(p1.x, p1.y);
  }
  oct.stroke();
  oct.restore();

  // --- Pending feeds (not yet executed) — Z-depth coloured ---
  oct.lineWidth = 1.2;
  oct.setLineDash([]);
  for (const s of _segments) {
    if (s.type !== "feed" || s.line <= exec) continue;
    const [u0, v0] = _uv(mpt(s.from)), [u1, v1] = _uv(mpt(s.to));
    const p0 = _w2c(u0, v0), p1 = _w2c(u1, v1);
    oct.strokeStyle = _feedColour(s.to[2] + _wcsOffset[2], minZ, range);
    oct.beginPath(); oct.moveTo(p0.x, p0.y); oct.lineTo(p1.x, p1.y); oct.stroke();
  }

  // --- Executed feed segments — green "cut" trail ---
  if (exec > 0) {
    oct.lineWidth = 1.5;
    oct.strokeStyle = C.cut;
    oct.beginPath();
    for (const s of _segments) {
      if (s.type !== "feed" || s.line > exec) continue;
      const [u0, v0] = _uv(mpt(s.from)), [u1, v1] = _uv(mpt(s.to));
      const p0 = _w2c(u0, v0), p1 = _w2c(u1, v1);
      oct.moveTo(p0.x, p0.y); oct.lineTo(p1.x, p1.y);
    }
    oct.stroke();
  }
}

// ---- Offscreen render (3D) ----

function _renderOffscreen3D(oc) {
  const oct = oc.getContext("2d");
  const { minZ, range } = _zRange();

  // Project all segments and sort back→front (painter's algorithm).
  // Using view-space depth (rz after rotation) ensures correct layering
  // regardless of camera angle.
  const exec = _execLine;
  const proj = _segments.map(s => {
    // Shift WCS segment into machine coordinates before projecting
    const p0 = _project3d(s.from[0]+_wcsOffset[0], s.from[1]+_wcsOffset[1], s.from[2]+_wcsOffset[2]);
    const p1 = _project3d(s.to[0]+_wcsOffset[0],   s.to[1]+_wcsOffset[1],   s.to[2]+_wcsOffset[2]);
    return { type: s.type, line: s.line, p0, p1, depth: (p0.depth + p1.depth) * 0.5, toZ: s.to[2]+_wcsOffset[2] };
  });
  proj.sort((a, b) => a.depth - b.depth);

  // --- Pending rapids ---
  oct.save();
  oct.setLineDash([4, 6]);
  oct.lineWidth = 0.8;
  oct.strokeStyle = C.rapid;
  oct.beginPath();
  for (const s of proj) {
    if (s.type !== "rapid" || s.line <= exec) continue;
    oct.moveTo(s.p0.sx, s.p0.sy); oct.lineTo(s.p1.sx, s.p1.sy);
  }
  oct.stroke();
  oct.restore();

  // --- Pending feeds — Z-depth coloured ---
  oct.lineWidth = 1.4;
  oct.setLineDash([]);
  for (const s of proj) {
    if (s.type !== "feed" || s.line <= exec) continue;
    oct.strokeStyle = _feedColour(s.toZ, minZ, range);
    oct.beginPath(); oct.moveTo(s.p0.sx, s.p0.sy); oct.lineTo(s.p1.sx, s.p1.sy); oct.stroke();
  }

  // --- Executed feeds — green cut trail ---
  if (exec > 0) {
    oct.lineWidth = 1.5;
    oct.strokeStyle = C.cut;
    oct.beginPath();
    for (const s of proj) {
      if (s.type !== "feed" || s.line > exec) continue;
      oct.moveTo(s.p0.sx, s.p0.sy); oct.lineTo(s.p1.sx, s.p1.sy);
    }
    oct.stroke();
  }
}

// ---- Offscreen dispatch ----

function _renderOffscreen() {
  if (!_segments.length) { _offscreen = null; _offscreenCam = null; return; }

  const oc = new OffscreenCanvas(canvas.width, canvas.height);
  if (_plane === "3D") {
    _renderOffscreen3D(oc);
  } else {
    _renderOffscreen2D(oc);
  }

  _offscreen = oc;
  _offscreenCam = {
    cx: _cam.cx, cy: _cam.cy, cz: _cam.cz, scale: _cam.scale,
    az: _rot3d.az, el: _rot3d.el,
    plane: _plane,
    wcsX: _wcsOffset[0], wcsY: _wcsOffset[1], wcsZ: _wcsOffset[2],
    execLine: _execLine,
  };
}

function _offscreenStale() {
  if (!_offscreen || !_offscreenCam) return true;
  return (
    _offscreenCam.plane    !== _plane         ||
    _offscreenCam.cx       !== _cam.cx        ||
    _offscreenCam.cy       !== _cam.cy        ||
    _offscreenCam.cz       !== _cam.cz        ||
    _offscreenCam.scale    !== _cam.scale     ||
    _offscreenCam.az       !== _rot3d.az      ||
    _offscreenCam.el       !== _rot3d.el      ||
    _offscreenCam.wcsX     !== _wcsOffset[0]  ||
    _offscreenCam.wcsY     !== _wcsOffset[1]  ||
    _offscreenCam.wcsZ     !== _wcsOffset[2]  ||
    _offscreenCam.execLine !== _execLine
  );
}

// ---- 2D drawing helpers ----

function _drawGrid() {
  const W = canvas.width, H = canvas.height;
  const worldSpan = Math.max(W, H) / _cam.scale;
  const rawStep   = worldSpan / 8;
  const mag       = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step      = ([1, 2, 5, 10].find(m => m * mag >= rawStep) ?? 10) * mag;
  const subStep   = step / 5;

  const tl = _c2w(0, 0), br = _c2w(W, H);
  const uMin = Math.min(tl.u, br.u), uMax = Math.max(tl.u, br.u);
  const vMin = Math.min(tl.v, br.v), vMax = Math.max(tl.v, br.v);

  ctx.lineWidth = 0.5;

  ctx.strokeStyle = C.grid;
  ctx.beginPath();
  for (let u = Math.floor(uMin / subStep) * subStep; u <= uMax; u += subStep) {
    const {x} = _w2c(u, 0); ctx.moveTo(x, 0); ctx.lineTo(x, H);
  }
  for (let v = Math.floor(vMin / subStep) * subStep; v <= vMax; v += subStep) {
    const {y} = _w2c(0, v); ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();

  ctx.strokeStyle = C.gridHi;
  ctx.beginPath();
  for (let u = Math.floor(uMin / step) * step; u <= uMax; u += step) {
    const {x} = _w2c(u, 0); ctx.moveTo(x, 0); ctx.lineTo(x, H);
  }
  for (let v = Math.floor(vMin / step) * step; v <= vMax; v += step) {
    const {y} = _w2c(0, v); ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();

  ctx.fillStyle = C.textDim;
  ctx.font = "10px monospace";
  for (let u = Math.floor(uMin / step) * step; u <= uMax; u += step) {
    const {x} = _w2c(u, 0);
    const {y} = _w2c(0, vMin + (vMax - vMin) * 0.02);
    ctx.fillText(u.toFixed(0), x + 2, Math.min(H - 2, y));
  }
}

function _drawBounds2D() {
  const b = _boundsUV();
  const tl = _w2c(b.minU, b.maxV);
  const br = _w2c(b.maxU, b.minV);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.borderHi;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.restore();

  const labels = _uvLabels();
  ctx.fillStyle = C.textDim;
  ctx.font = "9px monospace";
  const midU = _w2c((b.minU + b.maxU) / 2, b.minV);
  ctx.fillText(`${labels[0]}: ${b.minU}…${b.maxU}`, midU.x, midU.y + 12);
}

function _drawOrigin2D() {
  // Draw the WCS origin (G54/G55 etc.) at its machine-space location.
  // When no WCS has been set, _wcsOffset is [0,0,0] and this coincides with machine home.
  const [u, v] = _uv(_wcsOffset);
  const {x, y} = _w2c(u, v);
  const r = 8;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ff6b6b"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r, y); ctx.stroke();
  ctx.strokeStyle = "#51cf66"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function _drawTrail2D() {
  if (_toolTrail.length < 2) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
  const n = _toolTrail.length;
  for (let i = 1; i < n; i++) {
    const alpha = (i / n).toFixed(2);           // 0 = oldest/transparent → 1 = newest/opaque
    const [u0, v0] = _uv(_toolTrail[i - 1]);
    const [u1, v1] = _uv(_toolTrail[i]);
    const p0 = _w2c(u0, v0), p1 = _w2c(u1, v1);
    ctx.strokeStyle = `rgba(${C.trail},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function _drawTool2D() {
  _drawTrail2D();
  const [u, v] = _uv(_toolPos);
  const {x, y} = _w2c(u, v);
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,170,255,0.25)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y); ctx.lineTo(W, y);
  ctx.moveTo(x, 0); ctx.lineTo(x, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.5;
  const s = 10;
  ctx.beginPath();
  ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---- 3D drawing helpers ----

function _drawAxes3D() {
  // Draw WCS axis arrows from the WCS origin (in machine coords = _wcsOffset).
  const len = Math.min(canvas.width, canvas.height) * 0.12 / _cam.scale;
  const ox = _wcsOffset[0], oy = _wcsOffset[1], oz = _wcsOffset[2];
  const O   = _project3d(ox,       oy,       oz      );
  const Xe  = _project3d(ox + len, oy,       oz      );
  const Ye  = _project3d(ox,       oy + len, oz      );
  const Ze  = _project3d(ox,       oy,       oz + len);

  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = "bold 10px monospace";

  for (const [end, colour, label] of [[Xe, "#ff6b6b", "X"], [Ye, "#51cf66", "Y"], [Ze, "#00aaff", "Z"]]) {
    ctx.strokeStyle = colour;
    ctx.fillStyle   = colour;
    ctx.beginPath();
    ctx.moveTo(O.sx, O.sy);
    ctx.lineTo(end.sx, end.sy);
    ctx.stroke();
    ctx.fillText(label, end.sx + 3, end.sy + 3);
  }

  // Origin dot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(O.sx, O.sy, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function _drawBounds3D() {
  if (!_bounds) return;
  const [x0, x1] = _bounds.X, [y0, y1] = _bounds.Y, [z0, z1] = _bounds.Z;

  // 8 corners of the machine envelope
  const c = [
    [x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],
    [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],
  ].map(([x,y,z]) => _project3d(x, y, z));

  const edges = [
    [0,1],[1,2],[2,3],[3,0],   // Z-min face
    [4,5],[5,6],[6,7],[7,4],   // Z-max face
    [0,4],[1,5],[2,6],[3,7],   // verticals
  ];

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = C.borderHi;
  ctx.beginPath();
  for (const [a, b] of edges) {
    ctx.moveTo(c[a].sx, c[a].sy);
    ctx.lineTo(c[b].sx, c[b].sy);
  }
  ctx.stroke();
  ctx.restore();
}

function _drawTrail3D() {
  if (_toolTrail.length < 2) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
  const n = _toolTrail.length;
  for (let i = 1; i < n; i++) {
    const alpha = (i / n).toFixed(2);
    const p0 = _project3d(..._toolTrail[i - 1]);
    const p1 = _project3d(..._toolTrail[i]);
    ctx.strokeStyle = `rgba(${C.trail},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke();
  }
  ctx.restore();
}

function _drawTool3D() {
  _drawTrail3D();
  const p = _project3d(_toolPos[0], _toolPos[1], _toolPos[2]);
  ctx.save();
  ctx.strokeStyle = C.accent;
  ctx.fillStyle   = C.accent;
  ctx.lineWidth   = 1.5;
  const s = 9;
  ctx.beginPath();
  ctx.moveTo(p.sx - s, p.sy); ctx.lineTo(p.sx + s, p.sy);
  ctx.moveTo(p.sx, p.sy - s); ctx.lineTo(p.sx, p.sy + s);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---- Main render ----

function _render() {
  if (!_needsRedraw) return;
  _needsRedraw = false;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  if (_plane === "3D") {
    _drawBounds3D();
    _drawAxes3D();
  } else {
    _drawGrid();
    _drawBounds2D();
    _drawOrigin2D();
  }

  // Blit pre-rendered toolpath — re-render if camera / rotation changed.
  if (_segments.length) {
    if (_offscreenStale()) _renderOffscreen();
    if (_offscreen) ctx.drawImage(_offscreen, 0, 0);
  }

  if (_plane === "3D") {
    _drawTool3D();
  } else {
    _drawTool2D();
  }

  // Plane label
  ctx.fillStyle = C.textDim;
  ctx.font = "bold 11px monospace";
  ctx.fillText(_plane, 8, 16);
}

function _scheduleRender() {
  _needsRedraw = true;
  requestAnimationFrame(_render);
}

// ---- Resize ----

function _resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  || 300;
  canvas.height = rect.height || 200;
  _offscreenCam = null;   // force offscreen rebuild at new dimensions
  _scheduleRender();
}

new ResizeObserver(_resize).observe(canvas);

// ---- Pan + Zoom + Orbit ----

let _dragging  = false;
let _dragStart = null;

canvas.addEventListener("pointerdown", e => {
  _dragging  = true;
  _dragStart = {
    x: e.clientX, y: e.clientY,
    // 2D pan state
    cx: _cam.cx, cy: _cam.cy,
    // 3D orbit state
    az: _rot3d.az, el: _rot3d.el,
    shift: e.shiftKey,
  };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", e => {
  if (!_dragging) return;
  const dx = e.clientX - _dragStart.x;
  const dy = e.clientY - _dragStart.y;

  if (_plane === "3D" && !_dragStart.shift) {
    // Rotate: 1 degree per ~2 px of drag
    _rot3d.az = _dragStart.az + dx * 0.4;
    _rot3d.el = Math.max(-89, Math.min(89, _dragStart.el - dy * 0.4));
  } else {
    // Pan (all 2D modes, and shift+drag in 3D)
    _cam.cx = _dragStart.cx - dx / _cam.scale;
    _cam.cy = _dragStart.cy + dy / _cam.scale;
  }

  _scheduleRender();
});

canvas.addEventListener("pointerup",     () => { _dragging = false; });
canvas.addEventListener("pointercancel", () => { _dragging = false; });

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;

  if (_plane === "3D") {
    // Zoom around canvas centre in 3D (no cursor-tracking needed for orthographic)
    _cam.scale = Math.max(0.01, _cam.scale * factor);
  } else {
    // Zoom towards mouse cursor (2D)
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const {u, v} = _c2w(mx, my);
    _cam.scale = Math.max(0.01, _cam.scale * factor);
    _cam.cx = u - (mx - canvas.width  / 2) / _cam.scale;
    _cam.cy = v + (my - canvas.height / 2) / _cam.scale;
  }

  _scheduleRender();
}, { passive: false });

// ---- Plane selector ----

const _hintEl = document.getElementById("viewer-hint");

function _updateHint() {
  if (!_hintEl) return;
  _hintEl.textContent = _plane === "3D"
    ? "drag: orbit · shift+drag: pan · scroll: zoom"
    : "drag: pan · scroll: zoom";
}

document.querySelectorAll(".viewer-plane-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".viewer-plane-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _plane = btn.dataset.plane;
    _extents = _computeExtents(_segments);
    _fitToContent();
    _updateHint();
    _scheduleRender();
  });
});

// ---- Fit button ----

fitBtn?.addEventListener("click", () => {
  _fitToContent();
  _scheduleRender();
});

// ---- Config ----

onConfig(cfg => {
  _bounds = {};
  const lim = cfg.axis_limits ?? {};
  _bounds.X = [lim.X?.min ?? 0, lim.X?.max ?? 300];
  _bounds.Y = [lim.Y?.min ?? 0, lim.Y?.max ?? 200];
  _bounds.Z = [lim.Z?.min ?? -200, lim.Z?.max ?? 0];
  if (!_segments.length) _fitToContent();
  _scheduleRender();
});

// ---- State updates (live tool position) ----

const _VIEWER_TABS = new Set(["manual", "mdi", "auto"]);
let _isViewerVisible = true;   // Manual tab is active on load

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const wasVisible = _isViewerVisible;
    _isViewerVisible = _VIEWER_TABS.has(btn.dataset.tab);
    if (_isViewerVisible && !wasVisible) {
      _resize();
      _scheduleRender();
    }
  });
});

onUpdate(s => {
  const pos = s.pos?.actual;
  if (!pos) return;

  const g5x = s.pos.g5x_offset ?? [];
  const g92 = s.pos.g92_offset ?? [];

  // Update WCS offset; if it changed the toolpath pre-render is now stale.
  const newOX = (g5x[0] ?? 0) + (g92[0] ?? 0);
  const newOY = (g5x[1] ?? 0) + (g92[1] ?? 0);
  const newOZ = (g5x[2] ?? 0) + (g92[2] ?? 0);
  if (newOX !== _wcsOffset[0] || newOY !== _wcsOffset[1] || newOZ !== _wcsOffset[2]) {
    _wcsOffset = [newOX, newOY, newOZ];
    _offscreenCam = null;   // force toolpath re-render at new WCS position
  }

  // Tool position in machine coordinates (so the crosshair sits on the machine envelope).
  const newToolPos = [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0];

  // Append to motion trail whenever the position changes
  const last = _toolTrail[_toolTrail.length - 1];
  if (!last || last[0] !== newToolPos[0] || last[1] !== newToolPos[1] || last[2] !== newToolPos[2]) {
    _toolTrail.push(newToolPos);
    if (_toolTrail.length > TRAIL_MAX) _toolTrail.shift();
  }
  _toolPos = newToolPos;

  // Track executed program line — invalidate offscreen if it changed
  const newExecLine = s.program?.motion_line || s.program?.line || 0;
  if (newExecLine !== _execLine) {
    // Clear trail when program rewinds/stops (line resets to 0)
    if (newExecLine === 0 && _execLine > 0) _toolTrail = [];
    _execLine = newExecLine;
    _offscreenCam = null;  // force re-render of executed/pending split
  }

  // Toolbar position readout shows WCS coordinates (what the G-code sees).
  const dp = config.units === "imperial" ? 4 : 3;
  if (vposX) vposX.textContent = ((pos[0] ?? 0) - newOX).toFixed(dp);
  if (vposY) vposY.textContent = ((pos[1] ?? 0) - newOY).toFixed(dp);
  if (vposZ) vposZ.textContent = ((pos[2] ?? 0) - newOZ).toFixed(dp);

  if (_isViewerVisible) _scheduleRender();
});

// ---- Public API ----

export function loadGcodeText(text, filename) {
  if (statusEl) statusEl.textContent = "Parsing…";
  setTimeout(() => {
    _segments = _parseGcode(text);
    _extents  = _computeExtents(_segments);
    _offscreenCam = null;   // force full re-render
    _fitToContent();
    _scheduleRender();
    if (statusEl) {
      statusEl.textContent = filename
        ? `${filename} — ${_segments.length} moves`
        : `${_segments.length} moves`;
    }
  }, 0);
}

// Initial fit on load
setTimeout(_fitToContent, 100);
