// 수작업 txt (원문 / 발음 / 번역, 빈 줄 구분) + LRCLIB 타임 → songs/NN_slug.json
//
// 사용:
//   node merge-hand.mjs "../수작업/37 忘れる前に.txt" \
//     --title "忘れる前に" --artist Vaundy --youtube Hy7GWPkrZv0 \
//     --num 37 --slug wasureru-mae-ni [--lrc-id 25328066] [--dry]
//
// 발음/번역은 사용자가 만든 것이므로 pronSrc/transSrc = "user" 로 태그된다.
// 원문은 LRCLIB(올바른 일본어 표기)을 우선 쓰고, 매칭이 어긋난 줄은 리포트한다.

import fs from "fs";
import path from "path";

const argv = process.argv.slice(2);
const opts = { artist: "Vaundy" };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--title") opts.title = argv[++i];
  else if (a === "--artist") opts.artist = argv[++i];
  else if (a === "--youtube") opts.youtube = argv[++i];
  else if (a === "--num") opts.num = argv[++i];
  else if (a === "--slug") opts.slug = argv[++i];
  else if (a === "--lrc-id") opts.lrcId = +argv[++i];
  else if (a === "--dry") opts.dry = true;
  else if (a.startsWith("--")) { console.error("unknown flag " + a); process.exit(2); }
  else pos.push(a);
}
opts.txt = pos[0];
for (const k of ["txt", "title", "youtube", "num", "slug"]) {
  if (!opts[k]) { console.error(`missing --${k}`); process.exit(2); }
}

const SONGS_DIR = path.resolve("../songs");
const INDEX = path.join(SONGS_DIR, "index.json");

// ---- txt 파싱: 공백 제거 후 남은 조각을 3개씩 (원문/발음/번역) ----
function parseHandTxt(text) {
  const chunks = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const lines = [];
  for (let i = 0; i + 2 < chunks.length + 1 && chunks[i] != null; i += 3) {
    lines.push({ orig: chunks[i], pron: chunks[i + 1] || "", trans: chunks[i + 2] || "" });
  }
  return lines;
}

// ---- LRCLIB ----
async function getLrc() {
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(opts.title)}&artist_name=${encodeURIComponent(opts.artist)}`;
  const data = await (await fetch(url)).json();
  let synced = data.filter((x) => x.syncedLyrics);
  if (opts.lrcId) synced = synced.filter((x) => x.id === opts.lrcId);
  if (!synced.length) throw new Error("LRCLIB: synced 결과 없음");
  synced.sort((a, b) => (b.duration || 0) - (a.duration || 0)); // 가장 긴 = 풀버전
  const best = synced[0];
  const lines = [];
  for (const raw of best.syncedLyrics.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)$/);
    if (!m || !m[4].trim()) continue;
    lines.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +("0." + m[3]) : 0), orig: m[4].trim() });
  }
  return { best, lines };
}

const norm = (s) => s.replace(/[\s「」『』（）()、。，．・！？!?~〜\-ーｰ…♪]/g, "");

// ---- 정렬: 수작업 원문을 이어붙여 LRCLIB 줄에 맞추고 타임 보간 ----
function merge(hand, lrc) {
  const out = [];
  const mismatches = [];
  let hi = 0;
  for (let li = 0; li < lrc.length; li++) {
    const target = norm(lrc[li].orig);
    const tStart = lrc[li].t;
    const tEnd = li + 1 < lrc.length ? lrc[li + 1].t : tStart + 4;

    const group = [];
    let acc = "";
    while (hi < hand.length && acc.length < target.length) {
      group.push(hand[hi]); acc += norm(hand[hi].orig); hi++;
    }
    if (!group.length) { mismatches.push({ li, lrc: lrc[li].orig, got: "(빈 그룹)" }); continue; }
    if (acc !== target) mismatches.push({ li, lrc: lrc[li].orig, got: group.map((g) => g.orig).join(" / ") });

    // 그룹이 1개면 LRCLIB 원문을 그대로(표기 정확), 여러 개면 수작업 원문 유지(잘게 쪼갬)
    const totalLen = group.reduce((s, g) => s + Math.max(1, norm(g.orig).length), 0);
    let accLen = 0;
    for (let k = 0; k < group.length; k++) {
      const g = group[k];
      out.push({
        t: +(tStart + (tEnd - tStart) * (accLen / totalLen)).toFixed(2),
        orig: group.length === 1 ? lrc[li].orig : g.orig,
        pron: g.pron, pronSrc: g.pron ? "user" : undefined,
        trans: g.trans, transSrc: g.trans ? "user" : undefined,
      });
      accLen += Math.max(1, norm(g.orig).length);
    }
  }
  return { out, mismatches, leftover: hand.slice(hi) };
}

// ---- index.json 갱신 ----
function updateIndex(entry) {
  const idx = JSON.parse(fs.readFileSync(INDEX, "utf-8"));
  const i = idx.songs.findIndex((s) => s.bundleId === entry.bundleId);
  if (i >= 0) entry.version = (idx.songs[i].version || 1) + 1, idx.songs[i] = entry;
  else idx.songs.push(entry);
  idx.songs.sort((a, b) => (a.file > b.file ? 1 : -1));
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2) + "\n");
}

// ---- 실행 ----
const hand = parseHandTxt(fs.readFileSync(path.resolve(opts.txt), "utf-8"));
const { best, lines: lrc } = await getLrc();
const { out, mismatches, leftover } = merge(hand, lrc);

const num = String(opts.num).padStart(2, "0");
const bundleId = `vaundy-${opts.slug}`;
const file = `${num}_${opts.slug}.json`;
const song = {
  title: opts.title, artist: opts.artist, youtubeId: opts.youtube,
  bundleId, offset: 0, lines: out,
};

console.log(`\n=== ${opts.title} ===`);
console.log(`수작업 ${hand.length}줄 · LRCLIB ${lrc.length}줄 (id ${best.id}, ${Math.round(best.duration)}s) → 병합 ${out.length}줄`);
console.log(`매칭 어긋남 ${mismatches.length}건:`);
for (const m of mismatches) console.log(`  [LRC ${m.li}] "${m.lrc}"  ≠  "${m.got}"`);
if (leftover.length) console.log(`⚠ 남은 수작업 줄 ${leftover.length}:`, leftover.map((l) => l.orig));

if (opts.dry) { console.log("\n(--dry: 파일 안 씀)"); process.exit(0); }

fs.writeFileSync(path.join(SONGS_DIR, file), JSON.stringify(song, null, 2) + "\n");
updateIndex({ file, bundleId, version: 1, title: opts.title, artist: opts.artist });
console.log(`\n✓ songs/${file} 작성, index.json 갱신`);
