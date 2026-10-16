# 간 검사 이상 에이전트 화면

EMR 안에서 에이전트 네 개가 시간 흐름에 따라 작동하는 모습을 보여 주는 정적 웹 화면입니다 (KCD 2026 포스터용). 환자와 기록은 모두 손으로 만든 가상 자료입니다. 원인 추정은 미리 저장한 실행 기록을 재생하고, 나머지 에이전트 출력은 팀 모델을 받기 전까지 대체 계산 (`standin.ts`) 이나 예시값을 씁니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성 (GitHub Pages 에 올릴 것)
```

화면은 1280px 이상 데스크톱 기준입니다 (1920x1080, 1440x900 에서 확인).

## 화면 흐름

화면 전체가 **기준 시각**까지 결과가 나온 기록만 보여 줍니다. 위쪽 재생 버튼을 누르면 ICU 입실부터 퇴실까지 한 시간씩 넘어갑니다. 시간선을 누르거나 끌어도 기준 시각이 바뀝니다.

| 에이전트 | 도는 시점 | 출력 | 지금 쓰는 값 |
|---|---|---|---|
| 1 발생 예측 | 5배 사건 전 매시간. 사건이 생기면 멈춤 | 24시간 안 5배 사건 확률, 경보 (30%) | `standin.ts` 의 대체 로지스틱 식 |
| 2 종료 상태 | 2배 사건 시점에 한 번 | ICU 퇴실 때 회복 여부 x 생존 여부 4가지 확률 | `models.ts` 예시값 |
| 3 원인 추정 | 5배 사건 시점에 한 번 | 원인 범주 10개 중 3순위, 근거, A 와 B 조건 비교 | `runs.ts` 손으로 쓴 실행 기록 |
| 4 24시간 궤적 | 첫 간 검사 결과 뒤 매시간 | 앞으로 24시간 ALT, ALP, 총빌리 예측선 | `standin.ts` 의 감쇠 선형 추세 (실행안 기준 모델) |

재생 중에는 첫 경보, 2배 사건, 5배 사건, 퇴실 시점에서 멈추고 그 에이전트를 보여 줍니다. 사건 정의 (배수, t0 = 채혈 시각, 회복 2 x ULN 미만, 사망 1년) 는 `docs/liver_agent_7site_summary.md` 를 따르며 `src/lib/events.ts` 에 모여 있습니다.

## 구성

| 위치 | 내용 |
|---|---|
| `src/types.ts` | 자료 형식. 사례 자료, 사건, 에이전트 출력 (`A1Point`, `A2Output`, `A4Forecast`, `AgentRun`, `ModelOutputs`) |
| `src/lib/events.ts` | 사건 찾기 (2배, 5배), 집단, 회복, 종료 상태, 기준 시각에 보이는 기록 |
| `src/data/case01.ts` | 가상 사례 1 (쇼크 뒤 허혈성 손상, 회복 · 생존). 입실부터 퇴실까지 검사, 투약, 활력징후, 배양, 처치 |
| `src/data/runs.ts` | 사례 1 의 원인 추정 A, B 조건 실행 기록 |
| `src/data/causes.ts` | 원인 범주 10개 (임상의 선생님 기준) |
| `src/data/models.ts` | 모델 1 (군집, B 조건 정보) 과 에이전트 2 출력 자리 (`placeholder: true`) |
| `src/data/standin.ts` | 에이전트 1, 4 의 대체 계산. 팀 모델 출력을 받으면 바꿀 곳 |
| `src/data/index.ts` | `getSim`: 사례 하나의 정시 목록, 사건, 에이전트별 실행 구간과 출력 |
| `src/data/patients.ts` | 재원 환자 목록. `plannedScenario` 는 아직 만들지 않은 사례의 계획 (화면에 안 나옴) |
| `src/assets/snuh_logo_white.svg`, `public/favicon.svg` | 상단 로고 (남색 바탕용: 글자 흰색, H 와 방패 밝은 파랑) 와 브라우저 탭 아이콘. 원본은 `snuh_logo.svg` |
| `src/styles.css` | 맨 위 `:root` 의 색과 글꼴 값만 바꾸면 전체 모양이 바뀝니다 |

## 팀 모델 출력 넣기

- 에이전트 1: 정시마다 `{ time, p, factors }` (`A1Point[]`). `getSim` 에서 `agent1At` 대신 이 배열을 쓰면 됩니다.
- 에이전트 2: 사례마다 `{ probs: { 'rec-alive', 'rec-dead', 'norec-dead', 'norec-alive' }, factors }` 를 `models.ts` 에 넣습니다.
- 에이전트 4: 정시마다 항목별 `{ code, last, points: [{ time, v, lo, hi }] }` (`A4Forecast[]`). `getSim` 의 `a4.at` 을 바꿉니다.
- 모델 1: `models.ts` 의 `model1` (군집 번호, 확신도, 설명표 문장).

## 사례 추가

1. `src/data/caseNN.ts` 를 `case01.ts` 와 같은 형식으로 만듭니다 (`icuIn`, `icuOut`, `outcome` 필수).
2. `src/data/runs.ts` 에 원인 추정 A, B 실행 기록을, `src/data/models.ts` 에 모델 1 과 에이전트 2 출력을 넣습니다.
3. `src/data/index.ts` 의 `cases` 에 추가하고, `patients.ts` 의 해당 환자에 `caseId` 를 붙입니다.

근거의 `ref` (`{ tab, row, col | from, to }`) 가 원자료 탭의 행 id 와 맞아야 '원자료 ›' 를 눌렀을 때 그 칸으로 이동합니다.
