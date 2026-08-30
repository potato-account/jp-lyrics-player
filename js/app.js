import { Player, parseVideoId } from "./player.js";
import { LyricsView, parsePaste } from "./lyrics.js";
import { allSongs, getSong, putSong, deleteSong, getLastId, setLastId, migrateLegacy } from "./store.js";

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
  $("#time-dur").textContent = "0:00";
  $("#time-cur").textContent = "0:00";
  $("#seekbar").value = "0";
  if (song.youtubeId) await player.load(song.youtubeId, { autoplay });
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

  $("#edit-mode").addEventListener("click", () => {
    const on = appEl.classList.toggle("edit-on");
    $("#edit-mode").textContent = on ? "편집 끝" : "편집";
    view.setEditable(on);
    if (on) requestWakeLock();
    else persist();
  });
}

// ---------- 편집: 타임/칸 ----------
function setLineTime(i) {
  if (!song) return;
  song.lines[i].t = +(player.currentTime - (song.offset || 0)).toFixed(2);
  view.refreshRow(i);
  persist();
}
function editLine(i, field, value) {
  if (!song) return;
  song.lines[i][field] = value;
  persist();
}

// ---------- 곡 목록 시트 ----------
async function renderList() {
  const wrap = $("#song-list-items");
  const list = await allSongs();
  wrap.innerHTML = "";
  $("#song-list-empty").hidden = list.length > 0;
  for (const s of list) {
    const li = document.createElement("li");
    li.className = "song-row" + (song && s.id === song.id ? " current" : "");
    const info = document.createElement("button");
    info.type = "button";
    info.className = "song-pick";
    info.innerHTML = `<span class="s-title"></span><span class="s-artist"></span>`;
    info.querySelector(".s-title").textContent = s.title || "제목 없음";
    info.querySelector(".s-artist").textContent = [s.artist, `${s.lines.length}줄`].filter(Boolean).join(" · ");
    info.addEventListener("click", async () => {
      const full = await getSong(s.id);
      await loadSong(full, { autoplay: true });
      closeSheet();
      if (!full.youtubeId) openMeta(); // 영상 링크 없는 곡이면 바로 입력창
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "song-del";
    del.textContent = "🗑";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`"${s.title}" 삭제할까요?`)) return;
      await deleteSong(s.id);
      if (song && s.id === song.id) {
        const rest = await allSongs();
        if (rest.length) await loadSong(await getSong(rest[0].id));
        else { song = null; appEl.classList.remove("has-song"); view.setSong(null); }
      }
      renderList();
    });
    li.append(info, del);
    wrap.appendChild(li);
  }
}
function openSheet() { $("#song-list").hidden = false; renderList(); }
function closeSheet() { $("#song-list").hidden = true; }

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
      const saved = await putSong(data);
      await loadSong(saved);
      dlg.close();
    } catch (err) {
      alert("곡 파일을 읽지 못했습니다: " + err.message);
    }
  });

  // --- 직접 붙여넣기 ---
  $("#d-add").addEventListener("click", async () => {
    const lines = parsePaste($("#d-paste").value);
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

  $("#m-delete").addEventListener("click", async () => {
    if (!song) return;
    if (!confirm(`"${song.title}" 삭제할까요?`)) return;
    await deleteSong(song.id);
    const rest = await allSongs();
    dlg.close();
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
    for (let i = 0; i < n; i++) song.lines[i][bulkMode] = parts[i].trim();
    await persist();
    view.setSong(song);
    view.setEditable(appEl.classList.contains("edit-on"));
    dlg.close();
  });
}

// ---------- Wake Lock ----------
async function requestWakeLock() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && appEl.classList.contains("edit-on")) requestWakeLock();
});

// ---------- 서비스 워커 ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---------- 시작 ----------
async function main() {
  view = new LyricsView($("#lyrics-list"), {
    onSeekToLine: (t) => player.seek(t),
    onSetTime: setLineTime,
    onEditLine: editLine,
  });
  wireControls();
  wireAddDialog();
  wireMetaDialog();
  wireBulk();
  $("#open-list").addEventListener("click", openSheet);
  $("#close-list").addEventListener("click", closeSheet);
  $("#song-list").addEventListener("click", (e) => { if (e.target.id === "song-list") closeSheet(); });

  await migrateLegacy();

  let start = null;
  const lastId = getLastId();
  if (lastId) start = await getSong(lastId);
  if (!start) {
    const list = await allSongs();
    if (list.length) start = await getSong(list[0].id);
  }
  if (!start) {
    try {
      const res = await fetch("songs/napori.json");
      if (res.ok) start = await putSong(await res.json());
    } catch {}
  }
  if (start) await loadSong(start);

  requestAnimationFrame(tick);
}
main();
