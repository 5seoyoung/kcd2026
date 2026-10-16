# 간 검사 이상 에이전트 화면

EMR 안에서 에이전트 네 개와 질의응답이 시간 흐름에 따라 작동하는 모습을 보여 주는 정적 웹 화면입니다 (KCD 2026 포스터용). 환자와 기록은 모두 손으로 만든 가상 자료입니다. 원인 추정은 미리 저장한 실행 기록을 재생하고, 나머지 에이전트 출력은 MIMIC 연구원의 모델을 받기 전까지 대체 계산 (`standin.ts`) 이나 예시값을 씁니다. 지식 근거는 근거 위키 (`../wiki_kb`, 원문 13편으로 만든 한국어 위키) 에서 가져옵니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성 (GitHub Pages 에 올릴 것)
npm run wiki     # ../wiki_kb 가 바뀌면 public/wiki/kb.json 을 다시 만듦
```

화면은 1280px 이상 데스크톱 기준입니다 (1920x1080, 1440x900 에서 확인).

## 정의 (MIMIC 명세서 기준, 10/17 결정)

| 항목 | 정의 |
|---|---|
| 공개 시각 | max(채혈 시각, 보고 시각). 화면과 에이전트는 기준 시각까지 공개된 기록만 봄. 사건의 t0 도 공개 시각 |
| ULN | 그 행의 기록 상한 |
| 대상 | ICU 입실 전 같은 입원에서 이미 2배 이상이던 환자는 제외 |
| 첫 이상 | ALT, ALP, 총빌리 중 하나가 2 x ULN 이상 (OR) |
| 회복 | ICU 퇴실 때 마지막 ALT, ALP, 총빌리가 모두 2 x ULN 미만. 첫 이상 뒤 다시 재지 않으면 판정 불가 |
| 사망 | ICU 사망 (퇴실 뒤 24시간 안 포함) |
| 정상 구간 | ALT, ALP, 총빌리를 모두 최근 24시간 안에 쟀고 모두 2배 미만. 발생 예측은 이때만 내고 아니면 판정 불가 |

모든 정의와 상수는 `src/lib/events.ts` 에 있습니다. 바탕 문서는 `docs/liver_agent_7site_summary.md` 입니다 (공개 저장소에는 올리지 않음).

## 화면 흐름

위쪽 재생 버튼을 누르면 ICU 입실부터 퇴실까지 한 시간씩 넘어갑니다. 시간선을 누르거나 끌어도 기준 시각이 바뀝니다.

| 에이전트 | 도는 시점 | 출력 | 지금 쓰는 값 |
|---|---|---|---|
| 1 발생 예측 | 첫 이상 전 매시간 (정상 구간만) | 24시간 안 5배 사건 확률, 경보 (30%). 멈춘 뒤 24시간 안 5배 사건으로 정답 확인 | `standin.ts` 의 대체 로지스틱 식 |
| 2 종료 상태 | 첫 이상 때 한 번 | 회복 여부 x ICU 사망 여부 4경로 확률, ICU 사망 확률 (별도 모델) | `models.ts` 예시값 |
| 3 원인 추정 | 첫 이상 때 한 번 | 원인 범주 10개마다 규칙 점수, 환자 근거, 근거 위키의 진단 기준과 근거 공백. 1.0 이상이면 해당 (여러 개 가능), 담낭염은 판단 불가. 군집 (모델 1) 은 보조 정보로만 표시 | `runs.ts` 손으로 쓴 실행 기록 |
| 4 24시간 궤적 | 첫 간 검사 결과 뒤 매시간 | 6, 12, 18, 24시간 뒤 ALT, ALP, 총빌리의 10%, 50%, 90% 값 | `standin.ts` 의 감쇠 선형 추세 (실행안 기준 모델) |
| 질의응답 | 물을 때 | 이 환자 질문은 기준 시각까지의 사례 자료와 에이전트 출력으로, 지식 질문은 근거 위키를 검색해 답하고 원문과 쪽수를 붙임. 근거가 없거나 치료 결정 질문이면 답하지 않음 | `qa.ts` (이 환자), `rag.ts` + 근거 위키 (지식), 답 생성 서버 (선택) |

재생 중에는 첫 경보, 첫 이상, 5배 사건, 퇴실 시점에서 멈추고 그 에이전트를 보여 줍니다. 첫 이상 때는 원인 추정이 단계별로 실행되는 모습을 보여 줍니다.

## 구성

| 위치 | 내용 |
|---|---|
| `src/types.ts` | 자료 형식. 사례 자료, 사건, 에이전트 출력 (`A1Point`, `A2Output`, `A4Forecast`, `AgentRun`, `CauseCall`, `ModelOutputs`), 질의응답 (`QaMsg`) |
| `src/lib/events.ts` | 정의와 상수. 공개 시각, 사건 찾기, 정상 구간, 퇴실 때 판정, 기준 시각에 보이는 기록 |
| `src/data/case01.ts` | 가상 사례 1 (쇼크 뒤 허혈성 손상, 회복 · 생존). 입실부터 퇴실까지 검사, 투약, 활력징후, 배양, 처치 |
| `src/data/runs.ts` | 사례 1 의 원인 추정 실행 기록 (도구 호출 단계, 범주 10개 규칙 점수와 근거) |
| `src/data/causes.ts` | 원인 범주 10개 (임상의 선생님 기준) |
| `src/data/models.ts` | 모델 1 (군집) 과 에이전트 2 출력 자리 (`placeholder: true`) |
| `src/data/standin.ts` | 에이전트 1, 4 의 대체 계산. 모델 출력을 받으면 바꿀 곳 |
| `src/data/qa.ts` | 질의응답: 질문을 이 환자와 지식으로 나누고, 이 환자 질문의 답을 기준 시각 자료로 계산 |
| `src/data/rag.ts` | 지식 질문: 근거 위키 검색, 답 생성 서버가 있으면 서버에 답을 맡김 |
| `src/lib/bm25.ts`, `src/lib/wiki.ts`, `src/lib/md.ts` | 위키 검색 (BM25, 한글 두 글자), 질문 낱말 넓히기, 위키 마크다운 그리기 |
| `public/wiki/kb.json` | 근거 위키를 화면용으로 바꾼 파일 (`npm run wiki`). 위키 페이지와 검색 조각만 있고 원문 PDF 는 없음 |
| `server/rag-server.mjs` | 답 생성 서버 (선택). LLM 호출과 인용 확인 |
| `scripts/build-wiki.mjs` | `wiki_kb` → `public/wiki/kb.json` |
| `src/data/index.ts` | `getSim`: 사례 하나의 정시 목록, 사건, 에이전트별 실행 구간과 출력 |
| `src/data/patients.ts` | 재원 환자 목록. `plannedScenario` 는 아직 만들지 않은 사례의 계획 (화면에 안 나옴) |
| `src/components/agent/` | 에이전트 카드, 에이전트별 상세 화면, 원인 범주 목록 (`Result.tsx`), 질의응답 (`QnA.tsx`) |
| `src/components/WikiModal.tsx` | 근거 위키 보기 (절로 바로 가기, 위키 링크와 인용 따라가기) |
| `src/assets/snuh_logo_white.svg`, `public/favicon.svg` | 상단 로고 (남색 바탕용) 와 브라우저 탭 아이콘. 원본은 `snuh_logo.svg` |
| `src/styles.css` | 맨 위 `:root` 의 색과 글꼴 값만 바꾸면 전체 모양이 바뀝니다 |

## 모델 출력 넣기

- 에이전트 1: 정상 구간의 정시마다 `{ time, p, factors }` (`A1Point[]`). `getSim` 에서 `agent1At` 대신 이 배열을 쓰면 됩니다. 정상 구간 판단은 `normalAt` 이 합니다.
- 에이전트 2: 사례마다 `{ probs: { 'rec-alive', 'rec-dead', 'norec-dead', 'norec-alive' }, icuDeath, factors }` 를 `models.ts` 에 넣습니다.
- 에이전트 3: 사례마다 `AgentRun` (`calls` 에 범주 10개의 `score` 와 근거, `steps` 에 도구 호출 단계) 을 `runs.ts` 에 넣습니다.
- 에이전트 4: 정시마다 항목별 `{ code, last, points: [{ h, time, v, lo, hi }] }` (`h` 는 6, 12, 18, 24, `lo` 와 `hi` 는 10%, 90%). `getSim` 의 `a4.at` 을 바꿉니다.
- 모델 1: `models.ts` 의 `model1` (군집 번호, 확신도, 설명표 문장).

## 질의응답과 근거 위키 (RAG)

**검색 (서버 없이, GitHub Pages 에서도 됨)**
- `../wiki_kb` 는 원문 13편으로 만든 llm_wiki 형식의 한국어 위키입니다 (페이지 63, 조각 451). 문장마다 원문과 PDF 쪽수가 붙어 있습니다.
- `npm run wiki` 가 위키 페이지와 검색 조각을 `public/wiki/kb.json` 하나로 묶습니다. 원문 PDF (`wiki_kb/raw/`) 는 저작권 때문에 넣지 않고 git 에서도 뺍니다.
- 브라우저가 이 파일을 받아 BM25 로 검색합니다 (wiki_kb 색인과 같은 k1 1.5, b 0.75, 한글 두 글자). 원래 색인 스크립트는 받지 못해 토큰 나누기는 새로 짰고, 한국어 질문을 위키 표기 (영문 약물명 등) 로 넓히는 낱말표가 `src/lib/wiki.ts` 에 있습니다.
- 서버가 없으면 찾은 조각 3개를 그대로 보여 줍니다. 점수가 낮으면 '근거 약함', 맞는 조각이 없으면 답하지 않습니다.

**답 생성 (선택, 서버 필요)**
- 찾은 조각과 질문을 서버로 보내면 LLM 이 그 조각 안에서만 답을 쓰고, 서버가 인용을 확인합니다 (문장마다 조각 번호, 숫자가 인용한 조각에 그대로 있는지).
- LLM 은 OpenAI 호환 주소면 무엇이든 됩니다. 실제 자료에는 기관 승인 무보존 엔드포인트만 씁니다. 키는 환경 변수로만 넣습니다.

```bash
LLM_BASE_URL=<OpenAI 호환 주소>/v1 LLM_MODEL=<모델> LLM_API_KEY=<키> npm run rag-server   # http://127.0.0.1:8787
# 화면을 http://localhost:5173/?rag=http://localhost:8787 로 한 번 열면 기억합니다. ?rag=off 로 끔
```

GitHub Pages 화면에서 이 컴퓨터의 서버를 부르면 크롬이 로컬 네트워크 접근을 물을 수 있습니다 (허용하면 됨).

**원인 추정의 지침 근거**: `runs.ts` 의 범주별 지침 근거는 위키의 '원인 10개 근거 지도' 문장을 그대로 옮긴 것입니다. 누르면 위키의 그 절이 열립니다.

## 사례 추가

1. `src/data/caseNN.ts` 를 `case01.ts` 와 같은 형식으로 만듭니다 (`icuIn`, `icuOut`, `outcome` 필수).
2. `src/data/runs.ts` 에 원인 추정 실행 기록을, `src/data/models.ts` 에 모델 1 과 에이전트 2 출력을 넣습니다.
3. `src/data/index.ts` 의 `cases` 에 추가하고, `patients.ts` 의 해당 환자에 `caseId` 를 붙입니다.

근거의 `ref` (`{ tab, row, col | from, to }`) 가 원자료 탭의 행 id 와 맞아야 '원자료 ›' 나 질의응답 출처를 눌렀을 때 그 칸으로 이동합니다.
