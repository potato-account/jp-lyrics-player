# 가사 싱크 플레이어 (jp-lyrics-player)

일본어 노래를 **원문 / 한국어 발음 / 번역** 3단으로, YouTube 재생 위치에 맞춰 싱크해서 보는 개인용 PWA.

## 지금 되는 것 (1단계)

- YouTube 플레이어 + 영상 접기(오디오만 남기고 가사 넓게 보기)
- 3단 가사 렌더링, 현재 줄 하이라이트 + 자동 스크롤
- 재생 컨트롤: 재생/일시정지, ±5초, 탐색 바, 줄 탭하면 그 줄로 이동
- **싱크 편집**: 노래 들으면서 줄마다 `찍기` 버튼 → 현재 시각 기록 → `편집 끝(내보내기)` 로 JSON 저장
- 곡 파일(JSON) 불러오기 / 새 곡 만들기(가사 붙여넣기)
- 홈 화면 추가(PWA), 앱 껍데기 오프라인 캐시
- 마지막으로 연 곡은 자동 저장(localStorage)

## 곡 파일 형식 (`songs/*.json`)

```json
{
  "title": "napori",
  "artist": "Vaundy",
  "youtubeId": "ZeIGVnkYX04",
  "offset": 0,
  "lines": [
    { "t": 14.99, "orig": "ろくな音楽もなくて", "pron": "로쿠나 옹가쿠모 나쿠테", "trans": "변변한 음악도 없이" }
  ]
}
```

- `t` : 그 줄이 시작되는 시각(초). `null` 이면 아직 싱크 안 된 줄 → 편집 모드에서 `찍기`.
- `offset` : 전체 타임을 통째로 미는 값(초). 싱크가 일정하게 밀릴 때 조정.
- `pron` / `trans` : 비워두면(`""`) 3단에서 그 칸만 숨겨짐. 3단계 보조 스크립트의 자동 채우기 대상.
- `youtubeId` : `https://youtu.be/XXXX`, `https://www.youtube.com/watch?v=XXXX`, 또는 11자리 ID.

### 새 곡 만들기에서 붙여넣기 규칙 (줄 단위 자동 감지)

- `[00:14.99] 가사` → LRCLIB `syncedLyrics` 를 그대로 붙여넣으면 타임까지 채워짐
- `원문 | 발음 | 번역` → `|` 로 세 칸 구분
- `원문` 만 → 원문만, 타임은 편집 모드에서

## LRCLIB 로 원문 + 타임 가져오기 (2단계에서 앱에 버튼으로 들어갈 예정)

지금은 수동. 브라우저나 터미널에서:

```bash
curl "https://lrclib.net/api/search?track_name=napori&artist_name=Vaundy"
```

응답의 `syncedLyrics` 값을 복사 → 앱의 `새 곡` → 가사 붙여넣기 칸에 그대로 붙여넣기.
(`napori` 는 이미 `songs/napori.json` 으로 만들어 둠. `youtubeId` 는 미확인이라 안 맞으면 `새 곡`에서 링크만 바꿔 다시 저장.)

## 로컬에서 실행

정적 파일이라 아무 정적 서버나 됨:

```bash
python -m http.server 5173
```

브라우저에서 `http://localhost:5173` . 폰에서 테스트하려면 PC와 같은 와이파이에서 `http://<PC-IP>:5173` .

## GitHub Pages 배포

1. 이 폴더를 그대로 GitHub 저장소에 push (저장소 루트에 `index.html` 이 오도록)
2. 저장소 **Settings → Pages → Build and deployment → Source: Deploy from a branch**, 브랜치 `main` / 폴더 `/ (root)`
3. 몇 분 뒤 `https://<계정>.github.io/<저장소>/` 접속
4. 폰 크롬에서 그 주소 열고 **⋮ 메뉴 → 홈 화면에 추가**

> PWA 는 HTTPS 필수라 GitHub Pages(자동 HTTPS)면 바로 됨. `file://` 로 열면 서비스 워커가 동작하지 않음.

## 알려진 한계

- 모바일 브라우저에서는 **화면을 끄거나 앱을 완전히 벗어나면 YouTube 오디오가 멈춤**. 편집 모드에서는 Wake Lock 으로 화면 꺼짐을 막음.
- YouTube 임베드가 막힌 영상(퍼가기 비허용)은 재생 불가 → 다른 영상 ID 사용.

## 다음 단계

- 2단계: 앱 안에서 LRCLIB 검색·가져오기 버튼, 여러 곡 목록(IndexedDB)
- 3단계: PC용 보조 스크립트 — LRCLIB 원문 + kuroshiro 로 발음 자동 생성 + 무료 번역 API. 내 파일이 있으면 항상 우선.
