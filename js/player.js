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
  }

  // videoId 로 플레이어를 만들거나, 이미 있으면 곡만 교체한다.
  // autoplay=true 면 바로 재생(사용자가 목록에서 곡을 고른 경우),
  // false 면 준비만 하고 대기(앱 시작 시).
  async load(videoId, { autoplay = false } = {}) {
    await waitForApi();
    if (this.yt) {
      if (autoplay) this.yt.loadVideoById(videoId);
      else this.yt.cueVideoById(videoId);
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

  onStateChange(fn) { this._onState = fn; }

  get ready() { return this._ready; }

  // ---- 재생 제어 ----
  play()  { this.yt && this.yt.playVideo(); }
  pause() { this.yt && this.yt.pauseVideo(); }
  seek(sec) { this.yt && this.yt.seekTo(Math.max(0, sec), true); }

  get currentTime() { return this.yt ? this.yt.getCurrentTime() : 0; }
  get duration()    { return this.yt ? this.yt.getDuration() : 0; }
  get isPlaying()   { return this.yt ? this.yt.getPlayerState() === window.YT.PlayerState.PLAYING : false; }
  get iframeEl()    { return this.yt && this.yt.getIframe ? this.yt.getIframe() : null; }
}

// "https://youtu.be/ID", "https://www.youtube.com/watch?v=ID", 혹은 그냥 "ID" 에서 11자리 ID 추출.
export function parseVideoId(input) {
  if (!input) return "";
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : "";
}
