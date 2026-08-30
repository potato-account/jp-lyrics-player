// 발음·번역 자동 채우기 (초안 품질).
// - 발음: kuromoji(일본어 사전, 최초 1회 ~17MB 다운로드 후 캐시) + kana2ko
// - 번역: MyMemory 무료 API (키 불필요, 인터넷 필요, 일 사용량 제한)
//
// 우선순위 규칙: 각 줄의 pronSrc / transSrc 가
//   "user" (내가 직접) > "hand" (Claude 손 품질) > "draft" (자동) > 없음(빈 값)
// 자동 채우기는 "user"/"hand" 인 칸은 절대 건드리지 않고, 빈 칸이나 "draft" 만 채운다.

import { pronForLine } from "./kana2ko.js";

let _tokenizerPromise = null;

// kuromoji.js(UMD)를 script 태그로 주입 → window.kuromoji
function loadKuromojiScript() {
  return new Promise((resolve, reject) => {
    if (window.kuromoji) return resolve();
    const s = document.createElement("script");
    s.src = "vendor/kuromoji.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("kuromoji.js 로드 실패"));
    document.head.appendChild(s);
  });
}

async function getTokenizer() {
  if (_tokenizerPromise) return _tokenizerPromise;
  _tokenizerPromise = (async () => {
    await loadKuromojiScript();
    return new Promise((resolve, reject) => {
      window.kuromoji.builder({ dicPath: "vendor/dict/" }).build((err, tok) => {
        if (err) reject(err);
        else resolve(tok);
      });
    });
  })();
  return _tokenizerPromise;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HAS_JP = /[぀-ヿ㐀-鿿]/;

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

async function translateMyMemory(q) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=ja|ko`;
  const res = await fetch(url);
  const j = await res.json();
  if (String(j.responseStatus) !== "200") throw new Error("mymemory " + j.responseStatus);
  let txt = (j.responseData && j.responseData.translatedText) || "";
  if (!txt || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(txt)) throw new Error("mymemory: " + txt);
  return decodeEntities(txt).trim();
}

const LOCKED = new Set(["user", "hand"]);

// song 의 lines 를 자동 채운다. onProgress(done, total, phase) 로 진행 상황 보고.
// 반환: { pron, trans, failed } 채운 개수.
export async function autofillSong(song, { onProgress = () => {}, doPron = true, doTrans = true } = {}) {
  const lines = song.lines;
  let pron = 0, trans = 0, failed = 0;

  // ---- 발음 ----
  if (doPron) {
    onProgress(0, lines.length, "사전 불러오는 중…");
    const tok = await getTokenizer();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!LOCKED.has(l.pronSrc) && HAS_JP.test(l.orig || "")) {
        try {
          const p = pronForLine(tok, l.orig);
          if (p) { l.pron = p; l.pronSrc = "draft"; pron++; }
        } catch { failed++; }
      }
      if (i % 5 === 0) onProgress(i, lines.length, "발음 변환 중…");
    }
  }

  // ---- 번역 (중복 문장은 캐시) ----
  if (doTrans) {
    const cache = new Map();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      onProgress(i, lines.length, "번역 중…");
      if (LOCKED.has(l.transSrc)) continue;
      const q = (l.orig || "").trim();
      if (!q || !HAS_JP.test(q)) continue;
      if (cache.has(q)) { l.trans = cache.get(q); l.transSrc = "draft"; trans++; continue; }
      try {
        const t = await translateMyMemory(q);
        cache.set(q, t);
        l.trans = t; l.transSrc = "draft"; trans++;
        await sleep(400); // 예의상 간격
      } catch {
        failed++;
        await sleep(400);
      }
    }
  }

  onProgress(lines.length, lines.length, "완료");
  return { pron, trans, failed };
}

// 이 곡에 자동 채우기로 채울 게 남았는지 (배너 표시 판단용)
export function hasFillable(song) {
  if (!song) return false;
  return song.lines.some((l) => {
    const jp = /[぀-ヿ㐀-鿿]/.test(l.orig || "");
    const pronOpen = !LOCKED.has(l.pronSrc) && !l.pron && jp;
    const transOpen = !LOCKED.has(l.transSrc) && !l.trans && jp;
    return pronOpen || transOpen;
  });
}
