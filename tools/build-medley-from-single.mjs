// 이미 "[제목]" 구분자로 여러 곡이 한 txt에 합쳐져 있는 파일을 메들리 JSON으로 변환한다.
// 절대 songs/ 나 index.json 은 건드리지 않는다 — 결과물은 항상 --out 으로 지정한
// "레포 밖" 경로에만 쓰고, 앱의 파일 불러오기로 로컬(IndexedDB)에만 저장해서 쓴다.
//
// 입력 파일 형식 (사용자가 이미 만든 그대로):
//   [곡A 제목]
//   원문
//
//   발음
//
//   번역
//
//   원문
//   ...
//   [곡B 제목]
//   ...
//
// 사용:
//   node build-medley-from-single.mjs --in "../../medley-private/sources/medley1.txt" \
//     --youtube <videoId> --out "../../medley-private/output/medley1.json" \
//     --starts "0,245.5,512,..." [--gap 3.2] [--dry]
//
// --starts: 파일에서 감지된 곡 개수와 정확히 같은 개수의 시작초(콤마 구분)를 순서대로.
//   대략적인 값이면 충분 — 정밀 타이밍은 앱 안 탭싱크 에디터에서 보정한다.
//
// 프라이버시: 이 스크립트는 곡 제목이나 가사 원문을 콘솔에 출력하지 않는다
// (곡 번호와 줄 개수만 표시). 파일 내용은 Node 프로세스 안에서만 처리된다.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const opts = { gap: 3.2 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--in") opts.in = argv[++i];
  else if (a === "--youtube") opts.youtube = argv[++i];
  else if (a === "--local") opts.local = true;   // 유튜브에 없는 영상/음성 — 앱의 로컬 재생 기능으로
  else if (a === "--out") opts.out = argv[++i];
  else if (a === "--starts") opts.starts = argv[++i];
  else if (a === "--gap") opts.gap = +argv[++i];
  else if (a === "--dry") opts.dry = true;
  else { console.error("unknown flag " + a); process.exit(2); }
}
for (const k of ["in", "out", "starts"]) {
  if (!opts[k]) { console.error(`missing --${k}`); process.exit(2); }
}
if (!opts.youtube && !opts.local) { console.error("--youtube 또는 --local 중 하나는 필요합니다"); process.exit(2); }
if (opts.youtube && opts.local) { console.error("--youtube 와 --local 은 동시에 줄 수 없습니다"); process.exit(2); }

// ---- 안전장치: --out 이 이 레포 안이면 무조건 거부 ----
const outAbs = path.resolve(opts.out);
if (outAbs === REPO_ROOT || outAbs.startsWith(REPO_ROOT + path.sep)) {
  console.error(`🚫 --out 이 레포 안입니다: ${outAbs}`);
  console.error(`   레포 밖 경로(예: ../../medley-private/output/)로 지정하세요.`);
  process.exit(1);
}

// ---- 입력 파일을 "[제목]" 기준으로 곡 단위로 분리 ----
const rawText = fs.readFileSync(path.resolve(opts.in), "utf-8");
const songs = []; // { chunks: [] }  (제목 문자열은 저장은 하되 콘솔 출력엔 안 씀)
let current = null;
let strayLines = 0;

for (const raw of rawText.split(/\r?\n/)) {
  const line = raw.trim();
  if (line === "") continue;
  const m = line.match(/^\[(.+)\]$/);
  if (m) {
    current = { title: m[1], chunks: [] };
    songs.push(current);
    continue;
  }
  if (!current) { strayLines++; continue; } // 첫 [제목] 전에 나온 줄은 무시
  current.chunks.push(line);
}

if (strayLines) console.error(`⚠ 첫 [제목] 마커 이전의 줄 ${strayLines}개는 무시했습니다.`);
if (!songs.length) { console.error("🚫 [제목] 마커를 하나도 못 찾았습니다."); process.exit(1); }

for (const s of songs) {
  s.lines = [];
  for (let i = 0; i + 2 < s.chunks.length + 1 && s.chunks[i] != null; i += 3) {
    s.lines.push({ orig: s.chunks[i], pron: s.chunks[i + 1] || "", trans: s.chunks[i + 2] || "" });
  }
  if (s.chunks.length % 3 !== 0) {
    console.error(`⚠ [트랙 ${songs.indexOf(s) + 1}] 줄 수(${s.chunks.length})가 3의 배수가 아님 — 원문/발음/번역 형식을 확인하세요.`);
  }
}

const starts = opts.starts.split(",").map((s) => +s.trim());
if (starts.length !== songs.length) {
  console.error(`🚫 감지된 곡 수(${songs.length})와 --starts 개수(${starts.length})가 다릅니다.`);
  process.exit(1);
}
if (starts.some((n) => Number.isNaN(n))) {
  console.error(`🚫 --starts 에 숫자로 해석 안 되는 값이 있습니다.`);
  process.exit(1);
}

// ---- 조립 ----
const tracks = [];
const lines = [];
songs.forEach((s, idx) => {
  const start = starts[idx];
  tracks.push({ start }); // 제목은 콘솔/커밋 로그에 남기지 않기 위해 트랙 메타에도 굳이 안 넣음
  s.lines.forEach((l, i) => {
    lines.push({
      t: +(start + i * opts.gap).toFixed(2),
      orig: l.orig,
      pron: l.pron, pronSrc: l.pron ? "user" : undefined,
      trans: l.trans, transSrc: l.trans ? "user" : undefined,
    });
  });
  console.log(`  트랙 ${idx + 1}: ${s.lines.length}줄, 시작 ${start}s`);
});

lines.sort((a, b) => a.t - b.t);

const medley = {
  title: "medley", // 실제 제목은 필요하면 앱 안에서 직접 수정
  ...(opts.local ? { localMedia: true } : { youtubeId: opts.youtube }),
  isMedley: true,
  offset: 0,
  tracks,
  lines,
  // bundleId 없음 — 절대 넣지 말 것
};

console.log(`\n총 ${songs.length}곡, ${lines.length}줄 → ${opts.dry ? "(dry-run, 저장 안 함)" : outAbs}`);
if (opts.dry) process.exit(0);

fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, JSON.stringify(medley, null, 2) + "\n");
console.log(`✓ 저장됨: ${outAbs}`);
console.log(`  → 폰으로 전달(카카오톡/이메일 등, GitHub 금지) 후 앱의 "파일 불러오기"로 이 JSON을 불러오세요.`);
if (opts.local) {
  console.log(`    이 곡은 로컬 미디어(localMedia)라, 불러온 뒤 화면의 "🎬 영상/음성 파일 선택"으로`);
  console.log(`    실제 영상/음성 파일도 (이 JSON과는 별개로) 한 번 골라줘야 재생됩니다.`);
}
console.log(`    그다음 탭싱크 에디터로 실제 타이밍과 제목을 다듬으세요.`);
