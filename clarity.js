// clarity.js: rolling water-clarity outlook (Clean / Stained / Dirty + estimated visibility).
// Physics: waves stir the bottom when wave orbital velocity near the bed passes a threshold;
// onshore wind holds the murk against the beach; it settles out with a half-life; offshore wind clears it faster.
// Every number in C is a starting guess. Tune them from angler reports (see the build plan doc).
const C = {
  refDepthM: 5.0,            // ~16 ft, just outside the bar where baits land
  uCrit: 0.30, uScale: 0.50, // m/s: stirring starts at uCrit, +1 per uScale above it
  halfLifeH: 18,
  kIn: 1 / 26,               // steady stirring of 1.0 levels murk at ~1.0
  onshoreScaleMph: 15,       // 15 mph straight onshore doubles stirring
  offshoreScaleMph: 20,      // 20 mph straight offshore halves the half-life
  maxStepH: 6,
  maxGapH: 24,               // longer gap than this = restart from current conditions
  spinUpH: 48,
  cutStained: 0.4, cutDirty: 1.4,
  c0: 1.2, cGrowth: 1.6,     // light dimming per meter: c = c0 * e^(cGrowth * murk)
  defaultPeriodS: 6
};
const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function kh(T, h) { // Eckart's approximation to the wave dispersion relation
  const w = 2 * Math.PI / T, y = w * w * h / 9.81;
  return y / Math.sqrt(Math.tanh(y));
}
function bottomVelocity(Hm, T, h) {
  if (!(Hm > 0 && T > 0)) return 0;
  return Math.PI * Hm / (T * Math.sinh(kh(T, h)));
}
function dirDeg(d) { if (typeof d === 'number') return d; const i = DIRS.indexOf(d); return i < 0 ? null : i * 22.5; }
function onshoreMph(speed, fromDir, faces) {
  const f = dirDeg(fromDir);
  if (!(speed >= 0) || f == null || faces == null) return 0;
  return speed * Math.cos((f - faces) * Math.PI / 180); // + onshore, - offshore
}

// obs: { waveFt, periodS, windMph, windDir }; beach: { faces }
function stepMurk(murk, hours, obs, beach) {
  const T = obs.periodS > 0 ? obs.periodS : C.defaultPeriodS;
  const u = obs.waveFt > 0 ? bottomVelocity(obs.waveFt / 3.28084, T, C.refDepthM) : 0;
  const stir = Math.max(0, u - C.uCrit) / C.uScale;
  const on = onshoreMph(obs.windMph, obs.windDir, beach.faces);
  const mult = 1 + Math.max(0, on) / C.onshoreScaleMph;
  const hl = C.halfLifeH / (1 + Math.max(0, -on) / C.offshoreScaleMph);
  let m = murk;
  for (let left = hours; left > 0; left -= C.maxStepH) {
    const dt = Math.min(C.maxStepH, left);
    m = m * Math.pow(0.5, dt / hl) + stir * mult * dt * C.kIn;
  }
  return { murk: m, onshore: on };
}

function rate(total) {
  const rating = total < C.cutStained ? 'clean' : total < C.cutDirty ? 'stained' : 'dirty';
  const visFt = 3.281 * 4.8 / (C.c0 * Math.exp(C.cGrowth * total));
  const lo = Math.max(0.5, Math.round(visFt * 0.7 * 2) / 2), hi = Math.max(1, Math.round(visFt * 1.3));
  return { rating, vis: [lo, Math.max(hi, lo)] };
}

function why(obs, on, base) {
  if (base >= C.cutStained) return 'usually murky here';
  const parts = [];
  parts.push(obs.waveFt > 0 ? Math.round(obs.waveFt) + ' ft waves' + (obs.periodS > 0 ? ' at ' + Math.round(obs.periodS) + 's' : '') : 'no wave reading');
  parts.push(on > 3 ? 'onshore wind' : on < -3 ? 'offshore wind' : 'light or side wind');
  return parts.join(', ');
}

// state: { [beachKey]: { murk, t } } (persisted in data/clarity-state.json)
// waveKnown=false (no wave reading) => don't advance the state, just report from what we have.
function updateClarity(state, key, beach, obs, nowMs, waveKnown) {
  const prev = state[key];
  let r;
  if (!waveKnown) {
    const m = prev && nowMs - prev.t < C.maxGapH * 36e5 ? prev.murk : null;
    if (m == null) return null;
    r = { murk: m, onshore: onshoreMph(obs.windMph, obs.windDir, beach.faces) };
  } else if (!prev || nowMs - prev.t > C.maxGapH * 36e5) {
    r = stepMurk(0, C.spinUpH, obs, beach);
    state[key] = { murk: +r.murk.toFixed(3), t: nowMs };
  } else {
    r = stepMurk(prev.murk, Math.max(0, (nowMs - prev.t) / 36e5), obs, beach);
    state[key] = { murk: +r.murk.toFixed(3), t: nowMs };
  }
  const base = beach.clarityBase || 0;
  const out = rate(r.murk + base);
  out.murk = +r.murk.toFixed(3);
  out.why = why(obs, r.onshore, base);
  return out;
}

module.exports = { updateClarity, C, bottomVelocity, onshoreMph };
