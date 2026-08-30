// 일본어(한자+가나) 한 줄 → 한글 발음 근사값.
// tools/fill.mjs 의 변환 로직을 브라우저용으로 옮긴 것. kuromoji 토크나이저가 준
// 가타카나 읽기를 받아 한글로 바꾼다. "정확한 로마자 표기"가 아니라 "한국인이
// 일본어 발음을 흉내 낼 때 읽을 법한 표기"가 목표.

const KANA = {
  'ア': '아', 'イ': '이', 'ウ': '우', 'エ': '에', 'オ': '오',
  'カ': '카', 'キ': '키', 'ク': '쿠', 'ケ': '케', 'コ': '코',
  'ガ': '가', 'ギ': '기', 'グ': '구', 'ゲ': '게', 'ゴ': '고',
  'サ': '사', 'シ': '시', 'ス': '스', 'セ': '세', 'ソ': '소',
  'ザ': '자', 'ジ': '지', 'ズ': '즈', 'ゼ': '제', 'ゾ': '조',
  'タ': '타', 'チ': '치', 'ツ': '츠', 'テ': '테', 'ト': '토',
  'ダ': '다', 'ヂ': '지', 'ヅ': '즈', 'デ': '데', 'ド': '도',
  'ナ': '나', 'ニ': '니', 'ヌ': '누', 'ネ': '네', 'ノ': '노',
  'ハ': '하', 'ヒ': '히', 'フ': '후', 'ヘ': '헤', 'ホ': '호',
  'バ': '바', 'ビ': '비', 'ブ': '부', 'ベ': '베', 'ボ': '보',
  'パ': '파', 'ピ': '피', 'プ': '푸', 'ペ': '페', 'ポ': '포',
  'マ': '마', 'ミ': '미', 'ム': '무', 'メ': '메', 'モ': '모',
  'ヤ': '야', 'ユ': '유', 'ヨ': '요',
  'ラ': '라', 'リ': '리', 'ル': '루', 'レ': '레', 'ロ': '로',
  'ワ': '와', 'ヲ': '오', 'ヰ': '이', 'ヱ': '에', 'ヴ': '부',
  'ァ': '아', 'ィ': '이', 'ゥ': '우', 'ェ': '에', 'ォ': '오',
  'ャ': '야', 'ュ': '유', 'ョ': '요', 'ヮ': '와',
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
  'シェ': '셰', 'ジェ': '제', 'チェ': '체', 'ティ': '티', 'ディ': '디',
  'トゥ': '투', 'ドゥ': '두', 'テュ': '튜', 'デュ': '듀',
  'ファ': '파', 'フィ': '피', 'フェ': '페', 'フォ': '포', 'フュ': '퓨',
  'ウィ': '위', 'ウェ': '웨', 'ウォ': '워',
  'ヴァ': '바', 'ヴィ': '비', 'ヴェ': '베', 'ヴォ': '보', 'ヴュ': '뷰',
  'ツァ': '차', 'ツィ': '치', 'ツェ': '체', 'ツォ': '초',
  'イェ': '예', 'クァ': '콰', 'グァ': '과',
};
const SMALL = new Set(['ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ']);
const JONG = { 'ㄴ': 4, 'ㅁ': 16, 'ㅅ': 19, 'ㅇ': 21 };

function hiraToKata(s) {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
function addJong(arr, jamo) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const el = arr[i];
    if (el.length !== 1) continue;
    const code = el.codePointAt(0);
    if (code < 0xac00 || code > 0xd7a3) {
      if (el === '-') continue;
      return false;
    }
    if ((code - 0xac00) % 28 !== 0) return false;
    arr[i] = String.fromCodePoint(code + JONG[jamo]);
    return true;
  }
  return false;
}
function nasalJamo(nextChar) {
  if (!nextChar) return 'ㄴ';
  if ('カキクケコガギグゲゴ'.includes(nextChar)) return 'ㅇ';
  if ('マミムメモバビブベボパピプペポ'.includes(nextChar)) return 'ㅁ';
  return 'ㄴ';
}

export function kanaToHangul(input) {
  const kana = hiraToKata(input);
  const chars = [...kana];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const c2 = chars[i + 1];
    if (c2 && SMALL.has(c2) && KANA[c + c2]) { out.push(KANA[c + c2]); i++; continue; }
    if (c === 'ッ' || c === 'ｯ') { addJong(out, 'ㅅ'); continue; }
    if (c === 'ン' || c === 'ﾝ') {
      const jamo = nasalJamo(chars[i + 1]);
      if (!addJong(out, jamo)) out.push(jamo);
      continue;
    }
    if (c === 'ー' || c === 'ｰ' || c === '−' || c === '—') { out.push('-'); continue; }
    if (KANA[c]) { out.push(KANA[c]); continue; }
    out.push(c);
  }
  return out.join('');
}

const ASCII_ONLY = /^[\x00-\x7F]+$/;
const HAS_ALNUM = /[A-Za-z0-9]/;

function tokenToPart(tok, prev) {
  const surface = tok.surface_form;
  if (tok.pos === '記号' && /^\s+$/.test(surface)) return { text: ' ', glue: true, space: true };
  if (ASCII_ONLY.test(surface) && !HAS_ALNUM.test(surface)) return { text: surface, glue: true };
  if (surface === '、' || surface === '，') return { text: ', ', glue: true };
  if (surface === '。' || surface === '．') return { text: '', glue: true };
  if (surface === '・' || surface === '　') return { text: ' ', glue: true, space: true };
  if ('！？「」『』（）〜'.includes(surface)) return { text: surface, glue: true };

  const reading = tok.pronunciation && tok.pronunciation !== '*'
    ? tok.pronunciation
    : (tok.reading && tok.reading !== '*' ? tok.reading : null);

  if (!reading && ASCII_ONLY.test(surface)) {
    return { text: surface, glue: !!(prev && prev.space) };
  }
  const text = kanaToHangul(reading || surface);
  let glue = false;
  if (prev) {
    if (prev.space) glue = true;
    else if (tok.pos === '助詞' || tok.pos === '助動詞') glue = true;
    else if (tok.pos_detail_1 === '接尾') glue = true;
    else if (tok.pos_detail_1 === '非自立') glue = true;
    else if (tok.pos === '記号') glue = true;
    else if (prev.sahen) glue = true;
  }
  return { text, glue, sahen: tok.pos_detail_1 === 'サ変接続' };
}

const STRAY_JONG = { 'ㄴ': 4, 'ㅁ': 16, 'ㅇ': 21, 'ㅅ': 19 };
function mergeStrayJamo(s) {
  return s.replace(/([가-힣])\s*([ㄴㅁㅇㅅ])/g, (m, syl, jamo) => {
    const code = syl.codePointAt(0);
    if ((code - 0xac00) % 28 !== 0) return m;
    return String.fromCodePoint(code + STRAY_JONG[jamo]);
  });
}

// tokenizer: kuromoji tokenizer 인스턴스
export function pronForLine(tokenizer, orig) {
  const src = (orig || '').trim();
  if (!src) return '';
  if (ASCII_ONLY.test(src)) return src; // "Oh right" 같은 순 영문 줄은 그대로

  const tokens = tokenizer.tokenize(src);
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
