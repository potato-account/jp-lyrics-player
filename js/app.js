import { Player, parseVideoId } from "./player.js";
import { LyricsView, parsePaste } from "./lyrics.js";
import {
  allSongs, getSong, putSong, getLastId, setLastId, migrateLegacy,
  allPlaylists, getPlaylist, putPlaylist, deletePlaylist, songRef, findByRef,
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
  updateAutofillBanner();
  $("#time-dur").textContent = "0:00";
  $("#time-cur").textContent = "0:00";
  $("#seekbar").value = "0";
  if (song.youtubeId) await player.load(song.youtubeId, { autoplay });
}

// 발음·번역이 비어 있으면 상단에 "자동 채우기" 배너 표시
function updateAutofillBanner() {
  appEl.classList.toggle("needs-autofill", hasFillable(song));
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

  $("#toggle-video").addEventListener("click", () => {
    const v = $("#video-area");
    const collapsed = v.classList.toggle("video-collapsed");
    v.classList.toggle("video-expanded", !collapsed);
  });

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
    view.setEditable(on);
    if (on) acquireWakeLock();
    else { persist(); if (!player.isPlaying) releaseWakeLock(); }
  });
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

let timeDialogIdx = -1;
function openTimeDialog(i) {
  if (!song) return;
  timeDialogIdx = i;
  $("#time-line-orig").textContent = song.lines[i].orig || "";
  $("#time-value").value = fmtTime(song.lines[i].t);
  $("#time-dialog").showModal();
  $("#time-value").focus();
}
function wireTimeDialog() {
  const dlg = $("#time-dialog");
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  // 현재 재생 위치 담기
  $("#time-now").addEventListener("click", () => {
    $("#time-value").value = fmtTime(+(player.currentTime - (song.offset || 0)).toFixed(2));
  });
  $("#time-ok").addEventListener("click", () => {
    if (timeDialogIdx < 0 || !song) return dlg.close();
    song.lines[timeDialogIdx].t = parseTime($("#time-value").value); // 빈칸이면 null(=타임 지움)
    view.refreshRow(timeDialogIdx);
    persist();
    dlg.close();
  });
}

// 타임 버튼 클릭 → 다이얼로그 (예전처럼 즉시 0:00 으로 안 감)
function setLineTime(i) { openTimeDialog(i); }

function editLine(i, field, value) {
  if (!song) return;
  song.lines[i][field] = value;
  song.lines[i][field + "Src"] = value ? "user" : undefined; // 내가 직접 = 최우선
  updateAutofillBanner();
  persist();
}

// 줄 저장 버튼: 그 줄의 현재 발음/번역(DOM)을 확정 저장
function saveLine(i, pron, trans) {
  if (!song) return;
  song.lines[i].pron = pron;
  song.lines[i].pronSrc = pron ? "user" : undefined;
  song.lines[i].trans = trans;
  song.lines[i].transSrc = trans ? "user" : undefined;
  updateAutofillBanner();
  persist();
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
  renderChips();
  renderList();
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

  // 제목 + 이름·삭제 버튼은 플리를 보고 있을 때만
  const pl = listFilter.type === "playlist" ? pls.find((p) => p.id === listFilter.id) : null;
  $("#list-title").textContent =
    pl ? pl.name : listFilter.type === "hidden" ? "숨긴 곡" : "저장된 곡";
  $("#pl-manage").hidden = !pl;
  // 여러 곡 선택은 "전체" 목록에서만 (플리 안에서는 순서·빼기 버튼과 겹친다)
  $("#select-toggle").hidden = listFilter.type !== "all";
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
      const up = rowBtn("▲", "위로", () => moveInPlaylist(ref, -1));
      const down = rowBtn("▼", "아래로", () => moveInPlaylist(ref, +1));
      up.disabled = i === 0;
      down.disabled = i === list.length - 1;
      li.append(up, down, rowBtn("✕", "플레이리스트에서 빼기", () => removeFromPlaylist(ref)));
    } else if (inHidden) {
      li.appendChild(rowBtn("↩", "다시 보이기", () => setHidden(s, false)));
    } else {
      li.append(
        rowBtn("＋", "플레이리스트에 담기", () => openPlPick(s)),
        rowBtn("🙈", "목록에서 숨기기", () => setHidden(s, true)),
      );
    }
    wrap.appendChild(li);
  }
}

function openSheet() {
  $("#song-list").hidden = false;
  exitSelectMode();          // 열 때는 항상 일반 모드
  renderChips();
  renderList();
}
function closeSheet() { $("#song-list").hidden = true; }

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
  $("#meta-dialog").showModal();
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

  $("#m-save").addEventListener("click", async () => {
    if (!song) return;
    const newId = parseVideoId($("#m-youtube").value);
    const videoChanged = newId !== song.youtubeId;
    song.title = $("#m-title").value.trim() || "제목 없음";
    song.artist = $("#m-artist").value.trim();
    song.youtubeId = newId;
    song.offset = parseFloat($("#m-offset").value) || 0;
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
  const open = (mode) => {
    if (!song) { alert("먼저 곡을 열어주세요."); return; }
    bulkMode = mode;
    $("#bulk-title").textContent = mode === "pron" ? "발음 일괄 붙여넣기" : "번역 일괄 붙여넣기";
    $("#bulk-count").textContent = `현재 가사 ${song.lines.length}줄`;
    $("#bulk-text").value = song.lines.map((l) => l[mode] || "").join("\n");
    dlg.showModal();
  };
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
      song.lines[i][bulkMode + "Src"] = v ? "user" : undefined; // 붙여넣기도 내가 직접
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
    onSetTime: setLineTime,
    onEditLine: editLine,
    onSaveLine: saveLine,
  });
  wireControls();
  wireAddDialog();
  wireMetaDialog();
  wireBulk();
  wireAutofill();
  wireTimeDialog();
  wirePlPick();
  wireSelectMode();
  $("#open-list").addEventListener("click", openSheet);
  $("#close-list").addEventListener("click", closeSheet);
  $("#song-list").addEventListener("click", (e) => { if (e.target.id === "song-list") closeSheet(); });
  $("#pl-manage").addEventListener("click", managePlaylist);
  wireEndMode();

  // 재생 상태에 따라 Wake Lock 확보/해제 + 곡이 끝나면 설정대로
  player.onStateChange((state) => {
    if (state === 1) acquireWakeLock();                 // 재생
    // 종료(0) 후 이어서 재생할 거면 Wake Lock 을 놓지 않는다
    else if ((state === 2 || (state === 0 && endMode === "stop")) && !appEl.classList.contains("edit-on")) releaseWakeLock();
    if (state === 0) onSongEnd();                       // 종료 → 다음 곡 / 반복
  });

  await migrateLegacy();
  await syncBundledSongs();

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
