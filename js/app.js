import { Player, parseVideoId } from "./player.js";
import { LyricsView, parsePaste } from "./lyrics.js";
import {
  allSongs, getSong, putSong, getLastId, setLastId, migrateLegacy,
  allPlaylists, getPlaylist, putPlaylist, deletePlaylist, songRef, findByRef,
  getImage, putImage, deleteImage, flush,
} from "./store.js";
import { autofillSong, hasFillable } from "./autofill.js";

const $ = (s) => document.querySelector(s);
const appEl = $("#app");

// 앱 높이를 실제 표시 영역(innerHeight)에 고정. dvh/vh/% 가 환경에 따라 더 크게 잡히는 문제 회피.
const setAppHeight = () => document.documentElement.style.setProperty("--app-h", window.innerHeight + "px");
setAppHeight();
addEventListener("resize", setAppHeight);
addEventListener("orientationchange", setAppHeight);

let song = null; // 현재 곡
const player = new Player("player");
let view;
let wakeLock = null;
let bulkMode = "pron";

// 목록 시트가 지금 무엇을 보여주는가.
// { type:"all" } | { type:"playlist", id } | { type:"hidden" }
let listFilter = { type: "all" };
try { listFilter = JSON.parse(localStorage.getItem("jlp:listFilter")) || listFilter; } catch {}
const saveListFilter = () => localStorage.setItem("jlp:listFilter", JSON.stringify(listFilter));

