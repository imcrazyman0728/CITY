# CITY 웹 버전

브라우저에서 바로 플레이하는 버전입니다. 서버 코드가 없는 정적 사이트라서 어디에든 올릴 수 있어요.
게임 데이터(카드·적·인카운터 JSON)는 기존 파이썬 버전과 **같은 파일**을 씁니다.

## 화면 구성
- **선택지**: 버튼(또는 숫자 키 1~9)으로 진행합니다. 확률이 있는 선택지는 `%`가 표시됩니다.
- **전투**: 손패의 카드에 마우스를 올리면 상세 정보가 뜨고, 카드를 끌어 내 슬롯에 놓습니다.
  - 적이 여럿이면 놓은 뒤 공격할 적의 슬롯을 클릭합니다.
  - 끌기가 불편하면 카드 클릭 → 슬롯 클릭도 됩니다(터치 포함). 장착된 슬롯을 다시 누르면 대상을 바꿀 수 있고, `✕`로 해제합니다.

## 내 컴퓨터에서 실행
저장소 **루트**에서 아래를 실행하고 http://localhost:8000/web/ 을 엽니다. (`file://`로는 열리지 않아요)

```
python -m http.server 8000
```

## 데이터를 고쳤다면
카드·적·인카운터·크레딧(`credits.json`)을 추가하거나 고친 뒤에는 번들을 다시 만들어 함께 커밋하세요.

```
python tools/build_web.py
```

## 올리기 (배포)
웹 페이지는 `web/`에 있고, 음악은 저장소 루트의 `mus/`, `sfx/`를 그대로 가리킵니다. 그래서 **저장소 전체**를 올려야 합니다.

- **GitHub Pages**: 저장소 Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
  주소는 `https://<아이디>.github.io/<저장소>/` 이고, 루트의 `index.html`이 `web/`으로 넘겨 줍니다.
- **Cloudflare Pages**: 저장소를 연결하고 *Build command*는 비워 두고, *Build output directory*는 `/`(루트)로 합니다.

## 저장
진행 기록(도감, 도전과제, 묘비, 클리어 기록, 설정)은 **접속한 브라우저의 localStorage**에만 저장됩니다. 사람마다, 브라우저마다 따로 쌓여요.
`player/profile.json`은 처음 접속했을 때의 기본값으로만 쓰입니다. 이 파일을 바꿔도 이미 접속한 사람의 기록은 바뀌지 않습니다.

## 음악
`web/js/config.js`의 `bgm`을 `false`로 하면 배경음을 끌 수 있습니다. 곡의 출처는 `credits.json`에서 관리하고, 서재 → 크레딧 화면에 그대로 표시됩니다.

## 테스트
```
node web/tests/flow.test.mjs
```
화면 없이 스토리를 처음부터 끝까지 자동으로 돌려서 엔진이 막히지 않는지 확인합니다.

## 파일 구조
| 파일 | 역할 |
|---|---|
| `js/engine.js` | 전투 규칙 (파이썬 `main.py`의 전투를 옮긴 것) |
| `js/encounter.js` | 인카운터 진행, 효과 적용, 레벨업, 엔딩 |
| `js/ui.js`, `js/battle_view.js` | 선택지 화면, 전투 화면 |
| `js/library.js` | 서재, 도감, 크레딧, 내 정보 |
| `js/cardinfo.js`, `js/components.js` | 카드 설명 문구, 공용 화면 부품 |
| `js/audio.js`, `js/storage.js`, `js/config.js` | 소리, 저장, 설정 |
| `data/bundle.json` | `tools/build_web.py`가 만드는 게임 데이터 묶음 |
