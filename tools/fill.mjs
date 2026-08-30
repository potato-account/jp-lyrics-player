#!/usr/bin/env node
/*
 * fill.mjs - Fill missing `pron` / `trans` fields in jp-lyrics-player song JSON files.
 *
 *   node fill.mjs <file-or-folder> [--out <file>] [--dry] [--pron-only] [--trans-only]
 *                 [--force] [--engine mymemory|deepl|google]
 *
 * pron  : Japanese (kanji+kana) -> Korean hangul reading.
 *         kuromoji tokenizes the line and gives a katakana `pronunciation`
 *         per token; a hand-written katakana->hangul table turns that into
 *         an approximate Korean reading.
 * trans : Japanese -> Korean translation via a web API (default: MyMemory,
 *         no API key needed).
 *
 * Safety: an existing non-empty pron/trans string is never overwritten
 *         unless --force is given. t / orig / title / artist / youtubeId /
 *         offset / line order are never touched. A `.bak` copy is written
 *         before any in-place overwrite.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage:
  node fill.mjs <file-or-folder> [options]

Options:
  --out <file>        Write result to <file> instead of editing in place.
                     (ignored for folder input)
  --dry              Print planned changes, write nothing.
  --pron-only        Only fill pron.
  --trans-only       Only fill trans.
  --force           Also overwrite pron/trans that already have a value.
  --engine <name>    Translation engine: mymemory (default), deepl, google.
                     deepl needs env DEEPL_API_KEY.
  -h, --help        Show this help.

Examples:
  node fill.mjs ../songs/napori.json
  node fill.mjs ../songs --pron-only
  node fill.mjs ../songs/napori.json --dry
  node fill.mjs ../songs/napori.json --out ./napori.filled.json --engine google
  DEEPL_API_KEY=xxxx node fill.mjs ../songs/napori.json --engine deepl`);
}

function parseArgs(argv) {
  const opts = { engine: 'mymemory' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--engine') opts.engine = argv[++i];
    else if (a === '--dry') opts.dry = true;
    else if (a === '--pron-only') opts.pronOnly = true;
    else if (a === '--trans-only') opts.transOnly = true;
    else if (a === '--force') opts.force = true;
    else if (a === '-h' || a === '--help') { opts.help = true; }
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  opts.input = positional[0];
  return opts;
}

// ---------------------------------------------------------------------------
// Katakana -> Korean hangul
// ---------------------------------------------------------------------------

// Base + youon + common foreign-sound katakana morae -> hangul.
// Accuracy target: "what a Korean listener would read to approximate the
// Japanese", not strict linguistics.
const KANA = {
  // vowels
  'ア': '아', 'イ': '이', 'ウ': '우', 'エ': '에', 'オ': '오',
  // k / g
  'カ': '카', 'キ': '키', 'ク': '쿠', 'ケ': '케', 'コ': '코',
  'ガ': '가', 'ギ': '기', 'グ': '구', 'ゲ': '게', 'ゴ': '고',
  // s / z
  'サ': '사', 'シ': '시', 'ス': '스', 'セ': '세', 'ソ': '소',
  'ザ': '자', 'ジ': '지', 'ズ': '즈', 'ゼ': '제', 'ゾ': '조',
  // t / d
  'タ': '타', 'チ': '치', 'ツ': '츠', 'テ': '테', 'ト': '토',
  'ダ': '다', 'ヂ': '지', 'ヅ': '즈', 'デ': '데', 'ド': '도',
  // n
  'ナ': '나', 'ニ': '니', 'ヌ': '누', 'ネ': '네', 'ノ': '노',
  // h / b / p
  'ハ': '하', 'ヒ': '히', 'フ': '후', 'ヘ': '헤', 'ホ': '호',
  'バ': '바', 'ビ': '비', 'ブ': '부', 'ベ': '베', 'ボ': '보',
  'パ': '파', 'ピ': '피', 'プ': '푸', 'ペ': '페', 'ポ': '포',
  // m
  'マ': '마', 'ミ': '미', 'ム': '무', 'メ': '메', 'モ': '모',
  // y
  'ヤ': '야', 'ユ': '유', 'ヨ': '요',
  // r
  'ラ': '라', 'リ': '리', 'ル': '루', 'レ': '레', 'ロ': '로',
  // w + wo/wi/we + vu
  'ワ': '와', 'ヲ': '오', 'ヰ': '이', 'ヱ': '에', 'ヴ': '부',
  // standalone small kana (fallback when not part of a digraph)
  'ァ': '아', 'ィ': '이', 'ゥ': '우', 'ェ': '에', 'ォ': '오',
  'ャ': '야', 'ュ': '유', 'ョ': '요', 'ヮ': '와',

  // youon (palatalized)
  'キャ': '캬', 'キュ': '큐', 'キョ': '쿄',
  'ギャ': '갸', 'ギュ': '규', 'ギョ': '교',
  'シャ': '샤', 'シュ': '슈', 'ショ': '쇼',
  'ジャ': '쟈', 'ジュ': '쥬', 'ジョ': '죠',
  'チャ': '차', 'チュ': '추', 'チョ': '초',
  'ヂャ': '쟈', 'ヂュ': '쥬', 'ヂョ': '죠',
  'ニャ': '냐', 'ニュ': '뉴', 'ニョ': '뇨',
  'ヒャ': '햐', 'ヒュ': '휴', 'ヒョ': '효',
  'ビャ': '뱌', 'ビュ': '뷰', 'ビョ': '뵤',
  'ピャ': '퍄', 'ピュ': '퓨', 'ピョ': '표',
  'ミャ': '먀', 'ミュ': '뮤', 'ミョ': '묘',
  'リャ': '랴', 'リュ': '류', 'リョ': '료',

  // foreign-sound combos
  'シェ': '셰', 'ジェ': '제', 'チェ': '체', 'ティ': '티', 'ディ': '디',
  'トゥ': '투', 'ドゥ': '두', 'テュ': '튜', 'デュ': '듀',
  'ファ': '파', 'フィ': '피', 'フェ': '페', 'フォ': '포', 'フュ': '퓨',
  'ウィ': '위', 'ウェ': '웨', 'ウォ': '워',
  'ヴァ': '바', 'ヴィ': '비', 'ヴェ': '베', 'ヴォ': '보', 'ヴュ': '뷰',
  'ツァ': '차', 'ツィ': '치', 'ツェ': '체', 'ツォ': '초',
  'イェ': '예', 'クァ': '콰', 'グァ': '과',
};

// small kana that can form a digraph with the preceding mora
const SMALL = new Set(['ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ']);

// jongseong (final consonant) jamo -> offset added to a hangul syllable code
const JONG = { 'ㄴ': 4, 'ㅁ': 16, 'ㅅ': 19, 'ㅇ': 21 };

function hiraToKata(s) {
  // shift hiragana block (U+3041..U+3096) up to katakana
  return s.replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// Add a final consonant to the last hangul syllable already emitted.
// Returns true on success.
function addJong(arr, jamo) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const el = arr[i];
    if (el.length !== 1) continue;
    const code = el.codePointAt(0);
    if (code < 0xac00 || code > 0xd7a3) {
      // skip trailing markers like "-"; but stop if it's a real letter/space
      if (el === '-') continue;
      return false;
    }
    if ((code - 0xac00) % 28 !== 0) return false; // already has a final
    arr[i] = String.fromCodePoint(code + JONG[jamo]);
    return true;
  }
  return false;
}

// Decide which final the moraic nasal ン becomes, from the *next* kana char.
function nasalJamo(nextChar) {
  if (!nextChar) return 'ㄴ';
  if ('カキクケコガギグゲゴ'.includes(nextChar)) return 'ㅇ'; // before k/g
  if ('マミムメモバビブベボパピプペポ'.includes(nextChar)) return 'ㅁ'; // before m/p/b
  return 'ㄴ';
}

// Convert one katakana/hiragana string to an approximate hangul reading.
function kanaToHangul(input) {
  const kana = hiraToKata(input);
  const chars = [...kana];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const c2 = chars[i + 1];

    if (c2 && SMALL.has(c2) && KANA[c + c2]) { out.push(KANA[c + c2]); i++; continue; }

    if (c === 'ッ' || c === 'ｯ') { // sokuon -> ㅅ batchim on previous syllable
      addJong(out, 'ㅅ');
      continue;
    }
    if (c === 'ン' || c === 'ﾝ') { // moraic nasal
      const jamo = nasalJamo(chars[i + 1]);
      if (!addJong(out, jamo)) {
        out.push(jamo === 'ㅇ' ? 'ㅇ' : jamo === 'ㅁ' ? 'ㅁ' : 'ㄴ');
      }
      continue;
    }
    if (c === 'ー' || c === 'ｰ' || c === '−' || c === '—') { out.push('-'); continue; }

    if (KANA[c]) { out.push(KANA[c]); continue; }

    // Unknown (leftover kanji, latin, punctuation) -> keep verbatim.
    out.push(c);
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// pron: whole-line Japanese -> hangul, using kuromoji tokens
// ---------------------------------------------------------------------------

let TOKENIZER = null;

function buildTokenizer() {
  const kuromoji = require('kuromoji');
  const dicPath = path.join(path.dirname(require.resolve('kuromoji')), '..', 'dict');
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

const ASCII_ONLY = /^[\x00-\x7F]+$/;
const HAS_ALNUM = /[A-Za-z0-9]/;

// glue = no space before this token part
function tokenToPart(tok, prev) {
  const surface = tok.surface_form;

  // whitespace token -> a literal single space, glued
  if (tok.pos === '記号' && /^\s+$/.test(surface)) {
    return { text: ' ', glue: true, space: true };
  }
  // other punctuation
  if (ASCII_ONLY.test(surface) && !HAS_ALNUM.test(surface)) {
    return { text: surface, glue: true };
  }
  if (surface === '、' || surface === '，') return { text: ', ', glue: true };
  if (surface === '。' || surface === '．') return { text: '', glue: true };
  if (surface === '・' || surface === '　') return { text: ' ', glue: true, space: true };
  if ('！？「」『』（）〜'.includes(surface)) return { text: surface, glue: true };

  // Latin / ASCII word: keep as-is in pron
  const reading = tok.pronunciation && tok.pronunciation !== '*'
    ? tok.pronunciation
    : (tok.reading && tok.reading !== '*' ? tok.reading : null);

  if (!reading && ASCII_ONLY.test(surface)) {
    const glue = !!(prev && prev.space);
    return { text: surface, glue };
  }

  const text = kanaToHangul(reading || surface);

  // glue rules: attach grammatical bits to the preceding chunk
  let glue = false;
  if (prev) {
    if (prev.space) glue = true;
    else if (tok.pos === '助詞' || tok.pos === '助動詞') glue = true;
    else if (tok.pos_detail_1 === '接尾') glue = true;
    else if (tok.pos_detail_1 === '非自立') glue = true;
    else if (tok.pos === '記号') glue = true;
    else if (prev.sahen) glue = true; // noun + する/した/して ...
  }

  return { text, glue, sahen: tok.pos_detail_1 === 'サ変接続' };
}

// Attach a stray leading nasal/sokuon jamo (produced when ん / っ was its own
// kuromoji token, so it had no previous syllable inside that token) to the
// hangul syllable that now precedes it in the joined line.
const STRAY_JONG = { 'ㄴ': 4, 'ㅁ': 16, 'ㅇ': 21, 'ㅅ': 19 };
function mergeStrayJamo(s) {
  return s.replace(/([가-힣])\s*([ㄴㅁㅇㅅ])/g, (m, syl, jamo) => {
    const code = syl.codePointAt(0);
    if ((code - 0xac00) % 28 !== 0) return m; // already has a final -> leave
    return String.fromCodePoint(code + STRAY_JONG[jamo]);
  });
}

function pronForLine(orig) {
  const src = (orig || '').trim();
  if (!src) return '';
  // Pure ASCII line (e.g. "Oh right, oh right") -> leave untouched.
  if (ASCII_ONLY.test(src)) return src;

  const tokens = TOKENIZER.tokenize(src);
  const parts = [];
  let prev = null;
  for (const tok of tokens) {
    const p = tokenToPart(tok, prev);
    parts.push(p);
    prev = p;
  }

  let s = '';
  for (const p of parts) {
    if (s === '' || p.glue) s += p.text;
    else s += ' ' + p.text;
  }
  return mergeStrayJamo(s.replace(/\s{2,}/g, ' ').trim());
}

// ---------------------------------------------------------------------------
// trans: Japanese -> Korean via web API
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NET_DELAY_MS = 400;

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function translateMyMemory(q) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=ja|ko`;
  const res = await fetch(url);
  const j = await res.json();
  if (String(j.responseStatus) !== '200') {
    throw new Error(`mymemory status ${j.responseStatus}: ${j.responseDetails || ''}`);
  }
  let txt = (j.responseData && j.responseData.translatedText) || '';
  if (!txt || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|IS AN INVALID/i.test(txt)) {
    throw new Error(`mymemory: ${txt || 'empty'}`);
  }
  return decodeEntities(txt).trim();
}

async function translateGoogle(q) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ko&dt=t&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`google http ${res.status}`);
  const j = await res.json();
  const txt = (j[0] || []).map((seg) => seg[0]).join('');
  if (!txt) throw new Error('google: empty');
  return txt.trim();
}

async function translateDeepL(q) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('DEEPL_API_KEY is not set');
  const body = new URLSearchParams({
    auth_key: key, text: q, source_lang: 'JA', target_lang: 'KO',
  });
  const res = await fetch('https://api-free.deepl.com/v2/translate', { method: 'POST', body });
  if (!res.ok) throw new Error(`deepl http ${res.status}`);
  const j = await res.json();
  const txt = j.translations && j.translations[0] && j.translations[0].text;
  if (!txt) throw new Error('deepl: empty');
  return txt.trim();
}

function makeTranslator(engine) {
  if (engine === 'google') return translateGoogle;
  if (engine === 'deepl') return translateDeepL;
  if (engine === 'mymemory') return translateMyMemory;
  console.error(`Unknown engine: ${engine} (use mymemory | deepl | google)`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// JSON (re)serialization - keep the project's one-object-per-line style and
// preserve the exact numeric text of `t`.
// ---------------------------------------------------------------------------

function serializeSong(parsed, rawText) {
  const rawTs = [...rawText.matchAll(/"t"\s*:\s*(null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)]
    .map((m) => m[1]);
  const useRaw = Array.isArray(parsed.lines) && rawTs.length === parsed.lines.length;

  const keys = Object.keys(parsed);
  let out = '{\n';
  keys.forEach((k, ki) => {
    const comma = ki < keys.length - 1 ? ',' : '';
    if (k === 'lines' && Array.isArray(parsed.lines)) {
      out += '  "lines": [\n';
      parsed.lines.forEach((ln, li) => {
        const lc = li < parsed.lines.length - 1 ? ',' : '';
        const parts = Object.keys(ln).map((kk) => {
          if (kk === 't') {
            const tv = useRaw ? rawTs[li] : JSON.stringify(ln.t);
            return `"t": ${tv}`;
          }
          return `${JSON.stringify(kk)}: ${JSON.stringify(ln[kk])}`;
        });
        out += `    { ${parts.join(', ')} }${lc}\n`;
      });
      out += `  ]${comma}\n`;
    } else {
      out += `  ${JSON.stringify(k)}: ${JSON.stringify(parsed[k])}${comma}\n`;
    }
  });
  out += '}\n';
  return out;
}

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '');

async function processFile(file, opts, translator, transCache, totals) {
  const rawText = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    console.error(`  ! skipped (invalid JSON): ${file} - ${e.message}`);
    totals.badFiles++;
    return;
  }
  if (!parsed || !Array.isArray(parsed.lines)) {
    console.error(`  ! skipped (no "lines" array): ${file}`);
    totals.badFiles++;
    return;
  }

  const stat = { lines: parsed.lines.length, pron: 0, trans: 0, skipped: 0, fail: 0 };
  const planned = [];

  for (let i = 0; i < parsed.lines.length; i++) {
    const ln = parsed.lines[i];
    const orig = ln.orig || '';

    const wantPron = !opts.transOnly;
    const wantTrans = !opts.pronOnly;

    let newPron; let newTrans;

    // ---- pron ----
    if (wantPron) {
      if (!isEmpty(ln.pron) && !opts.force) {
        stat.skipped++;
      } else if (isEmpty(orig)) {
        // nothing to derive from
      } else {
        try {
          const p = pronForLine(orig);
          if (p && p !== ln.pron) { newPron = p; stat.pron++; }
        } catch (e) {
          stat.fail++;
          totals.pronFail++;
          console.error(`  ! pron failed (line ${i + 1}): ${e.message}`);
        }
      }
    }

    // ---- trans ----
    if (wantTrans) {
      if (!isEmpty(ln.trans) && !opts.force) {
        stat.skipped++;
      } else if (isEmpty(orig)) {
        // nothing to translate
      } else if (ASCII_ONLY.test(orig.trim())) {
        // pure latin line: copy through
        if (orig !== ln.trans) { newTrans = orig; stat.trans++; }
      } else if (transCache.has(orig)) {
        const cached = transCache.get(orig);
        if (cached && cached !== ln.trans) { newTrans = cached; stat.trans++; }
        else if (cached == null) { stat.fail++; totals.transFail++; }
      } else {
        try {
          const t = await translator(orig);
          transCache.set(orig, t || null);
          if (t && t !== ln.trans) { newTrans = t; stat.trans++; }
        } catch (e) {
          transCache.set(orig, null);
          stat.fail++;
          totals.transFail++;
          console.error(`  ! trans failed (line ${i + 1}): ${e.message}`);
        }
        await sleep(NET_DELAY_MS);
      }
    }

    if (newPron !== undefined || newTrans !== undefined) {
      planned.push({
        i: i + 1, orig,
        oldPron: ln.pron, newPron,
        oldTrans: ln.trans, newTrans,
      });
      if (!opts.dry) {
        if (newPron !== undefined) ln.pron = newPron;
        if (newTrans !== undefined) ln.trans = newTrans;
      }
    }
  }

  // ---- report / write ----
  console.log(`\n${file}`);
  if (opts.dry) {
    if (!planned.length) console.log('  (no changes)');
    for (const c of planned) {
      console.log(`  line ${c.i}: ${c.orig}`);
      if (c.newPron !== undefined) console.log(`    pron : ${JSON.stringify(c.oldPron)} -> ${JSON.stringify(c.newPron)}`);
      if (c.newTrans !== undefined) console.log(`    trans: ${JSON.stringify(c.oldTrans)} -> ${JSON.stringify(c.newTrans)}`);
    }
  } else if (planned.length) {
    const outText = serializeSong(parsed, rawText);
    if (opts.out) {
      fs.writeFileSync(opts.out, outText, 'utf8');
      console.log(`  written: ${opts.out}`);
    } else {
      const bak = `${file}.bak`;
      fs.copyFileSync(file, bak);
      fs.writeFileSync(file, outText, 'utf8');
      console.log(`  backup : ${bak}`);
      console.log(`  written: ${file} (in place)`);
    }
  } else {
    console.log('  (no changes)');
  }

  console.log(
    `  lines: ${stat.lines} | pron filled: ${stat.pron} | trans filled: ${stat.trans} | ` +
    `skipped (had value): ${stat.skipped} | failures: ${stat.fail}`,
  );

  totals.lines += stat.lines;
  totals.pron += stat.pron;
  totals.trans += stat.trans;
  totals.skipped += stat.skipped;
  totals.fail += stat.fail;
  totals.files++;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) { printHelp(); process.exit(opts.help ? 0 : 2); }
  if (opts.pronOnly && opts.transOnly) {
    console.error('--pron-only and --trans-only are mutually exclusive.');
    process.exit(2);
  }

  if (!fs.existsSync(opts.input)) {
    console.error(`Not found: ${opts.input}`);
    process.exit(2);
  }
  const inStat = fs.statSync(opts.input);

  let files;
  if (inStat.isDirectory()) {
    files = fs.readdirSync(opts.input)
      .filter((f) => /\.json$/i.test(f) && !/\.bak$/i.test(f))
      .map((f) => path.join(opts.input, f))
      .sort();
    if (opts.out) {
      console.error('Note: --out is ignored for folder input; editing each file in place.');
      opts.out = undefined;
    }
    if (!files.length) { console.error(`No *.json files in ${opts.input}`); process.exit(2); }
  } else {
    files = [opts.input];
  }

  const translator = opts.pronOnly ? null : makeTranslator(opts.engine);

  if (!opts.transOnly) {
    process.stdout.write('Loading kuromoji dictionary... ');
    TOKENIZER = await buildTokenizer();
    console.log('ok');
  }
  if (!opts.pronOnly) {
    console.log(`Translation engine: ${opts.engine}` +
      (opts.dry ? ' (dry run still queries the API so the preview is real; nothing is written)' : ''));
  }

  const transCache = new Map();
  const totals = {
    files: 0, badFiles: 0, lines: 0, pron: 0, trans: 0, skipped: 0, fail: 0,
    pronFail: 0, transFail: 0,
  };

  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await processFile(f, opts, translator, transCache, totals);
  }

  console.log('\n=====================================================');
  console.log(
    `TOTAL  files: ${totals.files} | lines: ${totals.lines} | ` +
    `pron filled: ${totals.pron} | trans filled: ${totals.trans} | ` +
    `skipped (already had value): ${totals.skipped} | failures: ${totals.fail}`,
  );
  if (opts.dry) console.log('(dry run - nothing was written)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
