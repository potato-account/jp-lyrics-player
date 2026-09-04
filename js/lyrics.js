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
  constructor(listEl, { onSeekToLine, onEditRow, onNudge }) {
    this.listEl = listEl;
    this.scroller = listEl.parentElement; // #lyrics
    this.onSeekToLine = onSeekToLine;
    this.onEditRow = onEditRow || (() => {}); // 줄 하나의 발음·번역·시간을 한 다이얼로그에서 수정
    this.onNudge = onNudge || (() => {});     // 재생 중 활성 줄의 t 를 ±0.1초씩 미세 조정
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
    // 발음/번역은 이제 줄에서 직접 타이핑하지 않고 "수정" 다이얼로그에서만 고친다.
    // 편집 모드 표시는 #app.edit-on CSS 가 담당하므로 여기서는 플래그만 갱신.
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
      // 편집 모드에서만 보이는 시간 표시 (수정은 다이얼로그에서).
      // 미세 조정(±0.1초)이 눈에 보이도록 편집 모드에서는 1/100초까지 표시한다.
      const tEl = el("div", "line-t", line.t != null ? fmtClock2(line.t) : "타임 없음");
      body.append(origEl, pronEl, transEl, tEl);
      li.appendChild(body);

      // 편집 버튼 묶음: 재생 중 활성 줄에만 뜨는 ±0.1초 미세 조정 + [수정].
      const btns = document.createElement("div");
      btns.className = "line-btns";

      // 활성 줄 미세 조정 — 재생하며 바로 들으면서 이 줄만 당기고/미룬다.
      // CSS 로 #app.edit-on .lyric-line.is-active 일 때만 보인다.
      const mkNudge = (label, d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "nudge-t";
        b.textContent = label;
        b.addEventListener("click", (e) => { e.stopPropagation(); this.onNudge(i, d); });
        return b;
      };
      btns.append(mkNudge("−0.1s", -0.1), mkNudge("+0.1s", 0.1));

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "edit-line" + (line.t != null ? " has-time" : "");
      editBtn.textContent = "수정";
      editBtn.addEventListener("click", (e) => { e.stopPropagation(); this.onEditRow(i); });

      btns.append(editBtn);
      li.appendChild(btns);

      // 줄 탭 → 그 줄로 이동 (편집 모드에서는 무시)
      li.addEventListener("click", (e) => {
        if (this.editable) return;
        if (e.target.closest(".line-btns")) return;
        if (line.t != null) this.onSeekToLine(line.t + (this.song.offset || 0));
      });

      this.listEl.appendChild(li);
      this.rows.push({ li, editBtn, tEl, pronEl, transEl });
    });
  }

  refreshRow(i) {
    const line = this.song.lines[i];
    const r = this.rows[i];
    if (!r) return;
    r.pronEl.textContent = line.pron || "";
    r.transEl.textContent = line.trans || "";
    r.tEl.textContent = line.t != null ? fmtClock2(line.t) : "타임 없음";
    r.editBtn.classList.toggle("has-time", line.t != null);
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
// 편집 모드 줄 표시용 — 1/100초까지 ("1:23.45"). 미세 조정 결과가 바로 보이게.
function fmtClock2(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}
export { fmtClock };
