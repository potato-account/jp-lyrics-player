// 각 곡: 유튜브 영상 길이 vs LRCLIB 항목 길이 vs 마지막 가사 시각 대조.
//   node check-timing.mjs   (../tools 에서)
import fs from "fs";
import path from "path";

const SONGS = path.resolve("../songs");
const YTDUR = new Map(
  fs.readFileSync(path.resolve('./yt-durations.txt'), "utf-8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const [id, d] = l.split("|"); return [id, +d]; })
);
const HAS_JP = (s) => /[぀-ヿ㐀-鿿]/.test(s || "");

async function lrcDur(title, ytDur) {
  try {
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=Vaundy`;
    const data = await (await fetch(url)).json();
    const synced = data.filter((x) => x.syncedLyrics);
    if (!synced.length) return null;
    const jp = synced.filter((x) => HAS_JP(x.syncedLyrics));
    const pool = jp.length ? jp : synced;
    if (ytDur) pool.sort((a, b) => Math.abs((a.duration || 0) - ytDur) - Math.abs((b.duration || 0) - ytDur));
    else pool.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    return pool[0].duration;
  } catch { return null; }
}

const files = fs.readdirSync(SONGS).filter((f) => /^\d+_/.test(f)).sort((a, b) => +a.split("_")[0] - +b.split("_")[0]);
const rows = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(SONGS, f), "utf-8"));
  const yt = YTDUR.get(d.youtubeId);
  const lrc = Math.round(await lrcDur(d.title, yt) || 0);
  await new Promise((r) => setTimeout(r, 300));
  const lastT = Math.round(d.lines[d.lines.length - 1].t);
  const firstT = d.lines[0].t.toFixed(1);
  const diff = yt && lrc ? yt - lrc : null;
  let verdict = "?";
  if (d.approxTiming) verdict = "◆ 근사(직접맞춰야)";
  else if (diff == null) verdict = "? YT길이불명";
  else if (Math.abs(diff) <= 2 && lastT <= yt) verdict = "👍 잘 맞을 것";
  else if (lastT > yt) verdict = `✗ 마지막가사(${lastT}s)가 영상(${yt}s) 초과`;
  else if (Math.abs(diff) <= 5) verdict = `△ 길이차 ${diff}s (offset 미세조정)`;
  else verdict = `⚠ 길이차 ${diff}s — offset ${diff > 0 ? "+" : ""}${diff}s 근처 필요할 수 있음`;
  rows.push({ n: f.split("_")[0], title: d.title, yt: yt || "?", lrc, diff, firstT, lastT, verdict });
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("#", 3) + pad("곡", 22) + pad("YT", 6) + pad("LRC", 6) + pad("Δ", 6) + pad("첫", 6) + pad("끝", 6) + "판정");
for (const r of rows)
  console.log(pad(r.n, 3) + pad(r.title, 22) + pad(r.yt, 6) + pad(r.lrc, 6) + pad(r.diff ?? "-", 6) + pad(r.firstT, 6) + pad(r.lastT, 6) + r.verdict);
