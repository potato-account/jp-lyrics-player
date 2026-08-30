# 수작업 (사용자 발음·번역)

여기에 곡별 txt 파일을 넣으면 `tools/merge-hand.mjs` 가 LRCLIB 타임과 병합해서
`songs/NN_slug.json` 을 만든다. 발음·번역은 `user` 로 태그되어 Claude 작업(`hand`)이
덮어쓰지 않는다.

## txt 형식

원문 / 발음 / 번역을 각각 한 덩어리로, 빈 줄로 구분. 공백만 있는 줄은 무시된다.

```
街の風景にうなだれて

마치노 후-케이니 우나다레테

거리의 풍경에 고개를 떨구고


街を背景に黄昏て

마치오 하이케이니 타소가레테

거리를 배경으로 황혼에 잠겨
```

- 줄을 LRCLIB보다 잘게 쪼개도 됨. merge 스크립트가 원문을 이어붙여 맞추고 타임을 글자 수 비례로 나눈다.
- 파일명 앞에 플레이리스트 번호를 붙인다: `37 忘れる前に.txt`
- 원문 표기가 LRCLIB과 다르면(오타 등) 리포트에 뜬다. 원문은 LRCLIB 것을 쓴다.

## 실행

```
cd tools
node merge-hand.mjs "../수작업/37 忘れる前に.txt" --title "忘れる前に" --artist Vaundy \
  --youtube Hy7GWPkrZv0 --num 37 --slug wasureru-mae-ni
```
