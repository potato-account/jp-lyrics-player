// 가사 데이터 모델 + 붙여넣기 파서 + 렌더링/싱크.

// 곡 데이터 형식:
// {
//   title, artist, youtubeId,
//   offset: 0,                       // 전체 타임을 초 단위로 밀기(양수=늦게)
//   lines: [ { t: 14.99, orig, pron, trans }, ... ]   // t 가 null 이면 아직 싱크 안 됨
// }

// ---- 붙여넣기 텍스트 → lines 배열 ----
// 지원 형식(줄 단위 자동 감지):
//  1) "[mm:ss.xx] 가사"      → LRCLIB syncedLyrics 그대로. t 채워짐.
//  2) "원문 | 발음 | 번역"    → | 로 나눔. t 는 null.
//  3) "원문"                 → 원문만. t 는 null.
export function parsePaste(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const lrc = line.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (lrc) {
      const [, mm, ss, frac, rest] = lrc;
      const t = (+mm) * 60 + (+ss) + (frac ? +("0." + frac) : 0);
      const cols = splitCols(rest);
      lines.push({ t, orig: cols[0] || "", pron: cols[1] || "", trans: cols[2] || "" });
      continue;
    }

    const cols = splitCols(line);
    lines.push({ t: null, orig: cols[0] || "", pron: cols[1] || "", trans: cols[2] || "" });
  }
  return lines;
}

function splitCols(s) {
  if (s.includes("|")) return s.split("|").map((x) => x.trim());
  if (s.includes("\t")) return s.split("\t").map((x) => x.trim());
  return [s.trim()];
}

// ---- 내보내기용 LRC 텍스트 (원문 + 타임만) ----
export function toLrc(song) {
  return song.lines
    .filter((l) => l.t != null)
    .map((l) => `[${fmtLrc(l.t)}] ${l.orig}`)
    .join("\n");
}
function fmtLrc(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
}

// ================= 렌더링 & 싱크 =================
export class LyricsView {
  constructor(listEl, { onSeekToLine, onSetTime }) {
    this.listEl = listEl;
    this.scroller = listEl.parentElement;      // #lyrics
    this.onSeekToLine = onSeekToLine;
    this.onSetTime = onSetTime;
    this.song = null;
    this.rows = [];
    this.activeIdx = -1;
    this._userScrollUntil = 0;

    // 사용자가 손으로 스크롤하면 잠시 자동 스크롤을 멈춘다.
    this.scroller.addEventListener("wheel", () => this._pauseAutoScroll(), { passive: true });
    this.scroller.addEventListener("touchmove", () => this._pauseAutoScroll(), { passive: true });
  }

  _pauseAutoScroll() { this._userScrollUntil = performance.now() + 4000; }

  setSong(song) {
    this.song = song;
    this.activeIdx = -1;
    this.render();
  }

  render() {
    this.listEl.innerHTML = "";
    this.rows = [];
    if (!this.song) return;

    this.song.lines.forEach((line, i) => {
      const li = document.createElement("li");
      li.className = "lyric-line";
      li.dataset.idx = i;

      const body = document.createElement("div");
      body.innerHTML =
        `<div class="orig"></div><div class="pron"></div><div class="trans"></div>`;
      body.querySelector(".orig").textContent = line.orig || " ";
      body.querySelector(".pron").textContent = line.pron || "";
      body.querySelector(".trans").textContent = line.trans || "";
      li.appendChild(body);

      // 편집 모드용 "현재 시각으로 찍기" 버튼
      const setBtn = document.createElement("button");
      setBtn.type = "button";
      setBtn.className = "set-time" + (line.t != null ? " has-time" : "");
      setBtn.textContent = line.t != null ? fmtClock(line.t) : "찍기";
      setBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onSetTime(i);
      });
      li.appendChild(setBtn);

      // 줄 탭 → 그 줄 시작으로 이동(타임 있을 때만)
      li.addEventListener("click", () => {
        if (line.t != null) this.onSeekToLine(line.t + (this.song.offset || 0));
      });

      this.listEl.appendChild(li);
      this.rows.push({ li, setBtn });
    });
  }

  // 편집 중 한 줄의 타임이 바뀌면 그 버튼 라벨만 갱신
  refreshRow(i) {
    const line = this.song.lines[i];
    const { setBtn } = this.rows[i];
    setBtn.textContent = line.t != null ? fmtClock(line.t) : "찍기";
    setBtn.classList.toggle("has-time", line.t != null);
  }

  // 재생 위치(now, 초)에 맞춰 현재 줄 갱신
  update(now) {
    if (!this.song) return;
    const off = this.song.offset || 0;
    let idx = -1;
    for (let i = 0; i < this.song.lines.length; i++) {
      const t = this.song.lines[i].t;
      if (t != null && t + off <= now) idx = i;
      else if (t != null && t + off > now) break;
    }
    if (idx === this.activeIdx) return;

    if (this.rows[this.activeIdx]) {
      this.rows[this.activeIdx].li.classList.remove("is-active");
    }
    this.activeIdx = idx;
    const row = this.rows[idx];
    if (!row) return;
    row.li.classList.add("is-active");

    this.rows.forEach((r, i) => r.li.classList.toggle("is-past", i < idx));

    // 편집 모드거나 사용자가 방금 스크롤했으면 자동 스크롤 생략
    if (document.getElementById("app").classList.contains("edit-on")) return;
    if (performance.now() < this._userScrollUntil) return;
    row.li.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function fmtClock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
export { fmtClock };
