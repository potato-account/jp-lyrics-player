// 오프라인 대비 캐시. 전략: 네트워크 우선(온라인이면 항상 최신 코드), 실패 시 캐시.
// 개인용이라 최신 코드가 중요하고, 오프라인일 때만 캐시로 버틴다.
const CACHE = "jlp-v43";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/player.js",
  "./js/lyrics.js",
  "./js/store.js",
  "./js/kana2ko.js",
  "./js/autofill.js",
  "./songs/index.json",
  "./songs/03_napori.json",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
// vendor/kuromoji.js 와 vendor/dict/* (~17MB) 는 SHELL 에 넣지 않는다.
// 자동 채우기를 처음 쓸 때 network-first 로 받아 캐시된다.

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // YouTube, LRCLIB 등은 그대로 통과

  // GitHub Pages 가 모든 파일에 Cache-Control: max-age=600 을 건다.
  // 그냥 fetch 하면 브라우저 HTTP 캐시가 10분간 서버에 묻지도 않고 옛 파일을 준다.
  // no-cache = 매번 서버에 확인(조건부 요청). 안 바뀌었으면 304 라 비용도 거의 없다.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
