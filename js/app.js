import { Player, parseVideoId } from "./player.js";
import { LyricsView, parsePaste } from "./lyrics.js";
import { allSongs, getSong, putSong, deleteSong, getLastId, setLastId, migrateLegacy } from "./store.js";
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
      const reg = await navigator.serviceWorker.register("sw.js");
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
  $("#open-list").addEventListener("click", openSheet);
  $("#close-list").addEventListener("click", closeSheet);
  $("#song-list").addEventListener("click", (e) => { if (e.target.id === "song-list") closeSheet(); });

  // 재생 상태에 따라 Wake Lock 확보/해제
  player.onStateChange((state) => {
    if (state === 1) acquireWakeLock();                 // 재생
    else if ((state === 2 || state === 0) && !appEl.classList.contains("edit-on")) releaseWakeLock(); // 일시정지/종료
  });

  await migrateLegacy();
  await syncBundledSongs();

  let start = null;
  const lastId = getLastId();
  if (lastId) start = await getSong(lastId);
  if (!start) {
    const list = await allSongs();
    if (list.length) start = await getSong(list[0].id);
  }
  if (start) await loadSong(start);

  requestAnimationFrame(tick);
}
main();
