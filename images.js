// SharkLeash Best Beaches: draws the Top 5 post images (same design as the "Save post images" button on the site)
// 1080x1920 for TikTok / Reels / Stories and 1080x1350 for the Instagram feed.
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const TZ = 'America/New_York';
const FONT = '"Liberation Sans", "DejaVu Sans", Arial, sans-serif, "Noto Color Emoji"';

function rr(x, c, X, Y, W, H, r) {
  x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); x.fillStyle = c; x.fill();
}
function fit(x, t, max, size) {
  let s = size;
  do { x.font = 'bold ' + s + 'px ' + FONT; s -= 2; } while (x.measureText(t).width > max && s > 14);
}
function draw(top, W, H) {
  const c = createCanvas(W, H), x = c.getContext('2d'), tall = H > 1500;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#02080d'); g.addColorStop(.5, '#061923'); g.addColorStop(1, '#02080d');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const r1 = x.createRadialGradient(W * .8, H * .15, 0, W * .8, H * .15, W * .6); r1.addColorStop(0, 'rgba(0,194,255,.22)'); r1.addColorStop(1, 'rgba(0,194,255,0)'); x.fillStyle = r1; x.fillRect(0, 0, W, H);
  const r2 = x.createRadialGradient(W * .1, H * .9, 0, W * .1, H * .9, W * .6); r2.addColorStop(0, 'rgba(255,40,40,.2)'); r2.addColorStop(1, 'rgba(255,40,40,0)'); x.fillStyle = r2; x.fillRect(0, 0, W, H);
  let y = tall ? 150 : 80;
  x.fillStyle = '#fff'; x.font = 'bold 46px ' + FONT; x.fillText('SharkLeash', 70, y);
  const lw = x.measureText('SharkLeash').width; x.fillStyle = '#ff2b2b'; x.fillRect(66, y - 16, lw + 8, 5);
  y += tall ? 120 : 90; x.fillStyle = '#fff'; x.font = 'bold ' + (tall ? 92 : 80) + 'px ' + FONT; x.fillText('BEST SHARK', 70, y);
  y += tall ? 100 : 86; x.fillStyle = '#ff2b2b'; x.fillText('BEACHES TONIGHT', 70, y);
  y += tall ? 70 : 56; x.fillStyle = '#6ee7ff'; x.font = 'bold ' + (tall ? 40 : 34) + 'px ' + FONT;
  x.fillText(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ }) + ' · drone-legal spots', 70, y);
  y += tall ? 60 : 40;
  const rowH = tall ? (H - y - 330) / 5 : (H - y - 190) / 5;
  top.forEach((r, i) => {
    const Y = y + i * rowH; rr(x, 'rgba(255,255,255,.07)', 60, Y, W - 120, rowH - 22, 28);
    x.fillStyle = '#ff4b2b'; x.font = 'bold ' + (tall ? 96 : 78) + 'px ' + FONT; x.fillText(String(i + 1), 90, Y + (rowH - 22) / 2 + (tall ? 34 : 28));
    x.fillStyle = '#fff'; fit(x, r.name, W - 420, tall ? 52 : 44); x.fillText(r.name, 200, Y + (tall ? 78 : 62));
    const d = (r.w ? r.w.dir + ' ' + r.w.avg + ' mph' : '') + (r.wv != null ? ' · ' + (Math.round(r.wv * 2) / 2) + ' ft' : '') + (r.wt != null ? ' · ' + Math.round(r.wt) + '°F' : '');
    x.fillStyle = 'rgba(255,255,255,.8)'; fit(x, d, W - 420, tall ? 38 : 32); x.fillText(d, 200, Y + (tall ? 132 : 106));
    const extra = [r.note ? '🏠 private property launch only' : '', r.w && r.w.front ? '⚡ front coming' : ''].filter(Boolean).join('  ·  ');
    if (extra) { x.fillStyle = '#ffb020'; fit(x, extra, W - 420, tall ? 32 : 24); x.fillText(extra, 200, Y + (tall ? 178 : 131)); }
    x.fillStyle = '#6ee7ff'; x.font = 'bold ' + (tall ? 70 : 58) + 'px ' + FONT;
    const sc = String(r.score), sw = x.measureText(sc).width; x.fillText(sc, W - 100 - sw, Y + (rowH - 22) / 2 + (tall ? 24 : 20));
    x.fillStyle = 'rgba(255,255,255,.5)'; x.font = 'bold ' + (tall ? 24 : 20) + 'px ' + FONT;
    const lbw = x.measureText('drop score').width; x.fillText('drop score', W - 100 - lbw, Y + (rowH - 22) / 2 + (tall ? 58 : 48));
  });
  const fy = H - (tall ? 170 : 90); rr(x, '#ff3b1f', 60, fy - (tall ? 70 : 58), W - 120, tall ? 110 : 90, 26);
  const ft = 'Check your beach free: SharkLeashFishing.com'; x.fillStyle = '#fff'; fit(x, ft, W - 180, tall ? 44 : 38);
  x.fillText(ft, (W - x.measureText(ft).width) / 2, fy + (tall ? 2 : 0));
  return c;
}
function caption(top) {
  const d = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: TZ });
  return '🦈 Best shark beaches tonight, ' + d + ' (drone-legal spots)\n\n' +
    top.map((r, i) => (i + 1) + '. ' + r.name + ' (' + r.score + '): ' + (r.w ? r.w.dir + ' ' + r.w.avg + ' mph' : '') + (r.wv != null ? ', ' + (Math.round(r.wv * 2) / 2) + ' ft surf' : '') + (r.wt != null ? ', ' + Math.round(r.wt) + '°F water' : '') + (r.w && r.w.front ? ', front coming ⚡' : '') + (r.note ? ' · ' + r.note : '')).join('\n') +
    '\n\nRanked by the SharkLeash Drop Score (out of 100): wind, surf, water temp, sharks and bait running, and deep water close.\nCheck your own beach free at SharkLeashFishing.com\n#sharkleashfishing #sharkfishing #landbasedsharkfishing #dronefishing #LBSF\n';
}
module.exports = function makeImages(top, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tiktok.png'), draw(top, 1080, 1920).toBuffer('image/png'));
  fs.writeFileSync(path.join(outDir, 'instagram.png'), draw(top, 1080, 1350).toBuffer('image/png'));
  fs.writeFileSync(path.join(outDir, 'caption.txt'), caption(top));
};