// 반복 모드. 버튼을 누를 때마다 이 순서로 돈다.
// "stop" 한 곡만 재생하고 끝 | "loop" 전체 반복(마지막 → 첫 곡) | "one" 한 곡 반복
const REPEAT_CYCLE = ["stop", "loop", "one"];
// 상태는 아이콘 모양만으로 구분한다(빗금 / 그냥 / 가운데 1).
// 이모지로는 "빗금 친 반복"이 없어서 직접 그린다.
const REPEAT_ARROWS = '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7z"/><path d="M17 17H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>';
const svg = (inner) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${inner}</svg>`;
const REPEAT_UI = {
  // 빗금은 배경색 굵은 선을 깔아 아이콘과 분리한다(안 그러면 뭉쳐 보인다)
  stop: {
    text: "반복 없음",
    html: svg(REPEAT_ARROWS +
      '<line x1="3.5" y1="20.5" x2="20.5" y2="3.5" stroke="var(--bg-soft)" stroke-width="4.5" stroke-linecap="round"/>' +
      '<line x1="3.5" y1="20.5" x2="20.5" y2="3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  },
  loop: { text: "전체 반복", html: svg(REPEAT_ARROWS) },
  one:  { text: "한 곡 반복", html: svg(REPEAT_ARROWS + '<path d="M13 15V9h-1l-2 1v1h1.5v4H13z"/>') },
};
let endMode = localStorage.getItem("jlp:endMode");
if (endMode === "next") endMode = "loop";              // 4단 시절의 "다음 곡" → 가장 가까운 동작으로
if (!REPEAT_CYCLE.includes(endMode)) {
  endMode = localStorage.getItem("jlp:autoplay") === "1" ? "loop" : "stop"; // 더 이전 설정 이어받기
}
let queue = [];       // 재생 대기열(곡 id 배열). 목록에서 곡을 고를 때 그 시점 목록으로 채워진다.
let queueIndex = -1;

// 목록 시트의 "선택" 모드: 체크한 곡들을 한 번에 플레이리스트에 담는다.
let selectMode = false;
const selected = new Set();     // 체크된 song.id

// 목록 "편집" 모드: 켰을 때만 줄에 관리 버튼이 나온다.
//   전체 목록  → ＋(플리 담기)·숨기기
//   플레이리스트 → ▲▼(순서)·✕(빼기) + 헤더 "이름·삭제"
// 평소엔 목록만 깔끔하게 보이고 탭하면 재생.
let editMode = false;
let plpickSongs = [];           // 플레이리스트 담기 다이얼로그가 지금 다루는 곡들

// ---------- 공통 ----------
function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
async function persist() {
  if (!song) return;
  await putSong(song);
  setLastId(song.id);
}

// ---------- 곡 적용 ----------
async function loadSong(next, { autoplay = false } = {}) {
  song = next;
  if (song.offset == null) song.offset = 0;
  if (song.id) setLastId(song.id);
  appEl.classList.toggle("has-song", song.lines.length > 0);
  view.setSong(song);
  view.setEditable(appEl.classList.contains("edit-on"));
  renderSyncVal();
  updateAutofillBanner();
  applyArt();
  if (!$("#song-list").hidden) updateSheetBg();   // 목록 열어둔 채 곡이 바뀌면 배경도
  $("#time-dur").textContent = "0:00";
  $("#time-cur").textContent = "0:00";
  $("#seekbar").value = "0";
  if (song.youtubeId) await player.load(song.youtubeId, { autoplay });
}

// 발음·번역이 비어 있으면 상단에 "자동 채우기" 배너 표시
function updateAutofillBanner() {
  appEl.classList.toggle("needs-autofill", hasFillable(song));
}

// ---------- 곡 이미지 (영상 대신 화면에 띄우는 사진) ----------
// iframe 은 소리를 위해 뒤에서 계속 재생되고, 이 이미지가 그 위를 덮는다.
// "⇅" 버튼으로 이미지 ↔ 실제 영상을 오간다. 기본은 이미지.
// 우선순위: 이 기기에서 올린 이미지(IndexedDB) > 곡에 박힌 repo 경로(song.image)
//         > 유튜브 썸네일(youtubeId 있으면 자동, 별도 설정 불필요)
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
let artUrl = null;                        // 우리가 만든 objectURL(직접 revoke). repo 경로면 null.
let artToken = 0;
async function applyArt() {
  const va = $("#video-area");
  const img = $("#art-img");
  const my = ++artToken;                 // 곡이 빠르게 바뀔 때 늦게 온 응답 무시
  if (artUrl) { URL.revokeObjectURL(artUrl); artUrl = null; }
  img.removeAttribute("src");
  va.classList.remove("has-art");
  if (!song) return;
  const rec = song.id ? await getImage(song.id) : null;
  if (my !== artToken) return;           // 그 사이 다른 곡으로 넘어감
  img.onerror = () => { if (my === artToken) va.classList.remove("has-art"); };  // 이미지가 깨지면 "없음" 안내로
  if (rec && rec.blob) {
    artUrl = URL.createObjectURL(rec.blob);
    img.src = artUrl;
    va.classList.add("has-art");
  } else if (song.image) {
    img.src = song.image;                // repo 에 커밋된 이미지 경로 (revoke 안 함)
    va.classList.add("has-art");
  } else if (song.youtubeId) {
    img.src = ytThumb(song.youtubeId);   // 설정된 이미지가 없으면 유튜브 썸네일
    va.classList.add("has-art");
  }
}

// ---------- 목록 시트 배경 ----------
// 우선순위: B(지금 곡 이미지 / 없으면 유튜브 썸네일) → A(고정 img/list-bg.jpg) → 단색
let listBgProbed = null;               // null 미확인 / true·false
function probeListBg() {
  if (listBgProbed !== null) return Promise.resolve(listBgProbed);
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { listBgProbed = true; res(true); };
    im.onerror = () => { listBgProbed = false; res(false); };
    im.src = "img/list-bg.jpg";
  });
}

let sheetBgUrl = null;
async function updateSheetBg() {
  const sheet = document.querySelector("#song-list .sheet");
  if (!sheet) return;
  if (sheetBgUrl) { URL.revokeObjectURL(sheetBgUrl); sheetBgUrl = null; }
  sheet.classList.remove("sheet-a", "sheet-b", "has-bg");
  sheet.style.removeProperty("--sheet-img");

  // 지금 곡이 있으면(상단 이미지와 같은 기준으로) 그 곡 배경을 쓴다.
  // 예전엔 "그 곡이 현재 목록 필터에도 보여야" 배경을 깔았는데(curInList),
  // 필터가 플리/숨김이거나 ref 매칭이 어긋나면 상단엔 썸네일이 떠도
  // 목록 시트만 검정으로 남는 버그가 있었다. applyArt 처럼 게이트를 없앤다.
  const haveSong = !!(song && song.id);

  // B: 그 곡의 이미지 — 업로드 > repo 경로 > 유튜브 썸네일(정지) 순.
  //    재생 상태·⇅ 버튼과 무관하게 항상 정지 이미지를 쓴다.
  //    MV(유튜브 영상)는 목록을 열어도 원래 자리에서 그대로 재생되게 둔다.
  if (haveSong) {
    const rec = await getImage(song.id);
    let src = null;
    if (rec && rec.blob) { sheetBgUrl = URL.createObjectURL(rec.blob); src = sheetBgUrl; }
    else if (song.image) src = song.image;
    else if (song.youtubeId) src = ytThumb(song.youtubeId);

    if (src) {
      sheet.style.setProperty("--sheet-img", `url("${src}")`);
      sheet.classList.add("sheet-b", "has-bg");
      return;
    }
  }

  // A: 고정 배경 파일이 실제로 있을 때만
  if (await probeListBg()) sheet.classList.add("sheet-a", "has-bg");
}

function setShowVideo(on) {
  $("#video-area").classList.toggle("show-video", on);
  localStorage.setItem("jlp:showVideo", on ? "1" : "0");
  const b = $("#toggle-video");
  b.title = on ? "영상 → 이미지" : "이미지 → 영상";
  b.setAttribute("aria-label", on ? "이미지로 전환" : "영상으로 전환");
}

// 이미지 파일 → 캔버스로 축소·재인코딩한 Blob. 큰 원본을 그대로 넣지 않는다.
async function downscaleImage(file, maxPx = 1080) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;                 // 디코딩 실패 시 원본이라도 저장
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.85));
  return blob && blob.size ? blob : file;
}

// 파일/붙여넣기로 들어온 줄에 출처 태그 부여.
// 파일이 pronSrc/transSrc 를 이미 갖고 있으면 존중, 아니면 값이 있으면 "user".
function tagImportedLines(lines) {
  for (const l of lines) {
    for (const f of ["pron", "trans"]) {
      if (l[f + "Src"]) continue;
      l[f + "Src"] = l[f] ? "user" : undefined;
    }
  }
  return lines;
}

// ---------- 메인 루프 ----------
let seeking = false;
function tick() {
  const now = player.currentTime;
  const dur = player.duration;
  view.update(now);
  $("#time-cur").textContent = fmt(now);
  if (dur) {
    $("#time-dur").textContent = fmt(dur);
    if (!seeking) $("#seekbar").value = String(Math.round((now / dur) * 1000));
  }
  $("#playpause").textContent = player.isPlaying ? "❚❚" : "▶";
  requestAnimationFrame(tick);
}

// ---------- 재생 컨트롤 ----------
function wireControls() {
  $("#playpause").addEventListener("click", () => (player.isPlaying ? player.pause() : player.play()));
  $("#back5").addEventListener("click", () => player.seek(player.currentTime - 5));
  $("#fwd5").addEventListener("click", () => player.seek(player.currentTime + 5));

  // 곡 이동 — 반복 모드와 무관하게 지금 목록(대기열)을 직접 이동
  $("#prev-song").addEventListener("click", () => playAdjacent(-1)); // 이전 곡
  $("#next-song").addEventListener("click", () => playAdjacent(+1)); // 다음 곡
  $("#first-song").addEventListener("click", () => playEdge("first")); // 목록 첫 곡
  $("#last-song").addEventListener("click", () => playEdge("last"));   // 목록 마지막 곡

  const bar = $("#seekbar");
  bar.addEventListener("pointerdown", () => (seeking = true));
  const endSeek = () => {
    seeking = false;
    const dur = player.duration;
    if (dur) player.seek((bar.value / 1000) * dur);
  };
  bar.addEventListener("pointerup", endSeek);
  bar.addEventListener("change", endSeek);

  // 이미지 ↔ 영상 전환. 기본은 이미지, 마지막 선택을 기억한다.
  $("#toggle-video").addEventListener("click", () => {
    setShowVideo(!$("#video-area").classList.contains("show-video"));
  });
  setShowVideo(localStorage.getItem("jlp:showVideo") === "1");

  // 영상 전체화면 → 여기서 홈 버튼을 누르면 안드로이드가 작은 창(PiP)으로 재생을 이어감
  $("#go-fullscreen").addEventListener("click", async () => {
    const f = player.iframeEl;
    if (!f) return;
    try {
      await (f.requestFullscreen ? f.requestFullscreen() : f.webkitRequestFullscreen && f.webkitRequestFullscreen());
      if (!localStorage.getItem("jlp:pipHint")) {
        localStorage.setItem("jlp:pipHint", "1");
        setTimeout(() => alert("전체화면 상태에서 홈 버튼을 누르면 작은 창으로 재생이 이어집니다 (안드로이드).\n화면을 끄면 멈춥니다."), 400);
      }
    } catch {}
  });

  $("#edit-mode").addEventListener("click", () => {
    const on = appEl.classList.toggle("edit-on");
    $("#edit-mode").textContent = on ? "편집 끝" : "편집";
    // 편집을 끌 때(그리고 켤 때도) 설정·전체싱크·카테고리는 항상 접힌 상태로 초기화
    appEl.classList.remove("edit-tools-on", "sync-open");
    $("#edit-tools").textContent = "설정";
    collapseCats();
    driftExit();                       // 드리프트 보정 진행 중이었으면 취소
    view.setEditable(on);
    if (on) acquireWakeLock();
    else { persist(); if (!player.isPlaying) releaseWakeLock(); }
  });

  const collapseCats = () => {
    document.querySelectorAll(".cat-sub.open").forEach((n) => n.classList.remove("open"));
    document.querySelectorAll(".cat-btn.active").forEach((n) => n.classList.remove("active"));
  };

  // 설정: 목록(붙여넣기·전체싱크·드리프트)을 펼치거나 접는다 (2단 잠금)
  $("#edit-tools").addEventListener("click", () => {
    const open = appEl.classList.toggle("edit-tools-on");
    $("#edit-tools").textContent = open ? "설정 닫기" : "설정";
    if (!open) { appEl.classList.remove("sync-open"); collapseCats(); }
  });

  // 카테고리 아코디언: 가사/발음/번역 → 눌러야 일괄/개별이 나온다 (한 번에 하나만)
  document.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = document.querySelector(`.cat-sub[data-cat="${btn.dataset.cat}"]`);
      const willOpen = !sub.classList.contains("open");
      collapseCats();
      if (willOpen) { sub.classList.add("open"); btn.classList.add("active"); }
    });
  });

  // 전체 싱크: 눌러야 −0.5~0 스텝퍼가 나온다 (3단 잠금)
  $("#sync-toggle").addEventListener("click", () => {
    const open = appEl.classList.toggle("sync-open");
    if (open) renderSyncVal();
  });

  wireSyncBar();
  wireDrift();
}

// ---------- 전체 싱크(offset) — 편집 모드 "설정" 영역 ----------
// 곡의 모든 줄에 일괄로 더해지는 보정치(초). 정보 다이얼로그의 "싱크 보정"과 같은 값.
function renderSyncVal() {
  const v = song ? (song.offset || 0) : 0;
  const r = Math.round(v * 10) / 10;
  $("#sync-val").textContent = (r > 0 ? "+" : "") + r.toFixed(1) + "s";
}
function wireSyncBar() {
  let saveTimer = null;
  const bump = (d) => {
    if (!song) return;
    song.offset = Math.round(((song.offset || 0) + d) * 10) / 10;
    renderSyncVal();
    view.update(player.currentTime);            // 재생 중이면 즉시 반영
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);       // 연타 시 마지막 한 번만 저장
  };
  $("#sync-mm").addEventListener("click", () => bump(-0.5));
  $("#sync-m").addEventListener("click", () => bump(-0.1));
  $("#sync-p").addEventListener("click", () => bump(0.1));
  $("#sync-pp").addEventListener("click", () => bump(0.5));
  $("#sync-reset").addEventListener("click", () => {
    if (!song || !(song.offset || 0)) return;
    song.offset = 0;
    renderSyncVal();
    view.update(player.currentTime);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  });
}

// ---------- 드리프트 보정 (2점 선형 보정) ----------
// 앞/뒤 두 줄의 "실제 재생시각"을 잡아 전체 타임을 t' = k·t + b 로 다시 계산.
// offset(전체 싱크)이 못 잡는, 뒤로 갈수록 벌어지는 어긋남을 고친다.
let driftState = 0;                 // 0 꺼짐 / 1 앞 대기 / 2 뒤 대기 / 3 적용 가능
let driftA = null, driftB = null;

function driftExit() {
  driftState = 0; driftA = null; driftB = null;
  appEl.classList.remove("drift-mode");
  document.querySelectorAll(".lyric-line.drift-anchor").forEach((n) => n.classList.remove("drift-anchor"));
}
function driftMsg() {
  const m = $("#drift-msg");
  if (driftState === 1) m.textContent = "재생하면서, 지금 들리는 가사 줄을 탭하세요 — ① 앞부분 1곳";
  else if (driftState === 2) m.textContent = "② 뒷부분 1곳을 탭하세요 (앞 기준보다 뒤쪽 줄, 멀수록 정확)";
  else if (driftState === 3) m.textContent = "두 지점 기록됨. [적용] 하면 전체 타임을 다시 계산합니다.";
}
function driftEnter() {
  if (!song) return;
  if (song.lines.filter((l) => l.t != null).length < 2) { alert("타임이 있는 줄이 2개 이상이어야 해요."); return; }
  driftState = 1; driftA = null; driftB = null;
  appEl.classList.add("drift-mode");
  document.querySelectorAll(".lyric-line.drift-anchor").forEach((n) => n.classList.remove("drift-anchor"));
  $("#drift-apply").disabled = true;
  $("#drift-info").textContent = "";
  driftMsg();
}
function driftMark(idx) {
  const li = $(`#lyrics-list .lyric-line[data-idx="${idx}"]`);
  if (li) li.classList.add("drift-anchor");
}
function driftPick(idx) {
  const line = song && song.lines[idx];
  if (!line || line.t == null) { alert("타임이 없는 줄은 기준으로 쓸 수 없어요."); return; }
  const real = +Number(player.currentTime).toFixed(2);
  if (driftState === 1) {
    driftA = { idx, oldT: line.t, real };
    driftMark(idx);
    driftState = 2; driftMsg();
    return;
  }
  // 뒤 기준 (2 또는 3에서 다시 찍기 허용)
  if (idx === driftA.idx || line.t <= driftA.oldT) { alert("뒤 기준은 앞 기준보다 뒤쪽 줄이어야 해요."); return; }
  driftB = { idx, oldT: line.t, real };
  document.querySelectorAll(".lyric-line.drift-anchor").forEach((n) => {
    if (+n.dataset.idx !== driftA.idx) n.classList.remove("drift-anchor");
  });
  driftMark(idx);
  const k = (driftB.real - driftA.real) / (driftB.oldT - driftA.oldT);
  const perMin = (k - 1) * 60;
  const n = song.lines.filter((l) => l.t != null).length;
  driftState = 3;
  $("#drift-apply").disabled = !(isFinite(k) && k > 0.3 && k < 3);
  $("#drift-info").textContent =
    `배속 k=${k.toFixed(3)} · 분당 ${perMin >= 0 ? "+" : ""}${perMin.toFixed(1)}초 · ${n}줄 적용`;
  driftMsg();
}
async function driftApply() {
  if (driftState !== 3 || !driftA || !driftB || !song) return;
  const k = (driftB.real - driftA.real) / (driftB.oldT - driftA.oldT);
  const b = driftA.real - k * driftA.oldT;
  if (!isFinite(k) || k <= 0) { alert("계산값이 이상해요. 취소하고 다시 시도하세요."); return; }
  if (!confirm(`전체 줄 타임을 다시 계산합니다 (배속 ${k.toFixed(3)}). 되돌릴 수 없어요. 진행할까요?`)) return;
  for (const l of song.lines) {
    if (l.t == null) continue;
    l.t = Math.max(0, Math.round((k * l.t + b) * 100) / 100);
  }
  song.offset = 0;                 // 절대 시각으로 구웠으니 보정치는 0
  await persist();
  view.setSong(song);
  view.setEditable(appEl.classList.contains("edit-on"));
  renderSyncVal();
  updateAutofillBanner();
  driftExit();
}
function wireDrift() {
  $("#drift-start").addEventListener("click", driftEnter);
  $("#drift-cancel").addEventListener("click", driftExit);
  $("#drift-apply").addEventListener("click", driftApply);
  // 드리프트 모드에서 가사 줄 탭 = 앵커 선택 (seek/수정 다이얼로그 대신)
  $("#lyrics-list").addEventListener("click", (e) => {
    if (driftState === 0) return;
    const li = e.target.closest(".lyric-line");
    if (!li) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    driftPick(+li.dataset.idx);
  }, true);
}

