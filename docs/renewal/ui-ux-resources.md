# 게임 페이지 UI/UX 참고 자료

수집일: 2026-10-12 (KST). 완성된 게임·게임 엔진은 제외하고, UI 부품·디자인 검토 도구·화면 참고 자료를 모았다.

원본 저장소 3개는 `output/ui-ux-references/`에 shallow clone으로 내려받았다. 이 경로는 기존 `.gitignore`의 `output/` 규칙에 따라 로컬 참고용이며 Git에 포함되지 않는다. 이 문서는 공유 가능한 자료 목록이다. 패키지·스킬 설치나 게임 페이지 연결은 수행하지 않았다.

## 먼저 볼 자료

| 우선순위 | 자료 | 분류 | 우리 작업에서 쓸 부분 | 확인 링크 |
|---|---|---|---|---|
| 1 | NES.css | CSS UI 부품 | 픽셀 버튼·말풍선·상태 배지·패널 | [GitHub](https://github.com/nostalgic-css/NES.css) · [미리보기](https://nostalgic-css.github.io/NES.css/) |
| 2 | Interface In Game | 화면 참고 | 참가자 배치·준비 상태·결과 순위·게임 위 정보 | [사이트](https://interfaceingame.com/) |
| 3 | UI UX Pro Max | AI 디자인 검토 도구 | 모바일 사용성·버튼 상태·색·서체·접근성 지침 | [GitHub](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [소개](https://www.uupm.cc/) |
| 4 | RPGUI | HTML/CSS/JS UI 부품 | 게임 패널 테두리·진행 바·설정 컨트롤 | [GitHub](https://github.com/RonenNess/RPGUI) · [미리보기](https://ronenness.github.io/RPGUI/) |

우선순위는 LAMDiceBot의 순수 HTML/CSS 구조와 픽셀 에셋을 고려한 판단이다. 프로젝트에 적용해 비교한 결과는 아니다.

## 1. NES.css — 픽셀 UI 부품

- 원본: <https://github.com/nostalgic-css/NES.css>
- 로컬: `output/ui-ux-references/nes-css/`
- 구성: CSS 기반 컴포넌트. 레이아웃과 상호작용은 사용하는 쪽에서 구현한다. JavaScript 의존성은 없다.
- 코드 라이선스: 저장소 `LICENSE`에 MIT 명시. README는 문서의 라이선스를 Creative Commons로 별도 표기한다.

| 가져다 볼 부품 | 원본 파일 | 활용 후보 |
|---|---|---|
| 버튼 | `scss/elements/buttons.scss` | 준비·시작·다시 하기의 눌림 표현 |
| 말풍선 | `scss/elements/balloons.scss` | 참가자의 짧은 상태·반응 |
| 배지 | `scss/elements/badges.scss` | 방장·준비 완료 상태 |
| 패널 | `scss/elements/containers.scss` | 참가자 목록·결과 영역의 경계 |
| 진행 바 | `scss/elements/progress.scss` | 실제 진행 정보를 표현할 때의 시각 참고 |

적용 판단: 버튼과 배지부터 새 목업에서 비교한다. 전체 페이지를 픽셀 장식으로 채우는 안은 우선순위가 낮다. 기본 추천 영문 폰트는 한글을 지원하지 않으므로 프로젝트 서체를 사용한다. 모바일 레이아웃·긴 이름·다크 스킨은 별도 확인해야 한다.

## 2. Interface In Game — 배치와 정보 우선순위

- 원본: <https://interfaceingame.com/>
- 형태: 게임 화면 스크린샷·영상 아카이브. 설치하는 코드나 UI 키트가 아니다.
- 수집 방식: 화면 유형별 링크를 보관한다. 사이트 이미지·영상은 로컬에 복제하지 않았다.

| 바로 보기 | 관찰할 것 | 우리 화면에 남길 결과 |
|---|---|---|
| [대기실](https://interfaceingame.com/screenshots/?elements=lobby) | 내 자리·다른 참가자·준비 상태가 구분되는 방식 | 참가자 목록과 준비/시작 버튼의 배치 초안 |
| [결과·순위](https://interfaceingame.com/screenshots/?elements=scoreboard) | 승자와 내 결과의 우선순위 | 결과 제목·순위·다시 하기 배치 초안 |
| [게임 위 정보](https://interfaceingame.com/screenshots/?elements=overlay) | 게임 화면을 가리지 않는 정보 위치 | 진행 상태·최소 조작 영역의 배치 초안 |

참고할 때는 예쁜 화면 전체를 복제하기보다, 한 화면에서 배울 배치 원리 하나와 생략할 정보 하나를 기록한다. 이미지·영상은 사이트가 안내하는 원권리자의 자료이며 우리 에셋으로 취급하지 않는다.

## 3. UI UX Pro Max — 디자인 지침과 검토

- 원본: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>
- 로컬: `output/ui-ux-references/ui-ux-pro-max/`
- 구성: AI 도구용 디자인 스킬, 스타일·색·서체·UX 지침 데이터, 검색 스크립트.
- 시작 위치: `README.md`, `src/ui-ux-pro-max/data/`.
- 라이선스 표기: MIT (`LICENSE`).

활용 후보:

1. 준비·진행 중·완료·오류 상태가 색 이외의 표시로도 구분되는지 검토.
2. 작은 화면의 버튼 크기, 긴 참가자 이름, 줄바꿈과 정보 밀도 검토.
3. 키보드 포커스, 비활성 상태, 모션 감소 대응 검토.

게임 전용 컴포넌트 키트가 아니며, HTML/Tailwind 지침을 우리 순수 CSS 구조에 그대로 적용하지 않는다. 생성되는 스타일 제안보다 프로젝트의 기존 디자인 규칙이 우선한다. 현재는 원본 수집만 완료했으며 스킬 등록·스크립트 실행은 하지 않았다.

## 4. RPGUI — 패널과 게임 컨트롤

- 원본: <https://github.com/RonenNess/RPGUI>
- 로컬: `output/ui-ux-references/rpgui/`
- 구성: HTML 요소에 클래스를 붙이는 CSS/JS UI. 패널 프레임·버튼·진행 바·슬라이더·선택 컨트롤을 제공한다.
- 시작 위치: `README.md`, `examples/`, `src/`, `dist/`.
- 라이선스 표기: zlib (`LICENSE.txt`).

활용 후보:

1. 결과 패널·참가자 패널의 테두리 표현.
2. 진행 바의 채움·빈 영역 구분.
3. 설정 화면의 슬라이더·선택 상태 표현.

고전 RPG 장식이 강하므로 부분 참고 자료로 둔다. 원본에는 전체 화면 wrapper, 스크롤·포커스·폼 요소 표현에 영향을 주는 규칙이 있어 우리 페이지에 통째로 연결하기 전에 따로 검토해야 한다. 동적으로 참가자나 선택지가 바뀌는 사용 방식도 확인 대상이다.

## 프로젝트에서 활용하는 순서

1. 개선할 화면을 대기실·진행 중·결과 중 하나로 정한다.
2. Interface In Game에서 정보 배치 참고 사례를 고른다.
3. NES.css의 버튼·배지 등 필요한 부품만 새 목업에서 비교한다. RPGUI는 패널 표현이 필요한 경우 추가한다.
4. Pro Max 지침으로 사용성을 검토하고, 모바일·PC·한글·라이트/다크·키보드 조작을 직접 확인한다.

기준 문서: [DESIGN.md](../../DESIGN.md). 최우선 UX 원칙은 적게 읽기·단계 늘리지 않기다. DESIGN.md의 상세 시각 기준은 홈/로비 기준안이며 인게임은 문서상 범위 밖이다. 홈 첫 화면의 60자·조작 6개·방까지 1탭 지표를 인게임에 그대로 합격 기준으로 사용하지 않는다. 홈 목업은 기존 `node mockups/measure.js` 측정 절차를 따른다.

R&D·목업은 새 파일로 만들며 실제 게임 파일로 연결하는 작업은 별도 적용 단계다. 이번 수집에서 런타임·공유 CSS·소켓·의존성 파일은 변경하지 않았다.

## 수집 버전과 재현

아래는 수집 당시 기본 브랜치 HEAD이며, 최신 릴리스 번호와는 다르다. 원본의 갱신 시점만으로 모바일·접근성 품질을 판정하지 않는다.

| 저장소 | 수집 커밋 | 해당 커밋 날짜 (UTC) |
|---|---|---|
| NES.css | `b1cc9944aae3274461c747d7ad1cab31df45e78c` | 2021-07-19 |
| RPGUI | `048859e6e1a73bd8f5615555609db098beba4e9c` | 2023-10-08 |
| UI UX Pro Max | `67803eac81607188194aea9842a723b89326d90d` | 2026-10-10 |

다른 PC에서는 위 GitHub 링크의 저장소를 로컬 참고 폴더로 복제하고, 이 표의 커밋을 기준으로 비교한다. 별도 커밋을 가져올 때는 해당 저장소에서 `git fetch origin <커밋>` 후 `git switch --detach <커밋>`으로 맞출 수 있다. 원본 라이선스 파일은 저장소에 함께 보관한다.

완료 범위: 원본 저장소 다운로드, 공식 문서·데모 링크 확인, 활용 후보와 제한사항 정리. 실제 화면 적용·브라우저 호환성 검증은 아직 수행하지 않았다.
