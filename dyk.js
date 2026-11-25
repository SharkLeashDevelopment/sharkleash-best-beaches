// SharkLeash "Did you know?" daily post: picks today's fact from sharkleash-data/did-you-know.json and draws
// data/post/dyk/tiktok.png (1080x1920, kept clear of TikTok's search bar, caption and side buttons),
// data/post/dyk/instagram.png (1080x1350) and data/post/dyk/caption.txt. Published on the post branch with the Top 5.
// Today's fact = the entry whose "day" is today (Eastern). With no entry for today it repeats the list in order.
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const DYK_URL = 'https://raw.githubusercontent.com/SharkLeashDevelopment/sharkleash-data/main/did-you-know.json';
const TZ = 'America/New_York';
const FONT = '"Liberation Sans", "DejaVu Sans", Arial, sans-serif, "Noto Color Emoji"';
const ST = { ME: 'Maine', NH: 'New Hampshire', MA: 'Massachusetts', RI: 'Rhode Island', CT: 'Connecticut', NY: 'New York', NJ: 'New Jersey', DE: 'Delaware',
  MD: 'Maryland', VA: 'Virginia', NC: 'North Carolina', SC: 'South Carolina', GA: 'Georgia', FL: 'Florida', AL: 'Alabama', MS: 'Mississippi', LA: 'Louisiana', TX: 'Texas', ALL: 'Every state' };
const TAGS = '#SharkLeashFishing #dronefishing #sharkfishing #landbasedsharkfishing #fishingdrone';

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function pick(list, day) {
  const hit = list.find(f => f.day === day); if (hit) return hit;
  const n = Math.floor(Date.parse(day + 'T12:00:00Z') / 864e5); return list[((n % list.length) + list.length) % list.length];
}
function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
function wrap(x, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
  if (cur) lines.push(cur); return lines;
}
function spaced(x, s, X, Y, gap) { for (const ch of s) { x.fillText(ch, X, Y); X += x.measureText(ch).width + gap; } }
function spacedW(x, s, gap) { let w = 0; for (const ch of s) w += x.measureText(ch).width + gap; return w - gap; }
function niceDate(d) { const t = new Date(d + 'T12:00:00Z'); return isNaN(t) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

/* box = the area that stays visible on that platform */
function draw(f, W, H, box) {
  const c = createCanvas(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#02080d'); g.addColorStop(.5, '#061923'); g.addColorStop(1, '#02080d'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const r1 = x.createRadialGradient(W * .85, H * .2, 0, W * .85, H * .2, W * .6); r1.addColorStop(0, 'rgba(0,194,255,.18)'); r1.addColorStop(1, 'rgba(0,194,255,0)'); x.fillStyle = r1; x.fillRect(0, 0, W, H);
  const r2 = x.createRadialGradient(W * .1, H * .85, 0, W * .1, H * .85, W * .6); r2.addColorStop(0, 'rgba(255,40,40,.16)'); r2.addColorStop(1, 'rgba(255,40,40,0)'); x.fillStyle = r2; x.fillRect(0, 0, W, H);
  const L = box.x0, R = box.x1, CW = R - L; let y = box.y0;
  x.textBaseline = 'alphabetic';
  // wordmark
  x.fillStyle = '#fff'; x.font = 'bold 40px ' + FONT; x.fillText('SharkLeash', L, y + 40);
  const lw = x.measureText('SharkLeash').width; x.fillStyle = '#ff2b2b'; x.fillRect(L, y + 52, lw, 6);
  y += 110;
  // DID YOU KNOW pill
  x.font = 'bold 30px ' + FONT; const pill = 'DID YOU KNOW?', pw = spacedW(x, pill, 7) + 60;
  rr(x, L, y, pw, 66, 33); x.fillStyle = 'rgba(0,194,255,.10)'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#6ee7ff'; x.stroke();
  x.fillStyle = '#6ee7ff'; spaced(x, pill, L + 30, y + 44, 7);
  y += 110;
  // state
  const stName = (ST[f.state] || f.state || '').toUpperCase();
  if (stName) { x.font = 'bold 30px ' + FONT; x.fillStyle = '#ffb020'; spaced(x, '📍 ' + stName, L, y + 30, 5); y += 64; }
  // fact: largest size that fits the space left above the call to action
  const bottomH = 250, room = box.y1 - bottomH - y - 20;
  let size = 76, lines = [];
  for (; size >= 34; size -= 2) { x.font = 'bold ' + size + 'px ' + FONT; lines = wrap(x, f.fact, CW); if (lines.length * size * 1.22 <= room) break; }
  x.fillStyle = '#fff'; x.font = 'bold ' + size + 'px ' + FONT;
  lines.forEach((l, i) => x.fillText(l, L, y + size + i * size * 1.22));
  // call to action, pinned to the bottom of the visible area
  let b = box.y1 - bottomH;
  x.font = 'bold 30px ' + FONT; x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText('New to drone fishing?', L, b + 30);
  b += 50; rr(x, L, b, CW, 96, 48); x.fillStyle = '#ff3b1f'; x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 40px ' + FONT; const cta = 'Check your exact beach free'; x.fillText(cta, L + (CW - x.measureText(cta).width) / 2, b + 62);
  b += 96 + 46; x.font = '26px ' + FONT; x.fillStyle = 'rgba(255,255,255,.55)';
  const src = 'Link in bio · Source: ' + host(f.source) + ' · checked ' + niceDate(f.checked) + ' · not legal advice';
  let fs2 = 26; while (x.measureText(src).width > CW && fs2 > 16) { fs2 -= 1; x.font = fs2 + 'px ' + FONT; }
  x.fillText(src, L, b);
  return c.toBuffer('image/png');
}

async function todaysFact() {
  const r = await fetch(DYK_URL + '?t=' + Date.now(), { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('did-you-know.json HTTP ' + r.status);
  const list = (await r.json()).filter(f => f && f.fact);
  if (!list.length) throw new Error('did-you-know.json is empty');
  return pick(list, today());
}
module.exports = async function makeDyk(outDir) {
  const f = await todaysFact(); global.SL_DYK = f;   // the Top 5 images show the same fact
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tiktok.png'), draw(f, 1080, 1920, { x0: 70, x1: 930, y0: 250, y1: 1470 }));
  fs.writeFileSync(path.join(outDir, 'instagram.png'), draw(f, 1080, 1350, { x0: 80, x1: 1000, y0: 60, y1: 1300 }));
  fs.writeFileSync(path.join(outDir, 'caption.txt'), 'Did you know? 🦈 ' + f.fact + ' New to drone fishing? Check your exact beach free before you fly: link in bio. ' + TAGS + '\n');
  return f;
};
module.exports.draw = draw; module.exports.pick = pick; module.exports.todaysFact = todaysFact;