// ---------- 편집: 타임/칸 ----------
const fmtTime = (t) => {
  if (t == null) return "";
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
};
// "m:ss.xx" 또는 초 숫자 → 초. 빈 문자열이면 null.
function parseTime(str) {
  const s = (str || "").trim();
  if (!s) return null;
  const mm = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (mm) return +mm[1] * 60 + +mm[2];
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// 줄 하나의 원문·발음·번역·시간을 한 다이얼로그에서 수정 + 줄 삽입/삭제(낱개 편집)
let lineDialogIdx = -1;
function openLineDialog(i) {
  if (!song || !song.lines[i]) return;
  lineDialogIdx = i;
  const L = song.lines[i];
  $("#line-dlg-title").textContent = `줄 수정 (${i + 1}/${song.lines.length})`;
  $("#line-orig").value = L.orig || "";
  $("#line-pron").value = L.pron || "";
  $("#line-trans").value = L.trans || "";
  $("#line-time").value = fmtTime(L.t);
  $("#line-delete").disabled = song.lines.length <= 1;
  const dlg = $("#line-dialog");
  if (!dlg.open) dlg.showModal();
}
// 편집 모드면 목록을 다시 그린다(줄 수/원문이 바뀐 경우)
function rerenderLines() {
  view.setSong(song);
  view.setEditable(appEl.classList.contains("edit-on"));
}
function wireLineDialog() {
  const dlg = $("#line-dialog");
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  // 시간 칸에 현재 재생 위치 담기
  $("#line-time-now").addEventListener("click", () => {
    $("#line-time").value = fmtTime(+(player.currentTime - (song.offset || 0)).toFixed(2));
  });
  $("#line-save").addEventListener("click", () => {
    if (lineDialogIdx < 0 || !song || !song.lines[lineDialogIdx]) return dlg.close();
    const L = song.lines[lineDialogIdx];
    const orig = $("#line-orig").value.trim();
    const pron = $("#line-pron").value.trim();
    const trans = $("#line-trans").value.trim();
    const origChanged = orig !== (L.orig || "");
    L.orig = orig;
    L.pron = pron;   L.pronSrc = pron ? "user" : undefined;   // 내가 직접 = 최우선
    L.trans = trans; L.transSrc = trans ? "user" : undefined;
    L.t = parseTime($("#line-time").value);                   // 빈칸이면 null(=타임 지움)
    if (origChanged) rerenderLines();
    else view.refreshRow(lineDialogIdx);
    updateAutofillBanner();
    persist();
    dlg.close();
  });

  // 낱개: 빈 줄 삽입 후 그 줄을 바로 편집
  const insertAt = (at) => {
    if (lineDialogIdx < 0 || !song) return;
    song.lines.splice(at, 0, { t: null, orig: "", pron: "", trans: "" });
    persist();
    rerenderLines();
    updateAutofillBanner();
    dlg.close();
    openLineDialog(at);
  };
  $("#line-insert-above").addEventListener("click", () => insertAt(lineDialogIdx));
  $("#line-insert-below").addEventListener("click", () => insertAt(lineDialogIdx + 1));

  $("#line-delete").addEventListener("click", () => {
    if (lineDialogIdx < 0 || !song) return;
    if (song.lines.length <= 1) { alert("마지막 한 줄은 지울 수 없어요."); return; }
    if (!confirm("이 줄을 삭제할까요?")) return;
    song.lines.splice(lineDialogIdx, 1);
    persist();
    rerenderLines();
    updateAutofillBanner();
    dlg.close();
  });
}

// ---------- 개별 붙여넣기 (한 줄) ----------
// 가사(원문): 지정 줄 위/아래에 새 줄로 삽입.  발음·번역: 지정 줄의 그 칸에 채움.
let singleMode = "orig";
function openSingle(mode) {
  if (!song || !song.lines.length) { alert("먼저 곡을 열어주세요."); return; }
  singleMode = mode;
  const label = { orig: "가사", pron: "발음", trans: "번역" }[mode];
  $("#single-title").textContent = `${label} 개별 붙여넣기`;
  $("#single-value-label").childNodes[0].nodeValue = label + " ";
  $("#single-value").value = "";
  const cur = view.activeIdx >= 0 ? view.activeIdx + 1 : 1;
  const inp = $("#single-line");
  inp.value = String(cur);
  inp.max = String(mode === "orig" ? song.lines.length : song.lines.length);
  $("#single-dialog").classList.toggle("mode-orig", mode === "orig");
  $("#single-dialog").showModal();
}
function wireSingleDialog() {
  const dlg = $("#single-dialog");
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  $("#single-orig").addEventListener("click", () => openSingle("orig"));
  $("#single-pron").addEventListener("click", () => openSingle("pron"));
  $("#single-trans").addEventListener("click", () => openSingle("trans"));
  $("#single-now").addEventListener("click", () => {
    if (view.activeIdx >= 0) $("#single-line").value = String(view.activeIdx + 1);
  });
  const lineNo = () => {
    const n = Math.round(Number($("#single-line").value));
    return Math.min(Math.max(isFinite(n) ? n : 1, 1), song.lines.length);
  };
  const insertOrig = (offset) => {                    // offset 0 = 그 줄 위, 1 = 그 줄 아래
    const v = $("#single-value").value.trim();
    const at = Math.min(Math.max(lineNo() - 1 + offset, 0), song.lines.length);
    song.lines.splice(at, 0, { t: null, orig: v, pron: "", trans: "" });
    persist(); rerenderLines(); updateAutofillBanner();
    dlg.close();
  };
  $("#single-above").addEventListener("click", () => insertOrig(0));
  $("#single-below").addEventListener("click", () => insertOrig(1));
  $("#single-set").addEventListener("click", () => {
    const v = $("#single-value").value.trim();
    const L = song.lines[lineNo() - 1];
    L[singleMode] = v;
    L[singleMode + "Src"] = v ? "user" : undefined;
    rerenderLines(); updateAutofillBanner(); persist();
    dlg.close();
  });
}

// ---------- 곡 목록 시트 ----------
// 곡은 지우지 않는다. "숨기기"로 목록에서만 감춘다 —
// 레코드가 남아 있어야 플레이리스트 참조가 깨지지 않는다.

// 현재 필터가 보여줄 곡들을, 보여줄 순서대로.
async function currentList() {
  const all = await allSongs();
  if (listFilter.type === "hidden") return all.filter((s) => s.hidden);
  if (listFilter.type === "playlist") {
    const pl = await getPlaylist(listFilter.id);
    if (!pl) { listFilter = { type: "all" }; saveListFilter(); return all.filter((s) => !s.hidden); }
    // 플리 안에서는 저장된 순서를 지킨다(최근 수정 순으로 다시 정렬하지 않는다)
    return pl.refs.map((r) => findByRef(all, r)).filter((s) => s && !s.hidden);
  }
  return all.filter((s) => !s.hidden);
}

function setFilter(f) {
  listFilter = f;
  saveListFilter();
  exitSelectMode();          // 필터를 바꾸면 선택 모드 해제
  exitEditMode();            // 편집 모드도 해제
  renderChips();
  renderList();
}

// 목록 "편집" 모드 끄기
function exitEditMode() {
  editMode = false;
  $("#list-edit").textContent = "편집";
  $("#pl-manage").hidden = true;
}

// --- 칩 바 ---
async function renderChips() {
  const wrap = $("#pl-chips");
  const [pls, all] = await Promise.all([allPlaylists(), allSongs()]);
  const hiddenCount = all.filter((s) => s.hidden).length;
  wrap.innerHTML = "";

  const chip = (label, active, onClick, cls = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pl-chip" + (active ? " active" : "") + (cls ? " " + cls : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    wrap.appendChild(b);
  };

  chip("전체", listFilter.type === "all", () => setFilter({ type: "all" }));
  for (const pl of pls) {
    chip(pl.name, listFilter.type === "playlist" && listFilter.id === pl.id,
      () => setFilter({ type: "playlist", id: pl.id }));
  }
  if (hiddenCount) {
    chip(`숨김 ${hiddenCount}`, listFilter.type === "hidden",
      () => setFilter({ type: "hidden" }), "chip-muted");
  }
  chip("＋ 새 플레이리스트", false, newPlaylist, "chip-add");

  const pl = listFilter.type === "playlist" ? pls.find((p) => p.id === listFilter.id) : null;
  $("#list-title").textContent =
    pl ? pl.name : listFilter.type === "hidden" ? "숨긴 곡" : "저장된 곡";
  // "편집"은 전체·플리 목록에서(숨긴 곡 관리 화면에선 숨김). "이름·삭제"는
  // 플리를 편집 모드로 볼 때만 딸려 나온다.
  $("#list-edit").hidden = listFilter.type === "hidden";
  $("#list-edit").textContent = editMode ? "편집 완료" : "편집";
  $("#pl-manage").hidden = !(pl && editMode);
  // 여러 곡 선택은 "전체" 목록에서만, 편집 모드일 땐 겹치니 숨긴다
  $("#select-toggle").hidden = listFilter.type !== "all" || editMode;
}

// --- 플레이리스트 만들기/이름 변경/삭제 ---
async function newPlaylist() {
  const name = (prompt("새 플레이리스트 이름") || "").trim();
  if (!name) return;
  const pl = await putPlaylist({ name, refs: [] });
  setFilter({ type: "playlist", id: pl.id });
}

async function managePlaylist() {
  const pl = await getPlaylist(listFilter.id);
  if (!pl) return;
  const name = prompt(`"${pl.name}" 이름 변경 (비우고 확인하면 이 플레이리스트 삭제)`, pl.name);
  if (name === null) return; // 취소
  if (!name.trim()) {
    if (!confirm(`플레이리스트 "${pl.name}" 을(를) 삭제할까요?\n담긴 곡은 지워지지 않습니다.`)) return;
    await deletePlaylist(pl.id);
    setFilter({ type: "all" });
    return;
  }
  pl.name = name.trim();
  await putPlaylist(pl);
  renderChips();
}

// --- 플레이리스트 안에서 순서 바꾸기 ---
// 화면 인덱스와 refs 인덱스는 다를 수 있다(숨긴 곡·사라진 곡은 화면에서 빠지므로).
// 그래서 화면에 보이는 이웃을 먼저 찾고, 그 둘의 refs 위치를 맞바꾼다.
async function moveInPlaylist(ref, dir) {
  const pl = await getPlaylist(listFilter.id);
  if (!pl) return;
  const all = await allSongs();
  const visible = pl.refs.filter((r) => { const s = findByRef(all, r); return s && !s.hidden; });
  const vi = visible.indexOf(ref);
  const neighbour = visible[vi + dir];
  if (vi < 0 || neighbour == null) return;
  const a = pl.refs.indexOf(ref), b = pl.refs.indexOf(neighbour);
  [pl.refs[a], pl.refs[b]] = [pl.refs[b], pl.refs[a]];
  await putPlaylist(pl);
  renderList();
}

async function removeFromPlaylist(ref) {
  const pl = await getPlaylist(listFilter.id);
  if (!pl) return;
  pl.refs = pl.refs.filter((r) => r !== ref);
  await putPlaylist(pl);
  renderList();
}

async function setHidden(s, hidden) {
  const full = await getSong(s.id);
  if (!full) return;
  if (hidden) full.hidden = true; else delete full.hidden;
  await putSong(full);
  renderChips();
  renderList();
}

// --- 목록 그리기 ---
function rowBtn(label, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "row-btn";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

async function renderList() {
  const wrap = $("#song-list-items");
  const list = await currentList();
  const inPlaylist = listFilter.type === "playlist";
  const inHidden = listFilter.type === "hidden";
  wrap.innerHTML = "";

  const empty = $("#song-list-empty");
  empty.hidden = list.length > 0;
  empty.textContent = inPlaylist
    ? "이 플레이리스트가 비어 있습니다. 전체 목록에서 ＋ 로 곡을 담으세요."
    : inHidden ? "숨긴 곡이 없습니다."
    : "아직 저장된 곡이 없습니다.";

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const ref = songRef(s);
    const li = document.createElement("li");
    li.className = "song-row" + (song && s.id === song.id ? " current" : "");

    if (selectMode) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "sel-check";
      cb.checked = selected.has(s.id);
      li.classList.toggle("sel-on", cb.checked);
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => toggleSelect(s.id, li));
      li.appendChild(cb);
    }

    const info = document.createElement("button");
    info.type = "button";
    info.className = "song-pick";
    info.innerHTML = `<span class="s-title"></span><span class="s-artist"></span>`;
    info.querySelector(".s-title").textContent = s.title || "제목 없음";
    info.querySelector(".s-artist").textContent =
      [s.artist, `${s.lines.length}줄`].filter(Boolean).join(" · ");
    info.addEventListener("click", async () => {
      if (selectMode) { toggleSelect(s.id, li); return; } // 선택 모드: 재생 대신 체크
      // 이 시점의 목록이 곧 재생 대기열이 된다(연속재생용)
      queue = list.map((x) => x.id);
      queueIndex = i;
      const full = await getSong(s.id);
      await loadSong(full, { autoplay: true });
      closeSheet();
      if (!full.youtubeId) openMeta(); // 영상 링크 없는 곡이면 바로 입력창
    });
    li.appendChild(info);

    if (inPlaylist) {
      if (editMode) {                         // "편집" 켰을 때만 순서·빼기 버튼
        const up = rowBtn("▲", "위로", () => moveInPlaylist(ref, -1));
        const down = rowBtn("▼", "아래로", () => moveInPlaylist(ref, +1));
        up.disabled = i === 0;
        down.disabled = i === list.length - 1;
        li.append(up, down, rowBtn("✕", "플레이리스트에서 빼기", () => removeFromPlaylist(ref)));
      }
    } else if (inHidden) {
      li.appendChild(rowBtn("숨김 해제", "다시 보이기", () => setHidden(s, false)));
    } else if (editMode) {                     // 전체 목록: "편집" 켰을 때만 담기·숨기기
      li.append(
        rowBtn("＋", "플레이리스트에 담기", () => openPlPick(s)),
        rowBtn("숨기기", "목록에서 숨기기", () => setHidden(s, true)),
      );
    }
    wrap.appendChild(li);
  }
  updateSheetBg();            // 목록·필터가 바뀔 때마다 배경 갱신
}

