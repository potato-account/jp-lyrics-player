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

// 정렬이 깨지는 곡: 성호님 파일 구조 그대로 + 타임은 글자수 비례로 대충 배분.
// (성호님이 노래 들으며 편집/탭싱크로 고칠 예정)
const LOOSE = new Set(["11", "14", "19", "20", "26", "29", "32", "34", "35", "44", "48"]);

const META = {
  1: { yt: "onhBN0qkUcE", slug: "hanauranai", title: "花占い" },
  2: { yt: "1FIhcdocT-k", slug: "koikaze-ni-nosete", title: "恋風邪にのせて" },
  3: { yt: "ZeIGVnkYX04", slug: "napori", title: "napori" },
  4: { yt: "6h6AQbdTkaE", slug: "mabataki", title: "mabataki" },
  5: { yt: "iVB3nxzoLXI", slug: "missing", title: "Missing" },
  6: { yt: "ClPuCDDYKaI", slug: "tomoshibi", title: "灯火" },
  7: { yt: "FL1QjjkZVm4", slug: "chainsaw-blood", title: "CHAINSAW BLOOD" },
  8: { yt: "SIuF37EWaLU", slug: "tokyo-flash", title: "東京フラッシュ" },
  9: { yt: "UM9XNpgrqVk", slug: "kaijuu-no-hanauta", title: "怪獣の花唄" },
  10: { yt: "Gbz2C2gQREI", slug: "fukakouryoku", title: "不可幸力" },
  11: { yt: "-_PKhPMXMDY", slug: "tokimeki", title: "Tokimeki" },
  12: { yt: "3Dy4EbMPkY0", slug: "soumatou", title: "走馬灯" },
  13: { yt: "CI2x2aSi8aI", slug: "yobigoe", title: "呼び声" },
  14: { yt: "sADskV54iNc", slug: "gift", title: "Gift" },
  15: { yt: "V-gxqhWEbxI", slug: "sonna-bitter-na-hanashi", title: "そんなbitterな話" },
  16: { yt: "WEINueQJxbE", slug: "carnival", title: "カーニバル" },
  17: { yt: "Tzyt91TYjLA", slug: "life-hack", title: "life hack" },
  18: { yt: "xFoTFCHU70s", slug: "sekai-no-himitsu", title: "世界の秘密" },
  19: { yt: "hfwfAxkK_YU", slug: "hero", title: "HERO" },
  20: { yt: "Uv67h_E7xsM", slug: "replica", title: "replica" },
  21: { yt: "RhDxXvn6YaQ", slug: "gyakkou", title: "逆光" },
  22: { yt: "XQTM2M5iD_I", slug: "nakijizou", title: "泣き地蔵" },
  23: { yt: "B50A9Nf5FCE", slug: "okitegami", title: "置き手紙" },
  24: { yt: "x4aWXNWPrtY", slug: "boku-ni-wa-doushite", title: "僕にはどうしてわかるんだろう" },
  25: { yt: "b3H5RvRHiYs", slug: "bye-by-me", title: "Bye by me" },
  26: { yt: "jbgG5tzgP9k", slug: "hashire-sakamoto", title: "走れSAKAMOTO" },
  27: { yt: "aDaWuvpB_Kw", slug: "iseijin", title: "偉生人" },
  28: { yt: "tqmvLCZkq5A", slug: "zenzenzense", title: "前前前世" },
  29: { yt: "Jh_0EW6G3gQ", slug: "soramimi", title: "soramimi" },
  30: { yt: "FT0GKCuSaW0", slug: "hadaka-no-yuusha", title: "裸の勇者" },
  31: { yt: "0u_zA8BJG6A", slug: "idea-ga-afurete", title: "イデアが溢れて眠れない" },
  32: { yt: "B383PElQMHo", slug: "yuukai-sink", title: "融解sink" },
  33: { yt: "JwmGruvGt_I", slug: "shiawase", title: "しわあわせ" },
  34: { yt: "Fs7MW0rx9Cw", slug: "zero", title: "ZERO" },
  35: { yt: "o7aOhAYyTTU", slug: "futaribanashi", title: "二人話" },
  36: { yt: "beIC4qyuCo8", slug: "pained", title: "pained" },
  37: { yt: "Hy7GWPkrZv0", slug: "wasureru-mae-ni", title: "忘れる前に" },
  38: { yt: "uYyfD5A-w8Q", slug: "kimagure", title: "気まぐれ" },
  39: { yt: "fxtQ4Dsmqo0", slug: "jounetsu", title: "常熱" },
  40: { yt: "bS6RCQZoErg", slug: "bidenkyuu", title: "美電球" },
  41: { yt: "gY-7i-T76o0", slug: "kagerou", title: "かげろう" },
  42: { yt: "ARj1adoUoEU", slug: "tobu-toki", title: "飛ぶ時" },
  43: { yt: "XEEXE8Ei5SA", slug: "hitomibore", title: "瞳惚れ" },
  44: { yt: "ZhUa0CumyxQ", slug: "homunkurusu", title: "ホムンクルス" },
  45: { yt: "ewhRE-BvJCg", slug: "time-paradox", title: "タイムパラドックス" },
  46: { yt: "yiU0I0tvt6s", slug: "fuujin", title: "風神" },
  47: { yt: "QTYjA7QV7tY", slug: "gorilla-shibai", title: "GORILLA芝居" },
  48: { yt: "QC6gd_b1nz8", slug: "neo-japan", title: "NEO JAPAN" },
  49: { yt: "stss6w2io68", slug: "singularity", title: "シンギュラリティ" },
  50: { yt: "7HgJIAUtICU", slug: "odoriko", title: "踊り子" },
  51: { yt: "tQq8C7irREk", slug: "wasuremono", title: "忘れ物" },
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

const JUNK = /^(\[출처\]|출처\s*[:：]|https?:\/\/|작성자|blog\.|tistory)/i;
const HAS_KR = (s) => /[가-힣]/.test(s || "");

// 조각(cell) 단위로 읽고, "원문으로 보이는 조각"이 나올 때마다 새 블록 시작.
//  - 원문 조각 = 한글이 아님 (일본어거나 영어). 한글 조각은 앞 블록의 발음/번역으로 붙음.
//  - 블록당 최대 3조각: 원문 / 발음 / 번역. 한글 조각이 1개뿐이면 번역으로 취급.
function parseHand(text) {
  const cells = text
    .replace(/[​‌‍﻿]/g, "").split(/\r?\n/)
    .map((l) => l.replace(/　/g, " ").trim())
    .filter((l) => l !== "" && !PUNCT_ONLY.test(l) && !JUNK.test(l));

  const blocks = [];
  for (const cell of cells) {
    if (!HAS_KR(cell) || blocks.length === 0) blocks.push([cell]);       // 원문(비한글) → 새 블록
    else blocks[blocks.length - 1].push(cell);                           // 한글 → 현재 블록 (발음/번역, 넘치면 번역에 합침)
  }
  const lines = blocks.map((b) => {
    if (b.length === 1) return { orig: b[0], pron: "", trans: "" };
    if (b.length === 2) return { orig: b[0], pron: "", trans: b[1] };
    return { orig: b[0], pron: b[1], trans: b.slice(2).join(" ") };
  });
  const jp = lines.filter((l) => HAS_JP(l.orig)).length;
  return { lines, step: 0, ratio: +(jp / Math.max(1, lines.length)).toFixed(3) };
}

// 유튜브 영상 길이 (id -> 초). LRCLIB 여러 항목 중 이 길이에 가장 가까운 걸 고른다.
const YTDUR = new Map(
  fs.readFileSync(path.resolve("./yt-durations.txt"), "utf-8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const [id, d] = l.split("|"); return [id, +d]; })
);

async function getLrc(title, ytDur) {
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=Vaundy`;
  const data = await (await fetch(url)).json();
  const synced = data.filter((x) => x.syncedLyrics);
  if (!synced.length) return null;
  const jp = synced.filter((x) => HAS_JP(x.syncedLyrics));
  const pool = jp.length ? jp : synced;
  // 유튜브 길이에 가장 가까운 항목. 없으면 가장 긴 것.
  if (ytDur) pool.sort((a, b) => Math.abs((a.duration || 0) - ytDur) - Math.abs((b.duration || 0) - ytDur));
  else pool.sort((a, b) => (b.duration || 0) - (a.duration || 0));
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
  const lrc = await getLrc(meta.title, YTDUR.get(meta.yt));
  await new Promise((r) => setTimeout(r, 350));

  // LRCLIB 싱크 가사 없음 → 원문/발음/번역만 넣고 타임은 영상 길이에 균등 배분(임시).
  // 앱 편집모드에서 줄마다 '찍기' 로 맞추면 됨.
  if (!lrc) {
    const yt = YTDUR.get(meta.yt) || 220;
    const t0 = 6, t1 = Math.max(t0 + 10, yt - 12);
    const total = hand.reduce((s, g) => s + Math.max(1, norm(g.orig).length), 0);
    let acc = 0;
    const out = hand.map((g) => {
      const t = +(t0 + (t1 - t0) * (acc / Math.max(1, total))).toFixed(2);
      acc += Math.max(1, norm(g.orig).length);
      return { t, orig: g.orig, pron: g.pron, pronSrc: g.pron ? "user" : undefined, trans: g.trans, transSrc: g.trans ? "user" : undefined };
    });
    const num2 = num.padStart(2, "0");
    const file = `${num2}_${meta.slug}.json`;
    const bundleId = `vaundy-${meta.slug}`;
    rep.push(`${num} ${meta.title}  ⚠ LRCLIB 없음 → 타임 임시배분 ${out.length}줄 (탭싱크 필요)`);
    if (!DRY) {
      fs.writeFileSync(path.join(SONGS_DIR, file), JSON.stringify({ title: meta.title, artist: "Vaundy", youtubeId: meta.yt, bundleId, offset: 0, approxTiming: true, needsTapSync: true, lines: out }, null, 2) + "\n");
      const ei = idx.songs.findIndex((s) => s.bundleId === bundleId);
      const entry = { file, bundleId, version: 1, title: meta.title, artist: "Vaundy" };
      if (ei >= 0) { entry.version = (idx.songs[ei].version || 1) + 1; idx.songs[ei] = entry; } else idx.songs.push(entry);
    }
    continue;
  }

  let { out, mismatches, leftover } = merge(hand, lrc.lines);
  let corrupt = out.filter((l) => /[가-힣]/.test(l.orig)).length;
  let loose = false;

  // 정렬 실패 + LOOSE 지정곡 → 파일 구조 그대로, 타임 대충 배분
  if ((corrupt > 0 || leftover.length > 5) && LOOSE.has(num)) {
    const t0 = lrc.lines[0].t, t1 = lrc.lines[lrc.lines.length - 1].t;
    const total = hand.reduce((s, g) => s + Math.max(1, norm(g.orig).length), 0);
    let acc = 0;
    out = hand.map((g) => {
      const t = +(t0 + (t1 - t0) * (acc / Math.max(1, total))).toFixed(2);
      acc += Math.max(1, norm(g.orig).length);
      return { t, orig: g.orig, pron: g.pron, pronSrc: g.pron ? "user" : undefined, trans: g.trans, transSrc: g.trans ? "user" : undefined };
    });
    corrupt = 0; mismatches = []; leftover = [];
    loose = true;
  }
  const num2 = num.padStart(2, "0");
  const file = `${num2}_${meta.slug}.json`;
  const bundleId = `vaundy-${meta.slug}`;

  const bad = mismatches.length + leftover.length + corrupt;
  const skip = (corrupt > 0 || leftover.length > 5) && !loose;
  const song = { title: meta.title, artist: "Vaundy", youtubeId: meta.yt, bundleId, offset: 0, lines: out };
  if (loose) song.approxTiming = true;
  let line = `${num} ${meta.title}  ${step}줄(jp ${ratio}) 수작업 ${hand.length}·LRC ${lrc.lines.length}${lrc.jp ? "" : "⚠로마자"}→${out.length}줄  ` +
    (loose ? "◆ LOOSE(타임 근사)" : bad === 0 ? "✓ 깨끗" : `${skip ? "✗ 스킵 " : "△ "}불일치 ${mismatches.length}, 남은줄 ${leftover.length}, 원문에한글 ${corrupt}`);
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
