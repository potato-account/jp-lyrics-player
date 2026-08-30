// 가사 데이터 모델 + 붙여넣기 파서 + 렌더링/싱크.

// 곡 데이터 형식:
// { id, title, artist, youtubeId, offset, updatedAt,
//   lines: [ { t: 14.99|null, orig, pron, trans } ] }

// ---- 붙여넣기 텍스트 → lines 배열 ----
// 줄 단위 자동 감지:
//  1) "[mm:ss.xx] 가사"      → LRCLIB syncedLyrics. t 채워짐.
//  2) "원문 | 발음 | 번역"    → | 로 나눔. t 는 null.
//  3) "원문"                 → 원문만. t 는 null.
// "[ar: ...]" 같은 메타 태그 줄은 건너뜀.
export function parsePaste(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[[a-z]{2,}:/i.test(line)) continue; // [ar:], [ti:], [length:] 등

    const lrc = line.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (lrc) {
      const [, mm, ss, frac, rest] = lrc;
      const t = (+mm) * 60 + (+ss) + (frac ? +("0." + frac.padEnd(2, "0")) : 0);
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

// ================= 렌더링 & 싱크 =================
export class LyricsView {
  constructor(listEl, { onSeekToLine, onSetTime, onEditLine }) {
    this.listEl = listEl;
    this.scroller = listEl.parentElement; // #lyrics
    this.onSeekToLine = onSeekToLine;
    this.onSetTime = onSetTime;
    this.onEditLine = onEditLine || (() => {});
    this.song = null;
    this.rows = [];
    this.activeIdx = -1;
    this.editable = false;
    this._userScrollUntil = 0;

    this.scroller.addEventListener("wheel", () => this._pauseAutoScroll(), { passive: true });
    this.scroller.addEventListener("touchmove", () => this._pauseAutoScroll(), { passive: true });
  }

  _pauseAutoScroll() { this._userScrollUntil = performance.now() + 4000; }

  setSong(song) {
    this.song = song;
    this.activeIdx = -1;
    this.render();
  }

  setEditable(on) {
    this.editable = on;
    for (const { pronEl, transEl } of this.rows) {
      pronEl.contentEditable = on ? "true" : "false";
      transEl.contentEditable = on ? "true" : "false";
    }
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
      const origEl = el("div", "orig", line.orig || " ");
      const pronEl = el("div", "pron", line.pron || "");
      const transEl = el("div", "trans", line.trans || "");
      body.append(origEl, pronEl, transEl);
      li.appendChild(body);

      // 편집: 칸 직접 수정
      for (const [field, node] of [["pron", pronEl], ["trans", transEl]]) {
        node.contentEditable = this.editable ? "true" : "false";
        node.addEventListener("blur", () => {
          const v = node.textContent.trim();
          if (v !== (this.song.lines[i][field] || "")) this.onEditLine(i, field, v);
        });
        node.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); node.blur(); }
        });
      }

      // 편집: 현재 시각으로 타임 찍기
      const setBtn = document.createElement("button");
      setBtn.type = "button";
      setBtn.className = "set-time" + (line.t != null ? " has-time" : "");
      setBtn.textContent = line.t != null ? fmtClock(line.t) : "찍기";
      setBtn.addEventListener("click", (e) => { e.stopPropagation(); this.onSetTime(i); });
      li.appendChild(setBtn);

      // 줄 탭 → 그 줄로 이동 (편집 모드에서는 무시)
      li.addEventListener("click", (e) => {
        if (this.editable) return;
        if (e.target.closest(".set-time")) return;
        if (line.t != null) this.onSeekToLine(line.t + (this.song.offset || 0));
      });

      this.listEl.appendChild(li);
      this.rows.push({ li, setBtn, pronEl, transEl });
    });
  }

  refreshRow(i) {
    const line = this.song.lines[i];
    const r = this.rows[i];
    if (!r) return;
    r.setBtn.textContent = line.t != null ? fmtClock(line.t) : "찍기";
    r.setBtn.classList.toggle("has-time", line.t != null);
    if (document.activeElement !== r.pronEl) r.pronEl.textContent = line.pron || "";
    if (document.activeElement !== r.transEl) r.transEl.textContent = line.trans || "";
  }

  update(now) {
    if (!this.song) return;
    const off = this.song.offset || 0;
    let idx = -1;
    for (let i = 0; i < this.song.lines.length; i++) {
      const t = this.song.lines[i].t;
      if (t == null) continue;
      if (t + off <= now) idx = i;
      else break;
    }
    if (idx === this.activeIdx) return;

    if (this.rows[this.activeIdx]) this.rows[this.activeIdx].li.classList.remove("is-active");
    this.activeIdx = idx;
    const row = this.rows[idx];
    if (!row) return;
    row.li.classList.add("is-active");
    this.rows.forEach((r, i) => r.li.classList.toggle("is-past", i < idx));

    if (this.editable) return;
    if (performance.now() < this._userScrollUntil) return;
    row.li.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}
function fmtClock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
export { fmtClock };