function openSheet() {
  $("#song-list").hidden = false;
  exitSelectMode();          // 열 때는 항상 일반 모드
  exitEditMode();
  renderChips();
  renderList();
}
function closeSheet() {
  $("#song-list").hidden = true;
  if (sheetBgUrl) { URL.revokeObjectURL(sheetBgUrl); sheetBgUrl = null; }
}

// ---------- 여러 곡 선택 → 한 번에 담기 ----------
function exitSelectMode() {
  selectMode = false;
  selected.clear();
  $("#song-list").classList.remove("select-mode");
  $("#select-toggle").textContent = "선택";
  updateSelectBar();
}

function updateSelectBar() {
  $("#select-bar").hidden = !selectMode;
  $("#sel-count").textContent = `${selected.size}곡 선택`;
  $("#sel-add").disabled = selected.size === 0;
}

function toggleSelect(id, li) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  const on = selected.has(id);
  li.classList.toggle("sel-on", on);
  const cb = li.querySelector(".sel-check");
  if (cb) cb.checked = on;
  updateSelectBar();
}

function wireSelectMode() {
  $("#select-toggle").addEventListener("click", () => {
    selectMode = !selectMode;
    selected.clear();
    if (selectMode && editMode) exitEditMode();     // 두 모드는 동시에 안 켠다
    $("#song-list").classList.toggle("select-mode", selectMode);
    $("#select-toggle").textContent = selectMode ? "선택 취소" : "선택";
    updateSelectBar();
    renderList();
  });

  $("#sel-all").addEventListener("click", async () => {
    const list = await currentList();
    const allOn = list.length > 0 && list.every((s) => selected.has(s.id));
    selected.clear();
    if (!allOn) list.forEach((s) => selected.add(s.id));
    updateSelectBar();
    renderList();
  });

  $("#sel-add").addEventListener("click", async () => {
    if (!selected.size) return;
    const chosen = (await allSongs()).filter((s) => selected.has(s.id));
    if (chosen.length) openPlPick(chosen);
  });
}

