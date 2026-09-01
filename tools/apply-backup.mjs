#!/usr/bin/env node
// 앱의 "전체 내보내기" 백업 파일을 받아서 repo 에 풀어넣는다.
//
//   node tools/apply-backup.mjs path/to/jlp-backup-YYYYMMDD.json
//
// 하는 일
//   1. 번들 곡(bundleId 있음): 백업에서 사용자가 직접 고친 칸(pronSrc/transSrc === "user"),
//      offset, youtubeId 를 songs/<file>.json 에 병합하고 songs/index.json 의 version 을 올린다.
//   2. 사용자 곡(bundleId 없음): songs/ 로 승격 후보로 새 파일을 쓰고 index.json 에 등록한다.
//      슬러그를 자동으로 못 만들면 user-XXXX 로 두니, 커밋 전에 파일명·bundleId 를 손보라.
//   3. 이미지(backup.images, songRef 키): img/<base>.(webp|png|jpg) 로 저장하고
//      해당 곡 json 에 "image": "img/..." 를 넣는다.
//   4. state.json: 백업의 playlists / hidden / settings 로 새로 쓰고 version 을 +1.
//   5. backups/jlp-backup-<date>.json: 이미지 blob 을 뺀 가벼운 사본을 보관.
//
// 커밋은 자동으로 하지 않는다. 바뀐 걸 git diff 로 확인하고 직접 커밋한다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SONGS_DIR = path.join(ROOT, "songs");
const IMG_DIR = path.join(ROOT, "img");
const BACKUPS_DIR = path.join(ROOT, "backups");
const INDEX_FILE = path.join(SONGS_DIR, "index.json");
const STATE_FILE = path.join(ROOT, "state.json");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
const log = (...a) => console.log(...a);

function extFromMime(mime) {
  if (/webp/.test(mime)) return "webp";
  if (/png/.test(mime)) return "png";
  if (/jpe?g/.test(mime)) return "jpg";
  return "img";
}
function dataURLToBuffer(u) {
  const m = String(u).match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return null;
  return { buf: Buffer.from(m[2], "base64"), ext: extFromMime(m[1]) };
}
// 아주 러프한 슬러그. 일본어 등 비 ASCII 는 못 만든다.
function slug(s) {
  const out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "";
}

