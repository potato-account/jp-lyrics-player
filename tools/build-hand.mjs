// Claude 손 작업용 빌더.
//   .lrc (LRCLIB syncedLyrics 원본) + .tsv (줄마다 "발음\t번역") → songs/NN_slug.json
// .lrc 의 빈-텍스트 타임라인은 건너뛴다. .tsv 줄 수는 .lrc 실제 가사 줄 수와 같아야 한다.
//
//   node build-hand.mjs --lrc ../../<scratch>/lrc/01_hanauranai.lrc \
//     --tsv ../../<scratch>/hand/01_hanauranai.tsv \
//     --title "花占い" --youtube 3UbBjzFDkd4 --num 1 --slug hanauranai

import fs from "fs";
import path from "path";

const a = process.argv.slice(2);
const o = { artist: "Vaundy" };
for (let i = 0; i < a.length; i++) {
  const k = a[i];
  if (k === "--lrc") o.lrc = a[++i];
  else if (k === "--tsv") o.tsv = a[++i];
  else if (k === "--title") o.title = a[++i];
  else if (k === "--artist") o.artist = a[++i];
  else if (k === "--youtube") o.youtube = a[++i];
  else if (k === "--num") o.num = a[++i];
  else if (k === "--slug") o.slug = a[++i];
  else if (k === "--dry") o.dry = true;
}
for (const k of ["lrc", "tsv", "title", "youtube", "num", "slug"])
  if (!o[k]) { console.error("missing --" + k); process.exit(2); }

const lrcLines = [];
for (const raw of fs.readFileSync(path.resolve(o.lrc), "utf-8").split(/\r?\n/)) {
  const m = raw.match(/^\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)$/);
  if (!m) continue;
  // 일부 LRCLIB 항목은 "원문^영어번역" 형태 → ^ 뒤 잘라냄
  const text = m[4].split("^")[0].trim();
  if (!text) continue; // 빈 타임라인 스킵
  lrcLines.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +("0." + m[3]) : 0), orig: text });
}

const tsv = fs.readFileSync(path.resolve(o.tsv), "utf-8").split(/\r?\n/).filter((l) => l.length);
if (tsv.length !== lrcLines.length) {
  console.error(`줄 수 불일치: lrc ${lrcLines.length} vs tsv ${tsv.length}`);
  lrcLines.forEach((l, i) => console.error(`  ${String(i).padStart(3)}  ${l.orig}   ||   ${tsv[i] || "(없음)"}`));
  process.exit(1);
}

const lines = lrcLines.map((l, i) => {
  const [pron = "", trans = ""] = tsv[i].split("\t");
  return { t: l.t, orig: l.orig, pron: pron.trim(), trans: trans.trim() };
});

const num = String(o.num).padStart(2, "0");
const file = `${num}_${o.slug}.json`;
const bundleId = `vaundy-${o.slug}`;
const song = { title: o.title, artist: o.artist, youtubeId: o.youtube, bundleId, offset: 0, lines };

console.log(`${o.title}: ${lines.length}줄`);
console.log("첫 3줄:");
lines.slice(0, 3).forEach((l) => console.log(`  ${l.t}s  ${l.orig} | ${l.pron} | ${l.trans}`));
if (o.dry) process.exit(0);

const SONGS = path.resolve("../songs");
fs.writeFileSync(path.join(SONGS, file), JSON.stringify(song, null, 2) + "\n");

const idxPath = path.join(SONGS, "index.json");
const idx = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
const ei = idx.songs.findIndex((s) => s.bundleId === bundleId);
const entry = { file, bundleId, version: 1, title: o.title, artist: o.artist };
if (ei >= 0) { entry.version = (idx.songs[ei].version || 1) + 1; idx.songs[ei] = entry; }
else idx.songs.push(entry);
idx.songs.sort((x, y) => (x.file > y.file ? 1 : -1));
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n");
console.log(`✓ songs/${file} + index.json`);