// ---------- 플레이리스트 담기 다이얼로그 ----------
// songs: 곡 하나 또는 곡 배열. 변경은 "완료"를 눌렀을 때 한꺼번에 반영한다.
async function openPlPick(songs) {
  plpickSongs = Array.isArray(songs) ? songs.slice() : [songs];
  const pls = await allPlaylists();
  const refs = plpickSongs.map(songRef);
  const ul = $("#plpick-list");
  ul.innerHTML = "";
  $("#plpick-empty").hidden = pls.length > 0;
  $("#plpick-song").textContent = plpickSongs.length === 1
    ? (plpickSongs[0].title || "제목 없음")
    : `${plpickSongs.length}곡 선택됨`;

  for (const pl of pls) {
    const inCount = refs.filter((r) => pl.refs.includes(r)).length;
    const li = document.createElement("li");
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = inCount === refs.length;                 // 전부 들어있을 때만 체크
    cb.indeterminate = inCount > 0 && inCount < refs.length;
    cb.dataset.plId = pl.id;
    cb.dataset.was = cb.checked ? "1" : "";
    const span = document.createElement("span");
    span.textContent = pl.name +
      (cb.indeterminate ? ` (${inCount}/${refs.length})` : "");
    lab.append(cb, span);
    li.appendChild(lab);
    ul.appendChild(li);
  }
  $("#plpick-dialog").showModal();
}

// "완료" 시: 체크된 플리에는 없는 곡을 뒤에 추가, 원래 전부 담겨 있었는데
// 체크를 해제한 플리에서는 이 곡들을 뺀다. 일부만 담긴(중간상태) 플리는 건드리지 않는다.
async function applyPlPick() {
  const refs = plpickSongs.map(songRef);
  const boxes = $("#plpick-list").querySelectorAll("input[type=checkbox]");
  for (const cb of boxes) {
    if (cb.checked === (cb.dataset.was === "1")) continue; // 변화 없음
    const pl = await getPlaylist(cb.dataset.plId);
    if (!pl) continue;
    if (cb.checked) {
      for (const r of refs) if (!pl.refs.includes(r)) pl.refs.push(r);
    } else {
      pl.refs = pl.refs.filter((r) => !refs.includes(r));
    }
    await putPlaylist(pl);
  }
  plpickSongs = [];
}

function wirePlPick() {
  const dlg = $("#plpick-dialog");
  dlg.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => { plpickSongs = []; dlg.close(); }));
  $("#plpick-done").addEventListener("click", async () => {
    await applyPlPick();
    dlg.close();
    if (selectMode) exitSelectMode();
    renderChips();
    renderList();
  });
}

// ---------- 대기열 이동 ----------
// 대기열이 비었거나 현재 곡과 어긋나면(앱 시작 직후 등) 지금 필터 목록으로 다시 만든다.
async function ensureQueue() {
  if (queueIndex < 0 || queue[queueIndex] !== (song && song.id)) {
    const list = await currentList();
    queue = list.map((s) => s.id);
    queueIndex = song ? queue.indexOf(song.id) : -1;
  }
  return queue.length > 0 && queueIndex >= 0;
}

