# 불확실성 분석 (불확실성 기획안 10/17)

모델 패키지의 고정 모델 (MIMIC-IV 학습) 을 다시 학습하지 않고, 그 출력 위에서 불확실성 표시를 계산하고 검증한다. 같은 코드를 MIMIC (로컬) 과 K-MIMIC (서버) 에 돌린다. 결과는 집계 JSON 하나이고 환자 식별 번호가 없으며 10 미만 칸은 가린다.

| 파일 | 하는 일 | 기획안 |
|---|---|---|
| `run_notebook_cells.py` | 패키지 분석 노트북에서 모델 입력용 중간 파일을 만드는 셀 (6, 8, 10, 12, 14, 16, 25) 만 실행. 셀 코드는 그대로, 자료 위치와 큰 표 읽기 메모리만 바꿈 | 준비 |
| `stage1.py` | 발생 예측: 심각도 사다리, 구간과 줄이는 검사, 결과 대기, 보정 구간과 재보정, 확신 규칙 1~5, 정답 불확실성 범위, 확신별 성능과 보류 곡선, 가림 시험 | 4-1, 4-2, 4-3, 4-4, 4-7, 4-8, 5장 |
| `stage3.py` | 예후 경로 집합 (conformal, 90%) 과 궤적 띠 (CQR, 80%). 다른 자료에서 정한 기준값을 그대로 적용하는 이식 시험 | 4-5 |
| `stage4.py` | 원인 판정의 단단함: 원인별 근거 완성도, 검사값 ±10% 에 0/1 이 뒤집히는 판정 취약 (규칙 모델, 첫 이상 시점) | 4-6 |
| `summarize.py` | 결과 JSON 을 문서용 표 (마크다운) 로 | |

정의는 화면 (`web/model-bridge/run_models.py`, `web/src/lib/uncertainty.ts`) 과 같다.

## MIMIC (로컬)

환자 단위 출력은 `local_mimic/` (git 제외) 에만 둔다. PhysioNet 약관에 따라 환자 단위 자료는 이 컴퓨터 밖으로 보내지 않는다.

```bash
PY=web/.venv-models/bin/python          # Python 3.11, scikit-learn 1.9.0 (모델 카드와 같은 판)
PKG=kcd_model_package_20261017_0043
MIMIC=<MIMIC-IV v3.1 폴더 (hosp/, icu/)>
$PY -I uncertainty/run_notebook_cells.py --package $PKG --data-root $MIMIC --work local_mimic/full
OUT=local_mimic/full/kcd_liver_v2_outputs
$PY -I uncertainty/stage1.py --package $PKG --out-dir $OUT --data-root $MIMIC \
    --exclude-subjects $PKG/reference/mimic_iv_demo_subject_ids.csv --site mimic-iv --result local_mimic/stage1_mimic.json
$PY -I uncertainty/stage3.py --package $PKG --out-dir $OUT --data-root $MIMIC \
    --exclude-subjects $PKG/reference/mimic_iv_demo_subject_ids.csv --site mimic-iv --result local_mimic/stage3_mimic.json
$PY -I uncertainty/stage4.py --package $PKG --out-dir $OUT --data-root $MIMIC \
    --exclude-subjects $PKG/reference/mimic_iv_demo_subject_ids.csv --site mimic-iv --result local_mimic/stage4_mimic.json
$PY -I uncertainty/summarize.py --stage1 local_mimic/stage1_mimic.json --stage3 local_mimic/stage3_mimic.json \
    --stage4 local_mimic/stage4_mimic.json > local_mimic/summary_mimic.md
```

10/17 로컬 실행 시간 (16GB 노트북): 셀 실행 23분 (최대 메모리 5.4 GB), stage1 5분, stage3 3분, stage4 수 분.

- 공개 데모 100명은 모델 학습과 평가에서 빠졌으므로 여기서도 뺀다.
- `stage1.py` 의 5배 AUROC 가 모델 카드 값 (0.9000) 과 같으면 같은 코호트와 같은 분할이다 (`reproduction`).
- MIMIC 은 개발 집단이 모델 학습에 쓰였으므로 재보정과 conformal 기준은 평가 집단을 환자 단위로 반 나눠 정하고 확인한다.

## K-MIMIC (서버, 병원마다)

외부 검증 노트북 (`KCD_EXTERNAL.ipynb`) 1단계가 만든 출력 폴더 (`external_work/external/kcd_liver_v2_outputs`) 에 돌린다.

```bash
# 순수 외부 검증: 모든 환자를 평가로, 규칙 4 기준과 conformal 기준은 MIMIC 값을 그대로 (이식 시험)
python uncertainty/stage1.py --package <패키지> --out-dir <출력 폴더> --data-root <MIMIC 형식 자료> \
    --site kmimic-<병원> --all-evaluation --width-limit <stage1_mimic.json 의 width_limit.value> --result stage1_<병원>.json
python uncertainty/stage3.py --package <패키지> --out-dir <출력 폴더> --data-root <MIMIC 형식 자료> \
    --site kmimic-<병원> --all-evaluation --apply-from stage3_mimic.json --result stage3_<병원>.json
python uncertainty/stage4.py --package <패키지> --out-dir <출력 폴더> --data-root <MIMIC 형식 자료> \
    --site kmimic-<병원> --all-evaluation --result stage4_<병원>.json
# 병원 자체 기준 (모델 갱신, 따로 보고): 병원 개발 70% 에서 재보정과 conformal 기준을 정하고 평가 30% 에서 확인
python uncertainty/stage1.py ... --recal-fit development
python uncertainty/stage3.py ... --fit-on development
```

- 모델 파일은 Python 3.11, scikit-learn 1.9.0 으로 저장되어 있다. KHDP (Python 3.8) 에서는 이 판을 설치할 수 없으므로 환경을 먼저 맞춰야 한다.
- 결과 JSON 만 반출한다. 반출 전에 환자 식별 키가 없는지 확인한다 (외부 검증 노트북 3단계와 같은 검사).
