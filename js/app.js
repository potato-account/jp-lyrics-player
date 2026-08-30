import { Player, parseVideoId } from "./player.js";
import { LyricsView, parsePaste, toLrc } from "./lyrics.js";

const $ = (s) => document.querySelector(s);
const appEl = $("#app");

// ---- 상태 ----
let song = null;                 // 현재 곡 데이터
const player = new Player("player");
let view;
let wakeLock = null;             // 편집/재생 중 화면 꺼짐 방지

// ---- 저장(localStorage) ----
// 곡 하나만 우선 다룬다. 키 하나에 마지막 곡을 통째로 저장.
const LS_KEY = "jlp:lastSong";
function saveSong() {
  if (song) localStorage.setItem(LS_KEY, JSON.stringify(song));
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---- 곡 적용 ----
async function applySong(next, { autoplayOff = true } = {}) {
  song = next;
  if (song.offset == null) song.offset = 0;
  appEl.classList.toggle("has-song", !!song && song.lines.length > 0);
  view.setSong(song);
  $("#time-dur").textContent = "0:00";
  saveSong();
  if (song.youtubeId) {
    await player.load(song.youtubeId);
    if (!autoplayOff) player.play();
  }
}

// ---- 시간 표기 ----
function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ================= 메인 루프 =================
// 재생 위치를 주기적으로 읽어 가사/시크바를 갱신한다.
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

// ================= 컨트롤 배선 =================
function wireControls() {
  $("#playpause").addEventListener("click", () => {
    player.isPlaying ? player.pause() : player.play();
  });
  $("#back5").addEventListener("click", () => player.seek(player.currentTime - 5));
  $("#fwd5").addEventListener("click", () => player.seek(player.currentTime + 5));

  const bar = $("#seekbar");
  const startSeek = () => (seeking = true);
  const endSeek = () => {
    seeking = false;
    const dur = player.duration;
    if (dur) player.seek((bar.value / 1000) * dur);
  };
  bar.addEventListener("pointerdown", startSeek);
  bar.addEventListener("pointerup", endSeek);
  bar.addEventListener("change", endSeek);

  // 영상 접기/펴기
  $("#toggle-video").addEventListener("click", () => {
    const v = $("#video-area");
    const collapsed = v.classList.toggle("video-collapsed");
    v.classList.toggle("video-expanded", !collapsed);
  });

  // 편집 모드
  $("#edit-mode").addEventListener("click", () => {
    const on = appEl.classList.toggle("edit-on");
    $("#edit-mode").textContent = on ? "편집 끝(내보내기)" : "싱크 편집";
    if (on) requestWakeLock();
    else exportSong();
  });

  $("#open-song").addEventListener("click", () => $("#file-input").click());
  $("#new-song").addEventListener("click", () => openSongDialog());

  $("#file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.lines)) throw new Error("lines 없음");
      await applySong(data);
    } catch (err) {
      alert("곡 파일을 읽지 못했습니다: " + err.message);
    }
    e.target.value = "";
  });
}

// ---- 편집: 현재 재생 시각을 i번째 줄에 찍기 ----
function setLineTime(i) {
  if (!song) return;
  song.lines[i].t = +(player.currentTime - (song.offset || 0)).toFixed(2);
  view.refreshRow(i);
  saveSong();
}

// ---- 편집 결과 JSON 파일로 내보내기 ----
function exportSong() {
  if (!song) return;
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(song.title || "song").replace(/[\\/:*?"<>|]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ================= 새 곡 다이얼로그 =================
function openSongDialog() {
  const dlg = $("#song-dialog");
  const form = $("#song-form");
  form.reset();
  dlg.showModal();

  form.onsubmit = async (e) => {
    // method=dialog 라 기본 동작(닫기)은 두고, 값만 읽는다.
    const btn = e.submitter && e.submitter.value;
    if (btn !== "ok") return;
    const fd = new FormData(form);
    const lines = parsePaste(fd.get("paste") || "");
    const next = {
      title: (fd.get("title") || "").trim() || "제목 없음",
      artist: (fd.get("artist") || "").trim(),
      youtubeId: parseVideoId(fd.get("youtube") || ""),
      offset: 0,
      lines: lines.length ? lines : [{ t: null, orig: "", pron: "", trans: "" }],
    };
    await applySong(next);
    // 타임이 하나도 없으면 편집 모드로 안내
    if (!next.lines.some((l) => l.t != null)) {
      appEl.classList.add("edit-on");
      $("#edit-mode").textContent = "편집 끝(내보내기)";
      requestWakeLock();
    }
  };
}

// ================= 화면 꺼짐 방지 =================
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && appEl.classList.contains("edit-on")) requestWakeLock();
});

// ================= 서비스 워커 =================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ================= 시작 =================
async function main() {
  view = new LyricsView($("#lyrics-list"), {
    onSeekToLine: (t) => player.seek(t),
    onSetTime: setLineTime,
  });
  wireControls();

  player.onStateChange(() => {});

  const saved = loadSaved();
  if (saved && Array.isArray(saved.lines)) {
    await applySong(saved);
  } else {
    // 첫 실행: 샘플 곡 시도 (없으면 조용히 무시)
    try {
      const res = await fetch("songs/napori.json");
      if (res.ok) await applySong(await res.json());
    } catch {}
  }

  requestAnimationFrame(tick);
}
main();