// 대기열의 at 위치 곡을 재생(대기열이 유효하다고 가정). 범위를 벗어나면 순환한다.
async function playAt(at) {
  const n = queue.length;
  if (!n) return;
  at = ((at % n) + n) % n;
  const next = await getSong(queue[at]);
  if (!next) return;
  queueIndex = at;
  await loadSong(next, { autoplay: true });
}

// dir: +1 다음 곡 / -1 이전 곡. 양끝에서는 순환한다.
async function playAdjacent(dir) {
  if (!(await ensureQueue())) return;
  await playAt(queueIndex + dir);
}

// which: "first" 목록 첫 곡 / "last" 목록 마지막 곡
async function playEdge(which) {
  if (!(await ensureQueue())) return;
  await playAt(which === "first" ? 0 : queue.length - 1);
}

// ---------- 곡이 끝났을 때 ----------
async function onSongEnd() {
  if (endMode === "stop") return;

  // 한 곡 반복은 대기열과 무관하게 지금 곡을 다시 튼다
  if (endMode === "one") {
    player.seek(0);
    player.play();
    return;
  }

  // 전체 반복: 마지막 곡 다음은 첫 곡
  await playAdjacent(+1);
}

function renderEndMode() {
  const b = $("#repeat-btn");
  const ui = REPEAT_UI[endMode];
  b.innerHTML = ui.html;                       // 고정 문자열이라 안전
  b.title = `반복: ${ui.text}`;                // 화면에는 안 보이고 길게 눌렀을 때만
  b.setAttribute("aria-label", `반복 ${ui.text}`);
  b.classList.toggle("on", endMode !== "stop");
}

function wireEndMode() {
  $("#repeat-btn").addEventListener("click", () => {
    endMode = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(endMode) + 1) % REPEAT_CYCLE.length];
    localStorage.setItem("jlp:endMode", endMode);
    renderEndMode();
  });
  renderEndMode();
}

