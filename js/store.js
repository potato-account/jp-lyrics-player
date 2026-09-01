// 여러 곡을 저장하는 IndexedDB 래퍼. 곡 하나 = 레코드 하나.
// 스키마: { id, title, artist, youtubeId, offset, hidden, lines:[{t,orig,pron,trans}], updatedAt }
// 플레이리스트: { id, name, refs:["b:bundleId" | "i:songId", ...], createdAt, updatedAt }
// 곡 이미지: { id(=songId), blob, updatedAt } — 영상 대신 화면에 띄울 사진. 기기 로컬 전용.

const DB_NAME = "jlp";
const STORE = "songs";
const PLISTS = "playlists";
const IMAGES = "images";
const VERSION = 4;

let _db = null;
function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains(PLISTS)) {
        d.createObjectStore(PLISTS, { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains(IMAGES)) {
        d.createObjectStore(IMAGES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return db().then((d) => d.transaction(store, mode).objectStore(store));
}
function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const newId = () => (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());

// ---------- 곡 ----------
export async function allSongs() {
  const list = await wrap((await tx(STORE, "readonly")).getAll());
  // 최근 수정 순
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getSong(id) {
  return wrap((await tx(STORE, "readonly")).get(id));
}

// 곡 저장(업서트). id 없으면 새로 발급.
export async function putSong(song) {
  if (!song.id) song.id = newId();
  song.updatedAt = Date.now();
  if (song.offset == null) song.offset = 0;
  await wrap((await tx(STORE, "readwrite")).put(song));
  return song;
}

export async function deleteSong(id) {
  await wrap((await tx(STORE, "readwrite")).delete(id));
}

// 앞서 낸 쓰기들이 디스크에 커밋될 때까지 기다린다.
// wrap() 은 request.onsuccess 에서 풀리는데 그건 트랜잭션 커밋 전이다 —
// 직후에 location.reload() 같은 걸 하면 커밋 안 된 트랜잭션이 날아갈 수 있다.
// 같은 스토어에 새 readwrite 트랜잭션을 만들면 IndexedDB 가 생성 순서대로 커밋을 보장하므로,
// 그 트랜잭션의 complete 를 기다리면 앞선 쓰기가 모두 끝난 것이다.
export async function flush() {
  const d = await db();
  await Promise.all([STORE, IMAGES, PLISTS].map((st) => new Promise((res, rej) => {
    const t = d.transaction(st, "readwrite");
    t.objectStore(st).get("__flush__");     // 아무 것도 안 바꾸는 no-op
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  })));
}

// ---------- 곡 이미지 (영상 대신 표시할 사진) ----------
// 이 데이터는 이 기기의 브라우저에만 저장된다. GitHub 저장소로는 올라가지 않는다.
export async function getImage(id) {
  if (!id) return null;
  return wrap((await tx(IMAGES, "readonly")).get(id));
}
export async function putImage(id, blob) {
  const rec = { id, blob, updatedAt: Date.now() };
  await wrap((await tx(IMAGES, "readwrite")).put(rec));
  return rec;
}
export async function deleteImage(id) {
  await wrap((await tx(IMAGES, "readwrite")).delete(id));
}

// ---------- 플레이리스트 ----------
// 곡을 가리키는 참조. 번들 곡은 bundleId 로 가리켜야 삭제·재설치를 견딘다
// (번들 파일에는 id 가 없어서 다시 깔리면 새 UUID 를 받는다).
export const songRef = (s) => (s.bundleId ? "b:" + s.bundleId : "i:" + s.id);
export function findByRef(songs, ref) {
  if (!ref) return null;
  const key = ref.slice(2);
  return ref.startsWith("b:")
    ? songs.find((s) => s.bundleId === key)
    : songs.find((s) => s.id === key);
}

export async function allPlaylists() {
  const list = await wrap((await tx(PLISTS, "readonly")).getAll());
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); // 만든 순
}

export async function getPlaylist(id) {
  return wrap((await tx(PLISTS, "readonly")).get(id));
}

export async function putPlaylist(pl) {
  if (!pl.id) { pl.id = newId(); pl.createdAt = Date.now(); }
  if (!Array.isArray(pl.refs)) pl.refs = [];
  pl.updatedAt = Date.now();
  await wrap((await tx(PLISTS, "readwrite")).put(pl));
  return pl;
}

export async function deletePlaylist(id) {
  await wrap((await tx(PLISTS, "readwrite")).delete(id));
}

// ---------- 가벼운 상태 ----------
const LAST = "jlp:lastId";
export const getLastId = () => localStorage.getItem(LAST);
export const setLastId = (id) => localStorage.setItem(LAST, id);

// v1(단일 곡 localStorage) → IndexedDB 이전. 한 번만.
export async function migrateLegacy() {
  const raw = localStorage.getItem("jlp:lastSong");
  if (!raw) return null;
  try {
    const old = JSON.parse(raw);
    if (Array.isArray(old.lines)) {
      const saved = await putSong(old);
      setLastId(saved.id);
      localStorage.removeItem("jlp:lastSong");
      return saved;
    }
  } catch {}
  localStorage.removeItem("jlp:lastSong");
  return null;
}
