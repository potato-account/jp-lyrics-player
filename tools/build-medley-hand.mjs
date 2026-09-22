// 여러 곡(수작업 txt: 원문/발음/번역, 빈 줄 구분)을 한 메들리 영상 타임라인으로 이어붙인다.
// 절대 songs/ 나 index.json 은 건드리지 않는다 — 이 결과물은 항상 --out 으로 지정한
// "레포 밖" 경로에만 쓰고, 앱의 파일 불러오기로 로컬(IndexedDB)에만 저장해서 쓴다.
// bundleId 를 넣지 않는 것도 같은 이유: 번들 곡으로 인식되면 index.json 동기화 대상이
// 되어버리므로, 이 파일은 끝까지 "사용자 개인 파일"로만 남아야 한다.
//
// 사용:
//   node build-medley-hand.mjs --title "메들리 제목" --youtube <videoId> \
//     --out "../../medley-private/output/medley1.json" \
//     --track "곡A제목|Vaundy|../../medley-private/sources/곡A.txt|0" \
//     --track "곡B제목|Vaundy|../../medley-private/sources/곡B.txt|245.5" \
//     [--gap 3.2] [--dry]
//
// --track 형식: "제목|아티스트|txt경로|시작초"
//   시작초는 대략적인 값이면 충분 — 정밀 타이밍은 앱 안 탭싱크 에디터에서 보정한다.
// --gap: 한 곡 안에서 줄마다 더할 임시 간격(초). 기본 3.2 — 이것도 탭싱크로 다시 맞춘다.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const opts = { tracks: [], gap: 3.2 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--title") opts.title = argv[++i];
  else if (a === "--youtube") opts.youtube = argv[++i];
  else if (a === "--out") opts.out = argv[++i];
  else if (a === "--gap") opts.gap = +argv[++i];
  else if (a === "--track") opts.tracks.push(argv[++i]);
  else if (a === "--dry") opts.dry = true;
  else { console.error("unknown flag " + a); process.exit(2); }
}
for (const k of ["title", "youtube", "out"]) {
  if (!opts[k]) { console.error(`missing --${k}`); process.exit(2); }
}
if (!opts.tracks.length) { console.error("--track 을 최소 1개 이상 지정하세요"); process.exit(2); }

// ---- 안전장치: --out 이 이 레포 안이면 무조건 거부 ----
const outAbs = path.resolve(opts.out);
if (outAbs === REPO_ROOT || outAbs.startsWith(REPO_ROOT + path.sep)) {
  console.error(`🚫 --out 이 레포 안입니다: ${outAbs}`);
  console.error(`   이 데이터는 절대 커밋되면 안 되므로, 레포 밖 경로(예: ../../medley-private/output/)로 지정하세요.`);
  process.exit(1);
}

// ---- txt 파싱: merge-hand.mjs 와 동일한 3줄(원문/발음/번역) 규칙 ----
function parseHandTxt(text) {
  const chunks = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const lines = [];
  for (let i = 0; i + 2 < chunks.length + 1 && chunks[i] != null; i += 3) {
    lines.push({ orig: chunks[i], pron: chunks[i + 1] || "", trans: chunks[i + 2] || "" });
  }
  return lines;
}

const tracks = [];
const lines = [];
for (const spec of opts.tracks) {
  const [title, artist, txtPath, startStr] = spec.split("|");
  if (!title || !txtPath || startStr === undefined) {
    console.error(`--track 형식 오류: "${spec}" (제목|아티스트|txt경로|시작초)`);
    process.exit(2);
  }
  const start = +startStr;
  const hand = parseHandTxt(fs.readFileSync(path.resolve(txtPath), "utf-8"));
  if (!hand.length) { console.error(`⚠ ${txtPath}: 파싱된 줄 없음`); process.exit(1); }

  tracks.push({ title, artist: artist || undefined, start });
  hand.forEach((l, i) => {
    lines.push({
      t: +(start + i * opts.gap).toFixed(2),
      orig: l.orig,
      pron: l.pron, pronSrc: l.pron ? "user" : undefined,
      trans: l.trans, transSrc: l.trans ? "user" : undefined,
    });
  });
  console.log(`  ${title}: ${hand.length}줄, 시작 ${start}s (임시 간격 ${opts.gap}s)`);
}

// t 순서 보장 (구간별로 이미 오름차순이지만, start 값이 뒤섞여 지정된 경우 대비)
lines.sort((a, b) => a.t - b.t);

const medley = {
  title: opts.title,
  youtubeId: opts.youtube,
  isMedley: true,
  offset: 0,
  tracks,
  lines,
  // bundleId 없음 — 절대 넣지 말 것 (위 주석 참고)
};

console.log(`\n총 ${tracks.length}곡, ${lines.length}줄 → ${opts.dry ? "(dry-run, 저장 안 함)" : outAbs}`);
if (opts.dry) process.exit(0);

fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, JSON.stringify(medley, null, 2) + "\n");
console.log(`✓ 저장됨: ${outAbs}`);
console.log(`  → 이 파일을 폰으로 보내서(카카오톡/이메일 등, GitHub 금지) 앱의 "파일 불러오기"로 불러온 뒤`);
console.log(`    탭싱크 에디터로 실제 타이밍을 맞추세요.`);
