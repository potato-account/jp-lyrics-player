// YouTube IFrame Player API 를 감싼 얇은 래퍼.
// - API 스크립트는 index.html 에서 전역으로 로드되고, 준비되면 window.onYouTubeIframeAPIReady 를 호출한다.
// - 이 모듈은 그 콜백을 Promise 로 바꿔 다루기 쉽게 만든다.

let ytApiReady = null;

function waitForApi() {
  if (ytApiReady) return ytApiReady;
  ytApiReady = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    // API 준비 콜백은 전역 함수 이름이 고정되어 있다.
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return ytApiReady;
}

export class Player {
  constructor(elId) {
    this.elId = elId;
    this.yt = null;
    this._onState = () => {};
    this._ready = false;
    // "yt" | "local" — 지금 재생 소스가 유튜브인지, 이 기기에 저장된 파일인지.
    // 로컬 모드는 메들리처럼 유튜브에 없는 영상/음성을 위한 것으로, 파일 자체가
    // 이 기기 밖으로 절대 나가지 않는다(서버 업로드 없음, IndexedDB 에만 저장됨).
    this.mode = "yt";
    this.videoEl = document.getElementById(elId + "-local");
    this._mediaUrl = null; // 로컬 파일의 objectURL. 교체/해제 시 revoke 필요.
    if (this.videoEl) {
      this.videoEl.addEventListener("playing", () => this._onState(1));
      this.videoEl.addEventListener("pause", () => { if (!this.videoEl.ended) this._onState(2); });
      this.videoEl.addEventListener("ended", () => this._onState(0));
    }
  }

  // videoId 로 플레이어를 만들거나, 이미 있으면 곡만 교체한다.
  // autoplay=true 면 바로 재생(사용자가 목록에서 곡을 고른 경우),
  // false 면 준비만 하고 대기(앱 시작 시).
  // seek: 그 영상의 몇 초 지점부터 시작할지(초). 새로 붙는 영상이라 아직 seekTo 를 받을 준비가
  // 안 됐을 수 있어서 — loadVideoById/cueVideoById 자체의 startSeconds 로 넘긴다(노래방 모드 전환용).
  async load(videoId, { autoplay = false, seek = 0 } = {}) {
    await waitForApi();
    this._setMode("yt");
    if (this.yt) {
      if (autoplay) this.yt.loadVideoById({ videoId, startSeconds: seek });
      else this.yt.cueVideoById({ videoId, startSeconds: seek });
      return;
    }
    await new Promise((resolve) => {
      this.yt = new window.YT.Player(this.elId, {
        videoId,
        playerVars: {
          playsinline: 1,      // iOS/안드로이드에서 전체화면 강제 진입 방지
          rel: 0,
          modestbranding: 1,
          controls: 1,
        },
        events: {
          onReady: () => { this._ready = true; resolve(); },
          onStateChange: (e) => this._onState(e.data),
        },
      });
    });
  }

  // blob(File/Blob)로 로컬 영상·음성 파일을 재생한다. 서버에는 아무것도 안 보낸다 —
  // URL.createObjectURL 로 이 기기 메모리 안에서만 재생 가능한 임시 주소를 만들 뿐이다.
  async loadLocal(blob, { autoplay = false, seek = 0 } = {}) {
    this._setMode("local");
    if (!this.videoEl) return;
    if (this._mediaUrl) URL.revokeObjectURL(this._mediaUrl);
    this._mediaUrl = URL.createObjectURL(blob);
    this.videoEl.src = this._mediaUrl;
    this.videoEl.currentTime = seek;
    this._ready = true;
    if (autoplay) { try { await this.videoEl.play(); } catch {} }
  }

  // 유튜브 iframe ↔ 로컬 <video> 중 지금 쓸 쪽만 보이게/재생 가능하게 전환.
  _setMode(mode) {
    this.mode = mode;
    const ytEl = document.getElementById(this.elId);            // 아직 YT.Player 생성 전이면 원래 div
    const ytIframe = this.yt && this.yt.getIframe ? this.yt.getIframe() : null;
    if (ytEl) ytEl.style.display = mode === "yt" ? "" : "none";
    if (ytIframe) ytIframe.style.display = mode === "yt" ? "" : "none";
    if (this.videoEl) this.videoEl.style.display = mode === "local" ? "" : "none";
    if (mode === "local" && this.yt && typeof this.yt.pauseVideo === "function") this.yt.pauseVideo();
    if (mode === "yt" && this.videoEl) this.videoEl.pause();
  }

  onStateChange(fn) { this._onState = fn; }

  get ready() { return this.mode === "local" ? !!this.videoEl : this._ready; }

  // ---- 재생 제어 ----
  play()  { this.mode === "local" ? (this.videoEl && this.videoEl.play().catch(() => {})) : (this.yt && this.yt.playVideo()); }
  pause() { this.mode === "local" ? (this.videoEl && this.videoEl.pause()) : (this.yt && this.yt.pauseVideo()); }
  seek(sec) {
    if (this.mode === "local") { if (this.videoEl) this.videoEl.currentTime = Math.max(0, sec); }
    else this.yt && this.yt.seekTo(Math.max(0, sec), true);
  }

  get currentTime() {
    if (this.mode === "local") return this.videoEl ? this.videoEl.currentTime : 0;
    return this.yt ? this.yt.getCurrentTime() : 0;
  }
  get duration() {
    if (this.mode === "local") return this.videoEl ? this.videoEl.duration || 0 : 0;
    return this.yt ? this.yt.getDuration() : 0;
  }
  get isPlaying() {
    if (this.mode === "local") return this.videoEl ? !this.videoEl.paused && !this.videoEl.ended : false;
    // 플레이어가 아직 덜 붙었을 때 getPlayerState 가 없을 수 있어 방어적으로 처리. 1 = PLAYING
    return this.yt && typeof this.yt.getPlayerState === "function" ? this.yt.getPlayerState() === 1 : false;
  }
  get iframeEl() {
    if (this.mode === "local") return this.videoEl;
    return this.yt && this.yt.getIframe ? this.yt.getIframe() : null;
  }
}

// "https://youtu.be/ID", "https://www.youtube.com/watch?v=ID", 혹은 그냥 "ID" 에서 11자리 ID 추출.
export function parseVideoId(input) {
  if (!input) return "";
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : "";
}