function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error("usage: node tools/apply-backup.mjs <backup.json>");
    process.exit(1);
  }
  const backup = readJSON(path.resolve(backupPath));
  if (backup.kind !== "backup" || !Array.isArray(backup.songs)) {
    console.error("이 앱의 백업 파일이 아님");
    process.exit(1);
  }

  const index = readJSON(INDEX_FILE);
  const byBundle = new Map(index.songs.map((e) => [e.bundleId, e]));
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  // songRef(b:/i:) → { entry, file, bundleId }  이미지·플리 참조 해석용
  const refMap = new Map();
  const touched = new Set(); // 다시 저장할 song 파일

  let promotedNum = index.songs.length;

  for (const s of backup.songs) {
    if (s.bundleId && byBundle.has(s.bundleId)) {
      // --- 기존 번들 곡: 사용자 수정 병합 ---
      const entry = byBundle.get(s.bundleId);
      const file = path.join(SONGS_DIR, entry.file);
      const cur = readJSON(file);
      let changed = false;

      for (let i = 0; i < cur.lines.length && i < s.lines.length; i++) {
        for (const f of ["pron", "trans"]) {
          if (s.lines[i] && s.lines[i][f + "Src"] === "user" && cur.lines[i][f] !== s.lines[i][f]) {
            cur.lines[i][f] = s.lines[i][f];
            cur.lines[i][f + "Src"] = "user";
            changed = true;
          }
        }
      }
      if (typeof s.offset === "number" && s.offset !== (cur.offset || 0)) { cur.offset = s.offset; changed = true; }
      if (s.youtubeId && s.youtubeId !== cur.youtubeId) { cur.youtubeId = s.youtubeId; changed = true; }

      refMap.set("b:" + s.bundleId, { entry, file });
      if (changed) {
        writeJSON(file, cur);
        entry.version = (entry.version || 1) + 1;
        touched.add(entry.bundleId);
        log(`merged  ${entry.file}  (v${entry.version})`);
      }
    } else if (!s.bundleId) {
      // --- 사용자 곡: 승격 후보 ---
      let base = slug(s.title);
      if (!base) base = "user-" + String(s.id || "").slice(0, 6);
      const bundleId = "user-" + (base.startsWith("user-") ? base.slice(5) : base);
      promotedNum += 1;
      const fileName = `${String(promotedNum).padStart(2, "0")}_${base}.json`;
      const outFile = path.join(SONGS_DIR, fileName);
      const rec = { title: s.title || "제목 없음", artist: s.artist || "", youtubeId: s.youtubeId || "", bundleId, offset: s.offset || 0, lines: s.lines || [] };
      if (s.image) rec.image = s.image;
      writeJSON(outFile, rec);
      const entry = { file: fileName, bundleId, version: 1, title: rec.title, artist: rec.artist };
      index.songs.push(entry);
      byBundle.set(bundleId, entry);
      refMap.set("i:" + s.id, { entry, file: outFile });
      refMap.set("b:" + bundleId, { entry, file: outFile });
      touched.add(bundleId);
      log(`PROMOTED ${fileName}  (bundleId=${bundleId}) — 커밋 전 파일명·bundleId 확인`);
    } else {
      log(`skip    bundleId=${s.bundleId} (index.json 에 없음)`);
    }
  }

  // --- 이미지 ---
  for (const [ref, dataURL] of Object.entries(backup.images || {})) {
    const hit = refMap.get(ref);
    if (!hit) { log(`image?  ${ref} — 대응 곡을 못 찾음, 건너뜀`); continue; }
    const dec = dataURLToBuffer(dataURL);
    if (!dec) { log(`image!  ${ref} — data URL 파싱 실패`); continue; }
    const base = path.basename(hit.entry.file, ".json");
    const imgName = `${base}.${dec.ext}`;
    fs.writeFileSync(path.join(IMG_DIR, imgName), dec.buf);
    const cur = readJSON(hit.file);
    const rel = `img/${imgName}`;
    if (cur.image !== rel) {
      cur.image = rel;
      writeJSON(hit.file, cur);
      if (!touched.has(hit.entry.bundleId)) hit.entry.version = (hit.entry.version || 1) + 1;
      touched.add(hit.entry.bundleId);
    }
    log(`image   ${rel}  (${(dec.buf.length / 1024).toFixed(0)} KB)`);
  }

  if (touched.size) writeJSON(INDEX_FILE, index);

  // --- state.json ---
  // 플리·숨김 참조 중 승격된 i: 는 b: 로 바꿔준다.
  const remap = (r) => {
    if (r && r.startsWith("i:") && refMap.has(r)) return "b:" + refMap.get(r).entry.bundleId;
    return r;
  };
  let stateVersion = 1;
  if (fs.existsSync(STATE_FILE)) stateVersion = (readJSON(STATE_FILE).version || 0) + 1;
  const state = {
    version: stateVersion,
    playlists: (backup.playlists || []).map((p) => ({ name: p.name, refs: (p.refs || []).map(remap) })),
    hidden: (backup.songs.filter((s) => s.hidden).map((s) => remap(s.bundleId ? "b:" + s.bundleId : "i:" + s.id))),
    settings: backup.settings || {},
  };
  writeJSON(STATE_FILE, state);
  log(`state.json  v${stateVersion}  (playlists ${state.playlists.length}, hidden ${state.hidden.length})`);

  // --- 가벼운 백업 사본 ---
  const lite = { ...backup, images: Object.fromEntries(Object.keys(backup.images || {}).map((r) => {
    const hit = refMap.get(r);
    return [r, hit ? `img/${path.basename(hit.entry.file, ".json")}` : "?"];
  })) };
  const stamp = (backup.exportedAt || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const liteName = `jlp-backup-${stamp}.json`;
  writeJSON(path.join(BACKUPS_DIR, liteName), lite);
  log(`archived  backups/${liteName}  (이미지 blob 제외)`);

  log("\n완료. `git status` / `git diff` 로 확인하고 커밋하세요.");
}

main();
