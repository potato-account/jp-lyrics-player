// 여러 곡을 저장하는 IndexedDB 래퍼. 곡 하나 = 레코드 하나.
// 스키마: { id, title, artist, youtubeId, offset, lines:[{t,orig,pron,trans}], updatedAt }

const DB_NAME = "jlp";
const STORE = "songs";
const VERSION = 1;

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
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) {
  return db().then((d) => d.transaction(STORE, mode).objectStore(STORE));
}
function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function allSongs() {
  const list = await wrap((await tx("readonly")).getAll());
  // 최근 수정 순
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getSong(id) {
  return wrap((await tx("readonly")).get(id));
}

// 곡 저장(업서트). id 없으면 새로 발급.
export async function putSong(song) {
  if (!song.id) song.id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
  song.updatedAt = Date.now();
  if (song.offset == null) song.offset = 0;
  await wrap((await tx("readwrite")).put(song));
  return song;
}

export async function deleteSong(id) {
  await wrap((await tx("readwrite")).delete(id));
}

// "마지막으로 연 곡" 포인터는 가벼우니 localStorage 로.
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