// ---------- 곡 추가 다이얼로그 ----------
function wireAddDialog() {
  const dlg = $("#add-dialog");
  $("#open-add").addEventListener("click", () => {
    $("#q-results").innerHTML = "";
    $("#q-status").textContent = "";
    dlg.showModal();
  });
  dlg.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => dlg.close())
  );

  // --- LRCLIB 검색 ---
  $("#q-run").addEventListener("click", async () => {
    const artist = $("#q-artist").value.trim();
    const title = $("#q-title").value.trim();
    if (!artist && !title) return;
    $("#q-status").textContent = "검색 중…";
    $("#q-results").innerHTML = "";
    try {
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.length) { $("#q-status").textContent = "결과 없음"; return; }
      $("#q-status").textContent = `${data.length}건`;
      for (const item of data.slice(0, 15)) {
        const li = document.createElement("li");
        const synced = !!item.syncedLyrics;
        li.className = "q-row" + (synced ? " synced" : "");
        const dur = item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.round(item.duration % 60)).padStart(2, "0")}` : "";
        li.innerHTML = `<b></b><small></small>`;
        li.querySelector("b").textContent = `${item.trackName || item.name} — ${item.artistName}`;
        li.querySelector("small").textContent = [item.albumName, dur, synced ? "싱크 가사" : "일반 가사"].filter(Boolean).join(" · ");
        li.addEventListener("click", async () => {
          const body = item.syncedLyrics || item.plainLyrics || "";
          const lines = parsePaste(body);
          if (!lines.length) { alert("가사를 가져오지 못했습니다."); return; }
          const saved = await putSong({
            title: item.trackName || item.name || title || "제목 없음",
            artist: item.artistName || artist,
            youtubeId: "",
            offset: 0,
            lines,
          });
          await loadSong(saved);
          dlg.close();
          // LRCLIB 에는 영상 정보가 없다 → 링크 입력 창을 바로 띄운다
          openMeta();
        });
        $("#q-results").appendChild(li);
      }
    } catch (e) {
      $("#q-status").textContent = "검색 실패: " + e.message;
    }
  });

  // --- 파일 ---
  $("#pick-file").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.lines)) throw new Error("lines 없음");
      delete data.id; // 새 레코드로
      tagImportedLines(data.lines);
      const saved = await putSong(data);
      await loadSong(saved);
      dlg.close();
    } catch (err) {
      alert("곡 파일을 읽지 못했습니다: " + err.message);
    }
  });

  // --- 직접 붙여넣기 ---
  $("#d-add").addEventListener("click", async () => {
    const lines = tagImportedLines(parsePaste($("#d-paste").value));
    if (!lines.length) { alert("가사를 붙여넣어 주세요."); return; }
    const saved = await putSong({
      title: $("#d-title").value.trim() || "제목 없음",
      artist: "",
      youtubeId: parseVideoId($("#d-youtube").value),
      offset: 0,
      lines,
    });
    await loadSong(saved);
    $("#d-paste").value = ""; $("#d-title").value = ""; $("#d-youtube").value = "";
    dlg.close();
    if (!saved.youtubeId) openMeta();
  });
}

// ---------- 곡 정보 다이얼로그 ----------
// 곡을 추가했는데 YouTube 링크가 없을 때도 이 창을 자동으로 띄운다.
function openMeta() {
  if (!song) { alert("먼저 곡을 열어주세요."); return; }
  $("#m-title").value = song.title || "";
  $("#m-artist").value = song.artist || "";
  $("#m-youtube").value = song.youtubeId || "";
  $("#m-offset").value = song.offset || 0;
  $("#m-image-file").value = "";
  refreshMetaImagePreview();
  $("#meta-dialog").showModal();
}

let metaImgUrl = null;
async function refreshMetaImagePreview() {
  const row = $("#m-image-row");
  const img = $("#m-image-preview");
  const note = $("#m-image-note");
  if (metaImgUrl) { URL.revokeObjectURL(metaImgUrl); metaImgUrl = null; }
  const rec = song && song.id ? await getImage(song.id) : null;
  if (rec && rec.blob) {
    metaImgUrl = URL.createObjectURL(rec.blob);
    img.src = metaImgUrl;
    row.classList.add("on");
    note.textContent = "이 기기에서 올린 이미지 (repo 이미지가 있으면 이게 우선)";
  } else if (song && song.image) {
    img.src = song.image;
    row.classList.add("on");
    note.textContent = "repo 에 커밋된 이미지. 여기서 새로 올리면 이 기기에서만 덮어씀";
  } else {
    img.removeAttribute("src");
    row.classList.remove("on");
    note.textContent = "";
  }
  // "제거" 는 이 기기 업로드가 있을 때만 의미가 있다
  $("#m-image-clear").style.display = rec && rec.blob ? "" : "none";
}

function wireMetaDialog() {
  const dlg = $("#meta-dialog");
  $("#open-meta").addEventListener("click", openMeta);
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));

  // 싱크 보정 −/+ (모바일 키보드에서 음수 입력이 어려워서 버튼으로)
  const bumpOffset = (d) => {
    const v = (parseFloat($("#m-offset").value) || 0) + d;
    $("#m-offset").value = String(Math.round(v * 10) / 10);
  };
  $("#m-offset-mm").addEventListener("click", () => bumpOffset(-0.5));
  $("#m-offset-m").addEventListener("click", () => bumpOffset(-0.1));
  $("#m-offset-p").addEventListener("click", () => bumpOffset(0.1));
  $("#m-offset-pp").addEventListener("click", () => bumpOffset(0.5));

  // 이미지: 고르는 즉시 저장(이 기기 IndexedDB). 저장소로는 안 올라간다.
  $("#m-image-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !song || !song.id) return;
    try {
      const blob = await downscaleImage(file);
      await putImage(song.id, blob);
      await refreshMetaImagePreview();
      if (song && song.id) applyArt();          // 현재 곡이면 화면에 바로 반영
    } catch (err) {
      alert("이미지를 저장하지 못했습니다: " + (err.message || err));
    }
  });
  $("#m-image-clear").addEventListener("click", async () => {
    if (!song || !song.id) return;
    await deleteImage(song.id);
    await refreshMetaImagePreview();
    applyArt();
  });

  $("#m-save").addEventListener("click", async () => {
    if (!song) return;
    const newId = parseVideoId($("#m-youtube").value);
    const videoChanged = newId !== song.youtubeId;
    song.title = $("#m-title").value.trim() || "제목 없음";
    song.artist = $("#m-artist").value.trim();
    song.youtubeId = newId;
    song.offset = parseFloat($("#m-offset").value) || 0;
    renderSyncVal();                       // 편집 모드 "전체 싱크" 표시도 갱신
    await persist();
    if (videoChanged && newId) await player.load(newId, { autoplay: true });
    dlg.close();
  });

  $("#m-export").addEventListener("click", () => {
    if (!song) return;
    const blob = new Blob([JSON.stringify(song, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(song.title || "song").replace(/[\\/:*?"<>|]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 삭제 대신 숨기기. 레코드는 남으므로 플레이리스트 참조가 깨지지 않고,
  // 목록의 "숨김" 칩에서 언제든 되돌릴 수 있다.
  $("#m-hide").addEventListener("click", async () => {
    if (!song) return;
    if (!confirm(`"${song.title}" 을(를) 목록에서 숨길까요?\n지워지지 않고, 목록의 "숨김" 에서 되돌릴 수 있습니다.`)) return;
    song.hidden = true;
    await persist();
    dlg.close();
    const rest = (await allSongs()).filter((s) => !s.hidden);
    if (rest.length) await loadSong(await getSong(rest[0].id));
    else { song = null; appEl.classList.remove("has-song"); view.setSong(null); }
  });
}

// ---------- 일괄 붙여넣기 ----------
function wireBulk() {
  const dlg = $("#bulk-dialog");
  const LABEL = { orig: "가사", pron: "발음", trans: "번역" };
  const open = (mode) => {
    if (!song) { alert("먼저 곡을 열어주세요."); return; }
    bulkMode = mode;
    $("#bulk-title").textContent = `${LABEL[mode]} 일괄 붙여넣기`;
    $("#bulk-count").textContent = `현재 가사 ${song.lines.length}줄`;
    $("#bulk-text").value = song.lines.map((l) => l[mode] || "").join("\n");
    dlg.showModal();
  };
  $("#paste-orig").addEventListener("click", () => open("orig"));
  $("#paste-pron").addEventListener("click", () => open("pron"));
  $("#paste-trans").addEventListener("click", () => open("trans"));
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));

  $("#bulk-apply").addEventListener("click", async () => {
    const parts = $("#bulk-text").value.split(/\r?\n/);
    if (parts.length !== song.lines.length &&
        !confirm(`줄 수가 다릅니다 (입력 ${parts.length} / 가사 ${song.lines.length}). 앞에서부터 맞춰 적용할까요?`)) return;
    const n = Math.min(parts.length, song.lines.length);
    for (let i = 0; i < n; i++) {
      const v = parts[i].trim();
      song.lines[i][bulkMode] = v;
      // 발음·번역만 출처 태그를 남긴다 (원문엔 Src 개념 없음)
      if (bulkMode !== "orig") song.lines[i][bulkMode + "Src"] = v ? "user" : undefined;
    }
    await persist();
    view.setSong(song);
    view.setEditable(appEl.classList.contains("edit-on"));
    updateAutofillBanner();
    dlg.close();
  });
}

// ---------- 자동 채우기 ----------
function wireAutofill() {
  const btn = $("#autofill-run");
  const msg = $("#autofill-msg");
  btn.addEventListener("click", async () => {
    if (!song) return;
    const target = song; // 실행 중 곡이 바뀌어도 안전하게
    btn.disabled = true;
    try {
      const r = await autofillSong(target, {
        onProgress: (done, total, phase) => { msg.textContent = `${phase} ${done}/${total}`; },
      });
      if (song === target) {
        await persist();
        view.setSong(song);
        view.setEditable(appEl.classList.contains("edit-on"));
      } else {
        await putSong(target);
      }
      msg.textContent = `발음 ${r.pron} · 번역 ${r.trans} 채움` + (r.failed ? ` (실패 ${r.failed})` : "");
      setTimeout(() => { msg.textContent = "발음·번역이 비어 있어요"; updateAutofillBanner(); }, 1800);
    } catch (e) {
      msg.textContent = "자동 채우기 실패: " + (e.message || e);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Wake Lock (재생·편집 중 화면 꺼짐 방지) ----------
async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch {}
}
function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch {}
  wakeLock = null;
}
function wakeLockShouldHold() {
  return player.isPlaying || appEl.classList.contains("edit-on");
}
// Wake Lock 은 탭이 가려지면 자동 해제되므로, 돌아왔을 때 필요하면 다시 확보
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeLockShouldHold()) acquireWakeLock();
});

// ---------- 번들 곡 동기화 ----------
// songs/index.json 에 적힌 곡 중, 라이브러리에 없는 건 추가하고
// version 이 올라간 건 덮어쓴다. 사용자가 직접 만든 곡(bundleId 없음)은 안 건드림.
async function syncBundledSongs() {
  try {
    await syncBundledSongsInner();
  } catch (e) {
    console.warn("bundled song sync skipped:", e);
  }
}
async function syncBundledSongsInner() {
  let manifest;
  try {
    const res = await fetch("songs/index.json", { cache: "no-cache" });
    if (!res.ok) return;
    manifest = await res.json();
  } catch { return; }

  const lib = await allSongs();
  for (const entry of manifest.songs || []) {
    const existing =
      lib.find((s) => s.bundleId === entry.bundleId) ||
      // bundleId 없던 예전 곡(예: 첫 배포 때 받은 napori)을 같은 곡으로 흡수
      lib.find((s) => !s.bundleId && s.title === entry.title && (!entry.artist || s.artist === entry.artist));

    if (existing && (existing.bundleVersion || 0) >= entry.version) continue;

    let data;
    try {
      const r = await fetch("songs/" + entry.file, { cache: "no-cache" });
      if (!r.ok) continue;
      data = await r.json();
    } catch { continue; }

    data.bundleId = entry.bundleId;
    data.bundleVersion = entry.version;

    // 번들 파일의 발음·번역 출처 태그 정리.
    // - 파일이 pronSrc/transSrc 를 명시했으면 그대로 존중 ("user" = 수작업 병합본 등)
    // - 명시 안 했으면 값이 있는 칸은 "hand"(Claude 손 품질)
    // - 어느 경우든 기존 레코드에서 내가 직접 고친("user") 칸은 보존
    for (let i = 0; i < data.lines.length; i++) {
      const nl = data.lines[i];
      const ol = existing && existing.lines[i];
      for (const f of ["pron", "trans"]) {
        if (ol && ol[f + "Src"] === "user") {
          nl[f] = ol[f];
          nl[f + "Src"] = "user";
        } else {
          nl[f + "Src"] = nl[f + "Src"] || (nl[f] ? "hand" : undefined);
        }
      }
    }

    if (existing) {
      data.id = existing.id;                              // 같은 레코드로 덮어쓰기
      if (!data.youtubeId && existing.youtubeId) data.youtubeId = existing.youtubeId; // 내가 넣은 링크 보존
      if (!data.offset && existing.offset) data.offset = existing.offset;
      if (existing.hidden) data.hidden = true;            // 숨김 상태도 보존(안 그러면 버전 올릴 때 되살아남)
    }
    await putSong(data);
  }
}

// ---------- repo 상태 동기화 (state.json) ----------
// 플레이리스트·숨김·설정을 repo 에 담아두고, 새 버전이면 이 기기에 덮어쓴다.
// (곡·이미지는 songs/ 와 img/ 로, 이건 개인 셋업 담당)
async function syncState() {
  let st;
  try {
    const res = await fetch("state.json", { cache: "no-cache" });
    if (!res.ok) return;                               // 아직 커밋 안 됨 → 조용히 통과
    st = await res.json();
  } catch { return; }
  const applied = +(localStorage.getItem("jlp:stateVersion") || 0);
  if (!st || +(st.version || 0) <= applied) return;    // 이미 반영한 버전

  // 숨김: state.json 목록과 정확히 일치시킨다(덮어쓰기)
  const want = new Set(st.hidden || []);
  for (const s of await allSongs()) {
    const on = want.has(songRef(s));
    if (!!s.hidden === on) continue;
    const full = await getSong(s.id);
    if (!full) continue;
    if (on) full.hidden = true; else delete full.hidden;
    await putSong(full);
  }

  // 플레이리스트: 전체 교체
  for (const p of await allPlaylists()) await deletePlaylist(p.id);
  for (const p of st.playlists || []) {
    if (p && p.name) await putPlaylist({ name: p.name, refs: Array.isArray(p.refs) ? p.refs : [] });
  }
  listFilter = { type: "all" };
  saveListFilter();

  // 설정
  if (st.settings) {
    if (REPEAT_CYCLE.includes(st.settings.endMode)) {
      endMode = st.settings.endMode;
      localStorage.setItem("jlp:endMode", endMode);
      renderEndMode();
    }
    if (typeof st.settings.showVideo === "boolean") setShowVideo(st.settings.showVideo);
  }

  localStorage.setItem("jlp:stateVersion", String(st.version));
}

// ---------- 전체 백업 / 복원 ----------
const blobToDataURL = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(fr.error || new Error("read fail"));
  fr.readAsDataURL(blob);
});
function dataURLToBlob(u) {
  const [head, b64] = String(u).split(",");
  const mime = (head.match(/:(.*?);/) || [])[1] || "image/webp";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 이 기기의 모든 것 → 파일 하나. 이미지는 data URL 로, songRef 를 키로 담는다.
async function exportBackup() {
  const songs = await allSongs();
  const playlists = (await allPlaylists()).map((p) => ({ name: p.name, refs: p.refs }));
  const images = {};
  for (const s of songs) {
    const rec = await getImage(s.id);
    if (rec && rec.blob) images[songRef(s)] = await blobToDataURL(rec.blob);
  }
  const backup = {
    app: "jp-lyrics-player",
    kind: "backup",
    exportedAt: new Date().toISOString(),
    songs,
    playlists,
    images,
    settings: {
      endMode,
      showVideo: localStorage.getItem("jlp:showVideo") === "1",
    },
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  downloadJSON(backup, `jlp-backup-${stamp}.json`);
}

// 백업 파일 → 이 기기. 곡/플리/이미지/설정을 그 상태로 덮어쓴다.
async function importBackup(obj) {
  if (!obj || obj.kind !== "backup" || !Array.isArray(obj.songs)) {
    alert("이 앱의 백업 파일이 아닙니다.");
    return;
  }
  const when = (obj.exportedAt || "").slice(0, 16).replace("T", " ");
  if (!confirm(`백업(${when})으로 이 기기의 곡·이미지·플레이리스트·설정을 덮어씁니다.\n계속할까요?`)) return;

  const lib = await allSongs();
  const imgBlobs = {};
  for (const [ref, u] of Object.entries(obj.images || {})) {
    try { imgBlobs[ref] = dataURLToBlob(u); } catch {}
  }

  for (const s of obj.songs) {
    const ref = s.bundleId ? "b:" + s.bundleId : "i:" + s.id;
    const target = s.bundleId
      ? lib.find((x) => x.bundleId === s.bundleId)
      : lib.find((x) => x.id === s.id);
    const rec = { ...s };
    if (target) rec.id = target.id;          // 이미 있으면 같은 레코드로
    const saved = await putSong(rec);        // 없으면 백업의 id 그대로(플리 i: 참조 유지)
    if (imgBlobs[ref]) await putImage(saved.id, imgBlobs[ref]);
  }

  for (const p of await allPlaylists()) await deletePlaylist(p.id);
  for (const p of obj.playlists || []) {
    if (p && p.name) await putPlaylist({ name: p.name, refs: Array.isArray(p.refs) ? p.refs : [] });
  }

  if (obj.settings) {
    if (REPEAT_CYCLE.includes(obj.settings.endMode)) localStorage.setItem("jlp:endMode", obj.settings.endMode);
    if (typeof obj.settings.showVideo === "boolean") localStorage.setItem("jlp:showVideo", obj.settings.showVideo ? "1" : "0");
  }
  localStorage.setItem("jlp:listFilter", JSON.stringify({ type: "all" }));
  await flush();                          // 쓰기가 다 커밋된 뒤에 새로고침
  alert("복원 완료. 새로고침합니다.");
  location.reload();
}

function wireBackup() {
  $("#backup-export").addEventListener("click", async () => {
    try { await exportBackup(); }
    catch (e) { alert("내보내기 실패: " + (e.message || e)); }
  });
  $("#backup-import").addEventListener("click", () => $("#backup-file").click());
  $("#backup-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { await importBackup(JSON.parse(await file.text())); }
    catch (err) { alert("가져오기 실패: " + (err.message || err)); }
  });
}

// ---------- 서비스 워커 + 새 버전 자동 새로고침 ----------
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  // 새 서비스워커가 제어권을 잡으면(= 새 버전 배포됨) 한 번 새로고침
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return; // 첫 설치 때는 무시
    refreshing = true;
    location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      // updateViaCache:"none" — sw.js 자체를 HTTP 캐시에서 읽지 않는다.
      // GitHub Pages 의 max-age=600 때문에, 이게 없으면 새 버전을 배포해도
      // 최대 10분간 옛 서비스워커가 살아 있어서 자동 새로고침이 걸리지 않는다.
      const reg = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
      // 앱을 오래 켜둔 경우에도 새 버전 확인: 주기적으로 + 포그라운드 복귀 시
      setInterval(() => reg.update().catch(() => {}), 60000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    } catch {}
  });
}

// ---------- 시작 ----------
async function main() {
  view = new LyricsView($("#lyrics-list"), {
    onSeekToLine: (t) => player.seek(t),
    onEditRow: openLineDialog,
  });
  wireControls();
  wireAddDialog();
  wireMetaDialog();
  wireBulk();
  wireAutofill();
  wireLineDialog();
  wireSingleDialog();
  wirePlPick();
  wireSelectMode();
  wireBackup();
  $("#open-list").addEventListener("click", openSheet);
  $("#close-list").addEventListener("click", closeSheet);
  $("#song-list").addEventListener("click", (e) => { if (e.target.id === "song-list") closeSheet(); });
  $("#pl-manage").addEventListener("click", managePlaylist);
  $("#list-edit").addEventListener("click", () => {
    editMode = !editMode;
    if (editMode && selectMode) exitSelectMode();   // 두 모드는 동시에 안 켠다
    $("#list-edit").textContent = editMode ? "편집 완료" : "편집";
    $("#pl-manage").hidden = !(editMode && listFilter.type === "playlist");
    $("#select-toggle").hidden = listFilter.type !== "all" || editMode;
    renderList();
  });
  wireEndMode();

  // 재생 상태에 따라 Wake Lock 확보/해제 + 곡이 끝나면 설정대로
  player.onStateChange((state) => {
    if (state === 1) acquireWakeLock();                 // 재생
    // 종료(0) 후 이어서 재생할 거면 Wake Lock 을 놓지 않는다
    else if ((state === 2 || (state === 0 && endMode === "stop")) && !appEl.classList.contains("edit-on")) releaseWakeLock();
    if (state === 0) onSongEnd();                       // 종료 → 다음 곡 / 반복
    // 목록을 열어둔 채 재생/일시정지가 바뀌면 배경(영상 tier)도 갱신
    if ((state === 1 || state === 2) && !$("#song-list").hidden) updateSheetBg();
  });

  await migrateLegacy();
  await syncBundledSongs();
  await syncState();

  let start = null;
  const lastId = getLastId();
  if (lastId) start = await getSong(lastId);
  if (!start) {
    const list = (await allSongs()).filter((s) => !s.hidden);
    if (list.length) start = await getSong(list[0].id);
  }
  if (start) await loadSong(start);

  requestAnimationFrame(tick);
}
main();
