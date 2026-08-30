// 수작업/ 폴더의 "NN. 제목-Vaundy.txt" 들을 LRCLIB 타임과 병합 → songs/NN_slug.json
//   node merge-batch.mjs [--dry] [--only 21,22]

import fs from "fs";
import path from "path";

const HAND_DIR = path.resolve("../수작업");
const SONGS_DIR = path.resolve("../songs");
const INDEX = path.join(SONGS_DIR, "index.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const oi = args.indexOf("--only");
const ONLY = oi >= 0 ? new Set(args[oi + 1].split(",")) : null;

const META = {
  10: { yt: "bGQQfNgtlz8", slug: "fukakouryoku", title: "不可幸力" },
  11: { yt: "GXc9h3hXRUk", slug: "tokimeki", title: "Tokimeki" },
  12: { yt: "MecVtfGY4fk", slug: "soumatou", title: "走馬灯" },
  13: { yt: "WMMlqpcWBr8", slug: "yobigoe", title: "呼び声" },
  14: { yt: "ymHi_JaDEmQ", slug: "gift", title: "Gift" },
  15: { yt: "EaC8Dgtvrb0", slug: "sonna-bitter-na-hanashi", title: "そんなbitterな話" },
  16: { yt: "gtQwNVznphg", slug: "carnival", title: "カーニバル" },
  17: { yt: "YzgOC7dgBm4", slug: "life-hack", title: "life hack" },
  18: { yt: "amQZKaeEyv0", slug: "sekai-no-himitsu", title: "世界の秘密" },
  19: { yt: "1o1rKSsYaGY", slug: "hero", title: "HERO" },
  20: { yt: "Zt7ZXRxhoT4", slug: "replica", title: "replica" },
  21: { yt: "RhDxXvn6YaQ", slug: "gyakkou", title: "逆光" },
  22: { yt: "yedEqZW27bc", slug: "nakijizou", title: "泣き地蔵" },
  23: { yt: "iLnfe7uQuGw", slug: "okitegami", title: "置き手紙" },
  24: { yt: "rS2G7W8qeHs", slug: "boku-ni-wa-doushite", title: "僕にはどうしてわかるんだろう" },
  25: { yt: "zQAV6i_OJpM", slug: "bye-by-me", title: "Bye by me" },
  26: { yt: "uj1DkgXSR4w", slug: "hashire-sakamoto", title: "走れSAKAMOTO" },
  27: { yt: "JPZo1PJIArQ", slug: "iseijin", title: "偉生人" },
  28: { yt: "tqmvLCZkq5A", slug: "zenzenzense", title: "前前前世" },
  29: { yt: "XI0bOzohkX8", slug: "soramimi", title: "soramimi" },
  30: { yt: "wWnak7V8hr0", slug: "hadaka-no-yuusha", title: "裸の勇者" },
  31: { yt: "hurYJCgf-7Y", slug: "idea-ga-afurete", title: "イデアが溢れて眠れない" },
  32: { yt: "n13ULXp5--I", slug: "yuukai-sink", title: "融解sink" },
  33: { yt: "Xay0HJ4LsNc", slug: "shiawase", title: "しわあわせ" },
  34: { yt: "Xr0RRdBNNUg", slug: "zero", title: "ZERO" },
  35: { yt: "o7aOhAYyTTU", slug: "futaribanashi", title: "二人話" },
  36: { yt: "9tpGkTWUvTc", slug: "pained", title: "pained" },
  37: { yt: "Hy7GWPkrZv0", slug: "wasureru-mae-ni", title: "忘れる前に" },
  38: { yt: "uYyfD5A-w8Q", slug: "kimagure", title: "気まぐれ" },
  39: { yt: "fxtQ4Dsmqo0", slug: "jounetsu", title: "常熱" },
  40: { yt: "bS6RCQZoErg", slug: "bidenkyuu", title: "美電球" },
  41: { yt: "_vEM0ebafeU", slug: "kagerou", title: "かげろう" },
  42: { yt: "LVCwdZoUFQ8", slug: "tobu-toki", title: "飛ぶ時" },
  43: { yt: "eL3_n6vnPS4", slug: "hitomibore", title: "瞳惚れ" },
  44: { yt: "m1_Z_-2uAco", slug: "homunkurusu", title: "ホムンクルス" },
  45: { yt: "Ih2eEKTJXRg", slug: "time-paradox", title: "タイムパラドックス" },
  46: { yt: "IdQILQ6n1sk", slug: "fuujin", title: "風神" },
  47: { yt: "RFVHj-vmJIw", slug: "gorilla-shibai", title: "GORILLA芝居" },
  48: { yt: "QC6gd_b1nz8", slug: "neo-japan", title: "NEO JAPAN" },
  49: { yt: "stss6w2io68", slug: "singularity", title: "シンギュラリティ" },
  50: { yt: "CnlMTBwsBHs", slug: "odoriko", title: "踊り子" },
  51: { yt: "0ahTUQn7Oho", slug: "wasuremono", title: "忘れ物" },
};

const HAS_JP = (s) => /[぀-ヿ㐀-鿿]/.test(s || "");
const PUNCT_ONLY = /^[「」『』（）()\[\]{}、。・…‥"'`~〜\-–—。.,!?！？\s]+$/;

// 제로폭 문자·전각공백 제거
function clean(line) {
  return line.replace(/[​‌‍﻿]/g, "").replace(/　/g, " ").trim();
}
// 비교용 정규화: NFKC(전각→반각, １→1) 후 공백·구두점 제거
function norm(s) {
  return s.normalize("NFKC").replace(/[\s「」『』（）()、。，．・！？!?~〜\-–—ー…‥♪、,.]/g, "").toLowerCase();
}

function parseHand(text) {
  let c = text.split(/\r?\n/).map(clean).filter((l) => l !== "" && !PUNCT_ONLY.test(l));
  const jp = c.filter(HAS_JP).length;
  const ratio = jp / Math.max(1, c.length);
  // 3줄(원문/발음/번역): JP 비율 ~1/3.  2줄(원문/번역): ~1/2 또는 ~0(영어곡)
  const step = ratio >= 0.24 && ratio <= 0.42 ? 3 : 2;
  const lines = [];
  for (let i = 0; i < c.length; i += step) {
    if (c[i] == null) break;
    if (step === 3) lines.push({ orig: c[i], pron: c[i + 1] || "", trans: c[i + 2] || "" });
    else lines.push({ orig: c[i], pron: "", trans: c[i + 1] || "" });
  }
  return { lines, step, ratio: +ratio.toFixed(3) };
}

async function getLrc(title) {
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=Vaundy`;
  const data = await (await fetch(url)).json();
  const synced = data.filter((x) => x.syncedLyrics);
  if (!synced.length) return null;
  const jp = synced.filter((x) => HAS_JP(x.syncedLyrics));
  const pool = jp.length ? jp : synced;
  pool.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  const best = pool[0];
  const lines = [];
  for (const raw of best.syncedLyrics.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)$/);
    if (!m) continue;
    const t = m[4].split("^")[0].trim();
    if (!t) continue;
    lines.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +("0." + m[3]) : 0), orig: t });
  }
  return { best, lines, jp: jp.length > 0 };
}

// LRCLIB 의 추임새 줄 (성호님 파일엔 대개 없음): 스킵 대상
const FILLER = /^[\s(){}\[\]「」（）,.!?~ー-]*((na|la|da|oh|ah|wo?w|hu|hey|yeah|uh|mm|whoa|ooh|nan?a|lala|dada|ラ|ナ|ダ|ドゥ|ん)[\s,.\-~ー()！？]*)+[\s(){}\[\]「」（）,.!?~ー-]*$/i;

// 양방향 누적 정렬
function merge(hand, lrc) {
  const out = [];
  const mismatches = [];
  let hi = 0, li = 0;
  while (li < lrc.length && hi < hand.length) {
    // LRCLIB 추임새 줄인데 성호님 현재 줄과 안 맞으면 건너뜀
    if (FILLER.test(lrc[li].orig) && norm(lrc[li].orig) !== norm(hand[hi].orig)) { li++; continue; }
    const ug = [hand[hi++]];
    const lg = [lrc[li++]];
    let ua = norm(ug[0].orig), la = norm(lg[0].orig), guard = 0;
    while (ua !== la && guard++ < 60) {
      if (ua.length <= la.length && hi < hand.length) { ug.push(hand[hi]); ua += norm(hand[hi].orig); hi++; }
      else if (li < lrc.length && !FILLER.test(lrc[li].orig)) { lg.push(lrc[li]); la += norm(lrc[li].orig); li++; }
      else if (li < lrc.length && FILLER.test(lrc[li].orig)) { li++; }
      else break;
    }
    if (ua !== la) mismatches.push({ lrc: lg.map((x) => x.orig).join(" ").slice(0, 60), got: ug.map((x) => x.orig).join(" / ").slice(0, 70) });

    const tStart = lg[0].t;
    const tEnd = li < lrc.length ? lrc[li].t : tStart + 3 * ug.length;
    const totalLen = ug.reduce((s, g) => s + Math.max(1, norm(g.orig).length), 0);
    let accLen = 0;
    for (const g of ug) {
      out.push({
        t: +(tStart + (tEnd - tStart) * (accLen / totalLen)).toFixed(2),
        orig: ug.length === 1 && lg.length === 1 ? lg[0].orig : g.orig,
        pron: g.pron, pronSrc: g.pron ? "user" : undefined,
        trans: g.trans, transSrc: g.trans ? "user" : undefined,
      });
      accLen += Math.max(1, norm(g.orig).length);
    }
  }
  // 타임 단조 보정
  for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) out[i].t = out[i - 1].t;
  return { out, mismatches, leftover: hand.slice(hi) };
}

const files = fs.readdirSync(HAND_DIR).filter((f) => /^\d+\.\s/.test(f) && f.endsWith(".txt")).sort();
const idx = JSON.parse(fs.readFileSync(INDEX, "utf-8"));
const rep = [];

for (const f of files) {
  const num = f.match(/^(\d+)\./)[1];
  if (ONLY && !ONLY.has(num)) continue;
  const meta = META[+num];
  if (!meta) { rep.push(`${num} ${f}  ⚠ META 없음`); continue; }

  const { lines: hand, step, ratio } = parseHand(fs.readFileSync(path.join(HAND_DIR, f), "utf-8"));
  const lrc = await getLrc(meta.title);
  if (!lrc) { rep.push(`${num} ${meta.title}  ⚠ LRCLIB 싱크 가사 없음`); continue; }
  await new Promise((r) => setTimeout(r, 350));

  const { out, mismatches, leftover } = merge(hand, lrc.lines);
  // orig 에 한글이 섞였으면 정렬이 깨진 것 (번역 줄을 원문으로 먹음)
  const corrupt = out.filter((l) => /[가-힣]/.test(l.orig)).length;
  const num2 = num.padStart(2, "0");
  const file = `${num2}_${meta.slug}.json`;
  const bundleId = `vaundy-${meta.slug}`;
  const song = { title: meta.title, artist: "Vaundy", youtubeId: meta.yt, bundleId, offset: 0, lines: out };

  const bad = mismatches.length + leftover.length + corrupt;
  const skip = corrupt > 0 || leftover.length > 5;
  let line = `${num} ${meta.title}  ${step}줄(jp ${ratio}) 수작업 ${hand.length}·LRC ${lrc.lines.length}${lrc.jp ? "" : "⚠로마자"}→${out.length}줄  ` +
    (bad === 0 ? "✓ 깨끗" : `${skip ? "✗ 스킵 " : "△ "}불일치 ${mismatches.length}, 남은줄 ${leftover.length}, 원문에한글 ${corrupt}`);
  if (bad) {
    for (const m of mismatches.slice(0, 4)) line += `\n     ≠ LRC「${m.lrc}」  수작업「${m.got}」`;
    if (mismatches.length > 4) line += `\n     … 외 ${mismatches.length - 4}`;
    if (leftover.length) line += `\n     남은: ${leftover.map((l) => l.orig).slice(0, 3).join(" / ")}`;
  }
  rep.push(line);

  if (!DRY && !skip) {
    fs.writeFileSync(path.join(SONGS_DIR, file), JSON.stringify(song, null, 2) + "\n");
    const ei = idx.songs.findIndex((s) => s.bundleId === bundleId);
    const entry = { file, bundleId, version: 1, title: meta.title, artist: "Vaundy" };
    if (ei >= 0) { entry.version = (idx.songs[ei].version || 1) + 1; idx.songs[ei] = entry; }
    else idx.songs.push(entry);
  }
}
if (!DRY) {
  idx.songs.sort((a, b) => (a.file > b.file ? 1 : -1));
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2) + "\n");
}
console.log(rep.join("\n\n"));
