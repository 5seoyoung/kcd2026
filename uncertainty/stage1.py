"""불확실성 1단계 (불확실성 기획안 10/17). 고정 모델 출력 위에서만 계산하고 다시 학습하지 않는다.

다루는 것 (발생 예측): 4-1 심각도 사다리, 4-2 구간과 줄이는 검사, 4-3 결과 대기, 4-4 보정 구간과 재보정,
4-7 확신 규칙 1~5, 4-8 정답 불확실성 범위, 5장 표시 검증 (확신별 성능, 보류 곡선). 예후와 궤적의 conformal 은 stage3.py.

입력: 패키지 분석 노트북 출력 (01_cohort, 03_labs, 05_events, 07_context) 과 패키지 모델.
출력: 집계 JSON 하나 (환자 식별 번호 없음, 10 미만 칸 가림). 같은 코드를 MIMIC (로컬) 과 K-MIMIC (서버) 에 돌린다.

  python uncertainty/stage1.py --package <모델 패키지> --out-dir <노트북 출력 폴더> --data-root <hosp/ 가 있는 폴더> \
      [--exclude-subjects <패키지>/reference/mimic_iv_demo_subject_ids.csv] --site mimic-iv --result <결과 json>

정의 (화면 web/model-bridge/run_models.py 와 같음)
- 대상 시각: 정상 구간 (ALT, ALP, 총빌리를 모두 24시간 안에 쟀고 모두 2배 미만) 의 매시간, 첫 이상 전 (패키지 agent3_landmarks)
- 사다리: 같은 입력으로 2, 3, 4배 모델과 5배 모델 (agent3_gbm)
- 구간: 빠진 핵심 입력 (간 검사 4개, INR, 젖산, 크레아티닌) 은 변수 묶음을 기준 행 10개로 바꿔 넣고,
  잰 핵심 입력은 ±10% 격자 (항목마다 따로 섞은 10칸) 로 흔든 예측의 10~90%
- 확신 규칙 (미리 고정): 1 핵심 입력 2개 이상 24시간 안 측정 없음, 2 주요 변수 22개 중 하나라도 기준 행 5~95% 밖,
  3 입력 오류 검사 보류값 (검사 24시간, 활력징후 6시간, 나이), 4 구간 폭이 개발 집단 표본의 상위 25% 폭 이상,
  5 사다리에서 높은 배수 확률이 바로 아래 배수보다 큼
- 무거운 계산 (구간, 줄이는 검사, 결과 대기 뒤 변화) 은 미리 정한 표본에서만: 환자마다 무작위 한 시각 (시드 20261016).
  개발 집단 표본은 규칙 4 의 기준을 정하는 데만, 평가 집단 표본은 평가에만 쓴다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261016
CORE = ["ALT", "AST", "ALP", "TBIL", "INR", "LACTATE", "CREAT"]
BLOCK = ("_latest", "_age_h", "_n24", "_delta24")
RANGE_FEATS = ["ALT_latest", "AST_latest", "ALP_latest", "TBIL_latest", "INR_latest", "ALBUMIN_latest", "LACTATE_latest",
               "CREAT_latest", "BUN_latest", "NTPROBNP_latest", "age", "PLATELET_latest", "WBC_latest", "SODIUM_latest",
               "GLUCOSE_latest", "BICARB_latest", "HEMOGLOBIN_latest", "MAP_latest", "HR_latest", "RR_latest", "SPO2_latest",
               "TEMP_C_latest"]
LADDER = {2: "agent3_gbm_2x.joblib", 3: "agent3_gbm_3x.joblib", 4: "agent3_gbm_4x.joblib", 5: "agent3_gbm.joblib"}
MASKABLE = ["AST", "INR", "LACTATE", "CREAT"]  # ALT, ALP, 총빌리는 정상 구간이면 늘 잰 상태
ERR, NOISE = 0.10, 10
CORE_MISSING_MIN = 2
WIDTH_Q = 0.75
TOLS = [0.0, 0.005, 0.01, 0.02]
ALARMS = [0.1, 0.2, 0.3]
BANDS = [0, .01, .05, .1, .3, 1.0001]
VITALS = ["MAP", "HR", "RR", "SPO2", "TEMP_C"]
_TEXT: dict = {}


def log(msg: str):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def shared(s: pd.Series) -> pd.Series:
    return s.map(lambda x: _TEXT.setdefault(x, x) if isinstance(x, str) else x)


# ------------------------------------------------------------------ 자료
def load(out_dir: Path, exclude: set, pressors: str):
    """패키지 load_private 와 같은 형식. 맥락은 발생 예측 변수에 쓰는 행 (활력징후 5종, 승압제 주입 기록) 만 읽는다
    (build_features 결과는 전체를 읽은 것과 같고, 메모리는 크게 줄어듦)."""
    rd = lambda n, **k: pd.read_csv(out_dir / n, low_memory=False, **k)
    cohort = rd("01_cohort_private.csv")
    for c in ["intime", "outtime", "admittime", "dischtime", "deathtime", "dod", "monitor_end", "obs_end"]:
        if c in cohort:
            cohort[c] = pd.to_datetime(cohort[c], errors="coerce").astype("datetime64[ns]")
    lab = rd("03_labs_private.csv", usecols=lambda c: c in {"stay_id", "analyte", "value", "ratio", "charttime", "available_at", "valid_value"})
    for c in ["charttime", "available_at"]:
        lab[c] = pd.to_datetime(lab[c], errors="coerce").astype("datetime64[ns]")
    lab = lab[lab.valid_value.astype(str).str.lower().eq("true")] if lab.valid_value.dtype == object else lab[lab.valid_value]
    lab = lab.drop(columns="valid_value")
    lab["analyte"] = shared(lab.analyte)
    events = rd("05_events_private.csv")
    events["t0"] = pd.to_datetime(events.t0).astype("datetime64[ns]")
    parts = []
    for ch in pd.read_csv(out_dir / "07_context_private.csv", usecols=["stay_id", "charttime", "available_at", "kind", "label", "value"],
                          chunksize=2_000_000, low_memory=False):
        keep = (ch.kind.eq("vital") & ch.label.isin(VITALS)) | (
            ch.kind.eq("infusion_record") & ch.label.astype(str).str.contains(pressors, case=False, na=False))
        ch = ch[keep].copy()
        ch["value"] = np.where(ch.kind.eq("vital"), pd.to_numeric(ch.value, errors="coerce"), np.nan)
        for c in ["charttime", "available_at"]:
            ch[c] = pd.to_datetime(ch[c], errors="coerce").astype("datetime64[ns]")
        ch["kind"], ch["label"] = shared(ch.kind), shared(ch.label.astype(str))
        parts.append(ch)
    context = pd.concat(parts, ignore_index=True)
    for d in (lab, context, events, cohort):
        d.dropna(subset=["stay_id"], inplace=True)
        d["stay_id"] = d["stay_id"].astype("int64")
    n_excl = int(cohort.subject_id.isin(exclude).sum())
    cohort = cohort[~cohort.subject_id.isin(exclude)].copy()
    keep = set(cohort.stay_id)
    lab, context, events = lab[lab.stay_id.isin(keep)], context[context.stay_id.isin(keep)], events[events.stay_id.isin(keep)].copy()
    return cohort, lab.reset_index(drop=True), events, context.reset_index(drop=True), n_excl


def read_hosp(root: Path | None, name: str, usecols):
    if root is None:
        return None
    for ext in (".csv.gz", ".csv"):
        p = root / "hosp" / f"{name}{ext}"
        if p.exists():
            return pd.read_csv(p, usecols=usecols, low_memory=False)
    return None


# ------------------------------------------------------------------ 모델
def prob(bundle, A) -> np.ndarray:
    if isinstance(A, np.ndarray):
        A = pd.DataFrame(A, columns=bundle["features"])
    return bundle["model"].predict_proba(A[bundle["features"]].astype(float))[:, 1]


class Interval:
    """화면 연결부 interval() 와 같은 계산을 여러 시각에 한꺼번에 (예측은 묶어서 한 번에)."""

    def __init__(self, bundle, bg: pd.DataFrame):
        self.b = bundle
        cols = bundle["features"]
        ci = {c: i for i, c in enumerate(cols)}
        self.blk = {a: np.array([ci[a + s] for s in BLOCK]) for a in CORE}
        self.lat = {a: ci[a + "_latest"] for a in CORE}
        self.dlt = {a: ci[a + "_delta24"] for a in CORE}
        self.bg = bg[cols].to_numpy(float)
        self.n = len(self.bg)
        rng = np.random.default_rng(SEED)
        grid = np.linspace(1 - ERR, 1 + ERR, NOISE)
        self.shake = {a: rng.permutation(grid) for a in CORE}

    def build(self, x, miss, ib, im, fixed=None, shake=True):
        R = np.repeat(x[None, :], len(ib), axis=0)
        for a in miss:
            ix = fixed[1] if fixed is not None and fixed[0] == a else ib
            R[:, self.blk[a]] = self.bg[ix][:, self.blk[a]]
        if shake:
            for a in CORE:
                if a in miss:
                    continue
                d = x[self.lat[a]] * (self.shake[a][im] - 1)
                R[:, self.lat[a]] = x[self.lat[a]] + d
                if not np.isnan(x[self.dlt[a]]):
                    R[:, self.dlt[a]] = x[self.dlt[a]] + d
        return R

    def run(self, X: np.ndarray, next_test=False, shake=True, only=None, batch_rows=300_000):
        """X: 시각마다 한 줄 (모델 변수 순서). only: 이 항목만 대체 (흔들기 없이 쓰는 가림 시험용).
        반환: 시각마다 (빠진 항목, lo, hi, [(항목, lo, hi)])"""
        n, out, jobs, buf, size = self.n, [None] * len(X), [], [], 0

        def flush():
            nonlocal buf, size, jobs
            if not buf:
                return
            P = prob(self.b, np.concatenate(buf))
            k = 0
            for r, kind, a, m, shape in jobs:
                p = P[k:k + m]
                k += m
                if kind == "main":
                    lo, hi = np.quantile(p, [.1, .9])
                    out[r][1], out[r][2] = float(lo), float(hi)
                else:
                    q = np.quantile(p.reshape(shape), [.1, .9], axis=1)
                    out[r][3].append((a, float(q[0].mean()), float(q[1].mean())))
            buf, size, jobs = [], 0, []

        for r, x in enumerate(X):
            miss = [a for a in CORE if np.isnan(x[self.lat[a]])] if only is None else [only]
            out[r] = [miss, None, None, []]
            nb = n if miss else 1
            ns_ = NOISE if shake else 1
            ib, im = np.repeat(np.arange(nb), ns_), np.tile(np.arange(ns_), nb)
            R = self.build(x, miss, ib, im, shake=shake)
            buf.append(R); size += len(R); jobs.append((r, "main", None, len(R), None))
            if next_test:
                for a in miss:
                    nr = n if len(miss) > 1 else 1
                    j = np.repeat(np.arange(n), nr * NOISE)
                    ib, im = np.tile(np.repeat(np.arange(nr), NOISE), n), np.tile(np.arange(NOISE), n * nr)
                    R = self.build(x, miss, ib, im, fixed=(a, j))
                    buf.append(R); size += len(R); jobs.append((r, "next", a, len(R), (n, nr * NOISE)))
            if size >= batch_rows:
                flush()
        flush()
        for o in out:
            o[3].sort(key=lambda t: t[2] - t[1])
        return out


# ------------------------------------------------------------------ 규칙
def guard_flags(rows: pd.DataFrame, lab, context, cohort):
    """확신 규칙 3: 패키지 입력 오류 검사에서 보류된 값 (검사 24시간 안, 활력징후 6시간 안, 나이). 화면 guard_at 과 같음."""
    from kcd_liver.data_errors import AGE_RANGE, VITAL_RANGE, guard_lab
    R = rows[["stay_id", "t"]].reset_index(drop=True).assign(_i=lambda d: np.arange(len(d)))
    stays = set(R.stay_id)
    out = {"lab": np.zeros(len(R), bool), "vital": np.zeros(len(R), bool), "age": np.zeros(len(R), bool)}
    _, held = guard_lab(lab[lab.stay_id.isin(stays)])
    if len(held):
        m = R.merge(held[["stay_id", "charttime", "available_at"]], on="stay_id")
        m = m[(m.available_at <= m.t) & (m.charttime >= m.t - pd.Timedelta(hours=24))]
        out["lab"][m._i.unique()] = True
    v = context[context.kind.eq("vital") & context.stay_id.isin(stays)]
    bad = np.zeros(len(v), bool)
    for k, (lo, hi) in VITAL_RANGE.items():
        s = v.label.eq(k).to_numpy()
        bad |= s & ~v.value.between(lo, hi).to_numpy()
    v = v[bad]
    if len(v):
        m = R.merge(v[["stay_id", "charttime", "available_at"]], on="stay_id")
        m = m[(m.available_at <= m.t) & (m.charttime >= m.t - pd.Timedelta(hours=6))]
        out["vital"][m._i.unique()] = True
    age = R.stay_id.map(cohort.drop_duplicates("stay_id").set_index("stay_id").age)
    out["age"] = (~age.between(*AGE_RANGE)).to_numpy()
    out["any"] = out["lab"] | out["vital"] | out["age"]
    return out


def rules(X: pd.DataFrame, P: dict, ref: dict, guard: dict, width=None, width_limit=None, tol=0.0) -> dict:
    """확신 규칙 1~5 (규칙 4 는 width 가 있을 때만)"""
    miss = np.stack([X[f"{a}_latest"].isna().to_numpy() for a in CORE], 1)
    oor = np.stack([X[f].notna().to_numpy() & ~X[f].between(*ref[f]).to_numpy() for f in RANGE_FEATS], 1)
    inv = np.zeros(len(X), bool)
    for k in (3, 4, 5):
        inv |= (P[k] - P[k - 1]) > tol
    r = {"r1": miss.sum(1) >= CORE_MISSING_MIN, "r2": oor.any(1), "r3": guard["any"], "r5": inv,
         "missing_count": miss.sum(1), "oor_count": oor.sum(1), "missing": miss, "oor": oor}
    if width is not None:
        r["r4"] = width >= width_limit
    r["n_rules"] = sum(r[k].astype(int) for k in ("r1", "r2", "r3", "r4", "r5") if k in r)
    r["low"] = r["n_rules"] > 0
    return r


def pending_counts(rows: pd.DataFrame, lab) -> pd.DataFrame:
    """그 시각에 채혈했지만 아직 보고 전인 핵심 검사 수 (채혈 시각 ≤ t < 공개 시각) = t 까지 채혈한 수 - t 까지 공개된 수"""
    core = lab[lab.analyte.isin(CORE)][["stay_id", "charttime", "available_at"]]
    R = rows[["stay_id", "t"]].reset_index(drop=True).assign(_i=lambda d: np.arange(len(d)))
    R["t"] = R.t.astype("datetime64[ns]")
    res = {}
    for col in ("charttime", "available_at"):
        e = core[["stay_id", col]].dropna().sort_values(["stay_id", col])
        e["k"] = e.groupby("stay_id").cumcount() + 1
        e = e.groupby(["stay_id", col], as_index=False).k.max().sort_values(col)  # 같은 시각 (같은 채혈) 은 마지막 누적 수로
        m = pd.merge_asof(R.sort_values("t"), e, left_on="t", right_on=col, by="stay_id", direction="backward").sort_values("_i")
        res[col] = m.k.fillna(0).to_numpy()
    return (res["charttime"] - res["available_at"]).clip(min=0)


def recalibration(D, K: pd.DataFrame, y: np.ndarray, p: np.ndarray, fit_on: str, boot: int) -> dict:
    """4-4. K: 정답을 아는 시각 (split, subject_id). 순수 외부 검증과 따로 '모델 갱신' 으로 보고한다."""
    from sklearn.isotonic import IsotonicRegression
    from sklearn.linear_model import LogisticRegression
    if fit_on == "halves":
        pts = K.subject_id.drop_duplicates().sample(frac=1, random_state=SEED)
        fit_ids = set(pts.iloc[: len(pts) // 2])
        fit = K.subject_id.isin(fit_ids).to_numpy()
    else:
        fit = K.split.eq("development").to_numpy()
    test = ~fit
    lp = lambda v: np.log(np.clip(v, 1e-6, 1 - 1e-6) / (1 - np.clip(v, 1e-6, 1 - 1e-6))).reshape(-1, 1)
    out = {"fit_on": fit_on, "fit_rows": int(fit.sum()), "test_rows": int(test.sum())}
    if len(np.unique(y[fit])) < 2 or len(np.unique(y[test])) < 2:
        return {**out, "status": "insufficient"}
    lr = LogisticRegression(C=1e6, max_iter=2000).fit(lp(p[fit]), y[fit])
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(p[fit], y[fit])
    cands = {"original": p[test], "logistic": lr.predict_proba(lp(p[test]))[:, 1], "isotonic": iso.predict(p[test])}
    g = K.subject_id.to_numpy()[test]
    keep = ("n", "events", "prevalence", "auroc", "auprc", "brier", "brier_ci", "cal_intercept", "cal_slope", "top10_ppv")
    for name, pp in cands.items():
        mt = D.binary_metrics(y[test], pp, g, boot)
        cv = D.curves(y[test], pp)
        out[name] = {**{k: mt.get(k) for k in keep}, "deciles": cv["calibration"] if cv else None}
    out["logistic_coef"] = {"intercept": float(lr.intercept_[0]), "slope": float(lr.coef_[0][0])}
    return out


# ------------------------------------------------------------------ 집계 도우미
class Agg:
    def __init__(self, min_cell):
        self.min_cell = min_cell

    def n(self, x) -> int | None:
        x = int(x)
        return None if self.min_cell and 0 < x < self.min_cell else x


def q(x, qs=(.1, .25, .5, .75, .9)) -> dict | None:
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    return {f"p{int(round(v * 100))}": float(np.quantile(x, v)) for v in qs} if len(x) else None


def rate(m) -> float | None:
    m = np.asarray(m, bool)
    return float(m.mean()) if len(m) else None


def logit_width(iv) -> np.ndarray:
    """구간 폭을 로짓 척도로 (확률이 클수록 %p 폭도 커지는 것을 덜어 냄)"""
    lo = np.clip(np.array([o[1] for o in iv]), 1e-4, 1 - 1e-4)
    hi = np.clip(np.array([o[2] for o in iv]), 1e-4, 1 - 1e-4)
    return np.log(hi / (1 - hi)) - np.log(lo / (1 - lo))


def short(f: str) -> str:
    return f[: -len("_latest")] if f.endswith("_latest") else f


def band_of(p):
    return pd.cut(p, BANDS, right=False, labels=["<1%", "1~5%", "5~10%", "10~30%", "≥30%"])


# ------------------------------------------------------------------ 본체
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, default=None, help="hosp/admissions, hosp/diagnoses_icd 가 있는 폴더 (과거력)")
    ap.add_argument("--exclude-subjects", type=Path, default=None)
    ap.add_argument("--site", default="mimic-iv")
    ap.add_argument("--result", type=Path, required=True)
    ap.add_argument("--min-cell", type=int, default=10)
    ap.add_argument("--boot", type=int, default=100)
    ap.add_argument("--max-sample", type=int, default=None, help="표본 환자 수 상한 (점검용)")
    ap.add_argument("--recal-fit", choices=["halves", "development"], default="halves",
                    help="재보정을 맞추는 곳. halves: 평가 집단 환자를 반으로 나눠 앞 반에서 맞추고 뒤 반에서 확인 (MIMIC: 개발 집단은 모델 학습에 씀). "
                         "development: 그 병원의 개발 70%% 에서 맞추고 평가 30%% 에서 확인 (K-MIMIC)")
    ap.add_argument("--all-evaluation", action="store_true",
                    help="모든 환자를 평가 집단으로 (순수 외부 검증). 규칙 4 기준은 --width-limit 로 줌 (예: MIMIC 결과의 width_limit)")
    ap.add_argument("--eval-rows", choices=["all-known", "one-per-patient"], default="all-known",
                    help="구간, 확신, 보류 곡선을 계산할 평가 시각: 정답을 아는 모든 시각 (기본, --max-sample 이 있으면 그만큼 무작위) 또는 환자마다 한 시각")
    ap.add_argument("--width-limit", type=float, default=None, help="규칙 4 폭 기준을 이 값으로 고정 (없으면 이 자료의 개발 집단 표본에서 정함)")
    a = ap.parse_args(argv)
    if a.all_evaluation and a.width_limit is None:
        raise SystemExit("--all-evaluation 에는 --width-limit 가 필요합니다 (개발 집단이 없음)")
    if a.all_evaluation and a.recal_fit == "development":
        raise SystemExit("--all-evaluation 에서는 --recal-fit halves 만 됩니다")
    t_start = time.time()
    pkg = a.package.resolve()
    sys.path.insert(0, str(pkg))
    import joblib
    import sklearn
    from kcd_liver import develop as D

    card = (pkg / "MODEL_CARD.md").read_text(encoding="utf-8")
    need = re.search(r"scikit-learn ([0-9.]+)", card).group(1)
    if sklearn.__version__ != need:
        raise SystemExit(f"scikit-learn {need} 이 필요합니다 (지금 {sklearn.__version__})")
    card_auroc = float(re.search(r"Agent 3 AUROC ([0-9.]+)", card).group(1))
    A = Agg(a.min_cell)
    rng = np.random.default_rng(SEED)

    # ---- 자료와 모델
    exclude = set(pd.read_csv(a.exclude_subjects).subject_id) if a.exclude_subjects else set()
    log("자료 읽기")
    cohort, lab, events, context, n_excl = load(a.out_dir, exclude, D.PRESSORS)
    adm = read_hosp(a.data_root, "admissions", ["subject_id", "hadm_id", "dischtime"])
    dx = read_hosp(a.data_root, "diagnoses_icd", ["subject_id", "hadm_id", "icd_code", "icd_version"])
    hist = D.history_flags(cohort, adm, dx)
    del adm, dx
    if a.all_evaluation:
        cohort["split"], events["split"] = "evaluation", "evaluation"
    log(f"코호트 {len(cohort):,}, 검사 {len(lab):,}, 맥락 (변수용) {len(context):,}, 사건 {len(events):,}")
    M = {k: joblib.load(pkg / "models" / f) for k, f in LADDER.items()}
    b5 = M[5]
    cols = b5["features"]
    for k in (2, 3, 4):
        assert M[k]["features"] == cols, "사다리 모델의 변수 목록이 다름"
    bg = b5["background"].reset_index(drop=True)
    ref = {f: (float(bg[f].min()), float(bg[f].max())) for f in RANGE_FEATS}
    shaker = Interval(b5, bg)

    # ---- 대상 시각 (정상 구간) 과 5배 정답
    log("대상 시각 만들기")
    L = D.agent3_landmarks(cohort, lab, events, step_hours=1)
    elig = L[L.eligible].reset_index(drop=True)
    elig["label"] = D.agent3_labels(elig, lab).values
    KNOWN = ["abnormal_observed", "no_abnormality_observed"]
    E = elig[elig.split.eq("evaluation")].reset_index(drop=True)
    Dv = elig[elig.split.eq("development")].reset_index(drop=True)
    log(f"정상 구간 시각: 전체 {len(L):,} 중 {len(elig):,} (평가 {len(E):,}, 개발 {len(Dv):,})")

    feat = lambda rows: D.build_features(rows[["stay_id", "t"]], lab, context, cohort, hist).reindex(columns=cols).astype(float)
    log("평가 집단 변수 계산")
    XE = feat(E)
    PE = {k: prob(M[k], XE) for k in LADDER}

    R = {"meta": {"site": a.site, "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": SEED,
                  "package": pkg.name, "sklearn": sklearn.__version__, "python": sys.version.split()[0],
                  "min_cell_suppression": a.min_cell, "excluded_subjects_in_cohort": n_excl,
                  "definitions": {"core": CORE, "error_range": ERR, "noise_rows": NOISE, "core_missing_min": CORE_MISSING_MIN,
                                  "width_quantile": WIDTH_Q, "range_features": len(RANGE_FEATS), "ladder_tolerances": TOLS}},
         "counts": {"cohort_stays": A.n(len(cohort)), "landmarks": A.n(len(L)), "eligible": A.n(len(elig)),
                    "eligible_evaluation": A.n(len(E)), "eligible_development": A.n(len(Dv)),
                    "evaluation_patients": A.n(E.subject_id.nunique()), "development_patients": A.n(Dv.subject_id.nunique())}}

    # ---- 재현 확인 (모델 카드 5배 AUROC) 과 4-1 배수별 성능
    log("배수별 성능")
    by_k = []
    for k in LADDER:
        lk = E.label.values if k == 5 else D.agent3_labels(E, lab, threshold=float(k)).values
        kn = np.isin(lk, KNOWN)
        y = (lk[kn] == "abnormal_observed").astype(int)
        mt = D.binary_metrics(y, PE[k][kn], E.subject_id.values[kn], a.boot)
        by_k.append({"k": k, **{kk: (A.n(v) if kk in ("n", "events", "patients") else v) for kk, v in mt.items()}})
    R["ladder_by_threshold"] = by_k
    a5 = next(r for r in by_k if r["k"] == 5)["auroc"]
    R["reproduction"] = {"model_card_auroc": card_auroc, "auroc_here": a5, "same": bool(abs(a5 - card_auroc) < 1e-6)} if a.site == "mimic-iv" else None
    log(f"5배 AUROC {a5:.6f} (모델 카드 {card_auroc:.6f})")

    # ---- 4-1 사다리 뒤집힘 (평가 집단 모든 정상 구간 시각)
    diffs = np.stack([PE[k] - PE[k - 1] for k in (3, 4, 5)], 1)
    band = band_of(PE[5])
    inv = []
    for tol in TOLS:
        m = (diffs > tol).any(1)
        pt = pd.Series(m).groupby(E.subject_id.values).any()
        inv.append({"tol": tol, "hours_rate": rate(m), "patients_rate": float(pt.mean()),
                    "by_pair": {f"{k}>{k - 1}": rate(diffs[:, i] > tol) for i, k in enumerate((3, 4, 5))},
                    "by_p5_band": {str(b): rate(m[band == b]) for b in band.categories}})
    R["ladder_inversion"] = {"hours": A.n(len(E)), "by_tolerance": inv, "max_rise": q(diffs.max(1)),
                             "p5_band_hours": {str(b): A.n((band == b).sum()) for b in band.categories}}

    # ---- 규칙 3 (입력 오류) 과 결과 대기 수, 평가 집단 전체
    log("입력 오류 검사와 결과 대기")
    gE = guard_flags(E, lab, context, cohort)
    pendE = pending_counts(E, lab)
    rE = rules(XE, PE, ref, gE)
    knownE = E.label.isin(KNOWN).to_numpy()
    yE = E.label.eq("abnormal_observed").to_numpy().astype(int)

    def group_metrics(mask, y, p, groups):
        if mask.sum() == 0 or len(np.unique(y[mask])) < 2:
            return {"n": A.n(mask.sum()), "events": A.n(y[mask].sum()) if mask.sum() else 0}
        mt = D.binary_metrics(y[mask], p[mask], groups[mask], a.boot)
        if mt.get("cal_intercept") is not None and abs(mt["cal_intercept"]) > 20:
            mt["cal_intercept"] = None  # 사건이 적고 확률이 0 에 가까우면 계산이 발산함
        out = {kk: (A.n(v) if kk in ("n", "events", "patients") else v) for kk, v in mt.items()
               if kk in ("n", "events", "patients", "prevalence", "auroc", "auroc_ci", "auprc", "auprc_ci", "brier", "cal_intercept", "cal_slope")}
        out["mean_pred"] = float(p[mask].mean())
        return out

    low4 = rE["r1"] | rE["r2"] | rE["r3"] | rE["r5"]
    R["rules_all_hours"] = {
        "note": "평가 집단 모든 정상 구간 시각. 규칙 4 (구간 폭) 는 표본에서만 계산하므로 여기서는 1, 2, 3, 5 만",
        "rate": {k: rate(rE[k]) for k in ("r1", "r2", "r3", "r5")}, "low_without_r4": rate(low4),
        "r3_parts": {k: rate(gE[k]) for k in ("lab", "vital", "age")},
        "missing_rate_by_core": {c: rate(rE["missing"][:, i]) for i, c in enumerate(CORE)},
        "missing_count": {str(i): rate(rE["missing_count"] == i) for i in range(0, 5)},
        "oor_rate_by_feature": {short(f): rate(rE["oor"][:, i]) for i, f in enumerate(RANGE_FEATS)},
        "oor_count": {**{str(i): rate(rE["oor_count"] == i) for i in range(0, 6)}, "6+": rate(rE["oor_count"] >= 6)},
        "r2_alternatives": {f"oor>={j}": rate(rE["oor_count"] >= j) for j in (1, 2, 3, 4)},
        "r5_by_tolerance": {str(t): rate((diffs > t).any(1)) for t in TOLS},
        "pending_rate": rate(pendE > 0), "pending_count": q(pendE[pendE > 0]) if (pendE > 0).any() else None,
        "performance_known": {
            "all": group_metrics(knownE, yE, PE[5], E.subject_id.values),
            "high": group_metrics(knownE & ~low4, yE, PE[5], E.subject_id.values),
            "low": group_metrics(knownE & low4, yE, PE[5], E.subject_id.values),
            **{f"low_r{j}": group_metrics(knownE & rE[f"r{j}"], yE, PE[5], E.subject_id.values) for j in (1, 2, 3, 5)},
            **{f"high_r{j}": group_metrics(knownE & ~rE[f"r{j}"], yE, PE[5], E.subject_id.values) for j in (1, 2, 3, 5)}}}

    # ---- 4-4 보정 구간 (10분위 실제 발생률과 Wilson 95% 구간) 과 재보정 (절편과 기울기, 등위 회귀는 민감도)
    log("보정 구간과 재보정")
    R["calibration"] = recalibration(D, E[knownE].reset_index(drop=True), yE[knownE], PE[5][knownE], a.recal_fit, a.boot)

    # ---- 4-8 정답 불확실성 범위 (재측정이 없어 모르는 시각을 모두 음성 / 모두 양성)
    ins = E.label.eq("insufficient_measurement").to_numpy()
    lb = {}
    for name, fill in (("all_negative", 0), ("all_positive", 1)):
        m = knownE | ins
        y = np.where(ins, fill, yE)[m]
        lb[name] = {"auroc": D._auroc(y, PE[5][m]), "auprc": D._ap(y, PE[5][m]), "prevalence": float(y.mean())}
    R["label_bounds"] = {"label_share": {k: rate(E.label.eq(k)) for k in E.label.unique()}, "known_only": {
        "auroc": D._auroc(yE[knownE], PE[5][knownE]), "auprc": D._ap(yE[knownE], PE[5][knownE])}, **lb}

    # ---- 4-2 규칙 4 기준: 개발 집단 표본 (환자마다 무작위 정상 구간 한 시각) 의 구간 폭 상위 25%
    pick = lambda df, known_only: (df[df.label.isin(KNOWN)] if known_only else df).sample(frac=1, random_state=SEED).groupby("subject_id").head(1)
    width_limit = a.width_limit
    if len(Dv):
        Ds = pick(Dv, False)
        if a.max_sample:
            Ds = Ds.head(a.max_sample)
        log(f"개발 집단 표본 {len(Ds):,}시각: 구간")
        XD = feat(Ds)
        ivD = shaker.run(XD.to_numpy(float))
        wD = np.array([o[2] - o[1] for o in ivD])
        own = float(np.quantile(wD, WIDTH_Q))
        lwD = logit_width(ivD)
        R["logit_width_limit"] = float(np.quantile(lwD, WIDTH_Q))
        width_limit = own if width_limit is None else width_limit
        PD = {k: prob(M[k], XD) for k in LADDER}
        gD = guard_flags(Ds, lab, context, cohort)
        rD = rules(XD, PD, ref, gD, wD, width_limit)
        R["development_sample"] = {"n": A.n(len(Ds)), "width": q(wD), "width_q75_here": own,
                                   "rate": {k: rate(rD[k]) for k in ("r1", "r2", "r3", "r4", "r5")}, "low": rate(rD["low"]),
                                   "oor_rate_by_feature": {short(f): rate(rD["oor"][:, i]) for i, f in enumerate(RANGE_FEATS)}}
    R["width_limit"] = {"value": width_limit, "source": "given" if a.width_limit is not None else "development_sample_q75"}
    log(f"규칙 4 기준 {width_limit * 100:.2f}%p ({R['width_limit']['source']})")

    # ---- 평가 집단 표본 (정답을 아는 정상 구간 시각, 환자마다 하나): 구간, 줄이는 검사, 확신, 보류 곡선
    if a.eval_rows == "one-per-patient":
        Es_idx = pick(E.assign(_row=np.arange(len(E))), True)._row.to_numpy()
    else:
        Es_idx = np.where(knownE)[0]
    if a.max_sample and len(Es_idx) > a.max_sample:
        Es_idx = np.sort(np.random.default_rng(SEED).choice(Es_idx, a.max_sample, replace=False))
    Es = E.iloc[Es_idx].reset_index(drop=True)
    XS = XE.iloc[Es_idx].reset_index(drop=True)
    PS = {k: v[Es_idx] for k, v in PE.items()}
    yS = yE[Es_idx]
    log(f"평가 집단 표본 {len(Es):,}시각: 구간과 줄이는 검사")
    ivS = shaker.run(XS.to_numpy(float), next_test=True)
    lo, hi = np.array([o[1] for o in ivS]), np.array([o[2] for o in ivS])
    wS = hi - lo
    nmiss = np.array([len(o[0]) for o in ivS])
    p5 = PS[5]
    gS = {k: v[Es_idx] for k, v in gE.items()}
    rS = rules(XS, PS, ref, gS, wS, width_limit)
    above, below = p5 > hi + 1e-12, p5 < lo - 1e-12
    by_miss = {}
    for g, m in (("0", nmiss == 0), ("1", nmiss == 1), ("2", nmiss == 2), ("3+", nmiss >= 3)):
        by_miss[g] = {"n": A.n(m.sum()), "width": q(wS[m]), "p_above": rate(above[m]), "p_below": rate(below[m])}
    best = [o[3][0] for o in ivS if o[3]]
    nxt = {"rows_with_missing": A.n(len(best)),
           "best_test_share": {c: rate(np.array([b[0] == c for b in best])) for c in CORE} if best else None,
           "width_now": q([w for w, o in zip(wS, ivS) if o[3]]),
           "width_after_best": q([b[2] - b[1] for b in best]),
           "relative_reduction": q([1 - (b[2] - b[1]) / w for b, w in zip(best, [w for w, o in zip(wS, ivS) if o[3]]) if w > 0])}
    R["interval_sample"] = {"n": A.n(len(Es)), "events": A.n(yS.sum()), "width": q(wS), "p_above": rate(above), "p_below": rate(below),
                            "by_missing_count": by_miss, "next_test": nxt}

    # 확신과 성능, 보류 곡선 (표본). 같은 환자의 여러 시각은 환자 단위로 묶어 신뢰구간
    gid = Es.subject_id.to_numpy() if a.eval_rows == "all-known" else np.arange(len(Es))
    lwS = logit_width(ivS)
    lw_lim = R.get("logit_width_limit")
    r4l = lwS >= lw_lim if lw_lim is not None else np.zeros(len(Es), bool)
    conf = {"rows": a.eval_rows, "rate": {k: rate(rS[k]) for k in ("r1", "r2", "r3", "r4", "r5")}, "low": rate(rS["low"]),
            "n_rules": {str(i): rate(rS["n_rules"] == i) for i in range(0, 6)},
            "all": group_metrics(np.ones(len(Es), bool), yS, p5, gid),
            "high": group_metrics(~rS["low"], yS, p5, gid), "low_group": group_metrics(rS["low"], yS, p5, gid),
            "high_r4": group_metrics(~rS["r4"], yS, p5, gid), "low_r4": group_metrics(rS["r4"], yS, p5, gid),
            "r4_logit": {"limit": lw_lim, "rate": rate(r4l), "high": group_metrics(~r4l, yS, p5, gid), "low": group_metrics(r4l, yS, p5, gid)}}
    # 같은 예측 확률대 안에서 확신 낮음이 실제와 더 어긋나는가 (위험 수준과 확신을 떼어 봄)
    bS = band_of(p5)
    conf["by_p5_band"] = {str(b): {lab: {"n": A.n((m := (bS == b) & sel).sum()), "events": A.n(yS[m].sum()),
                                         "mean_pred": float(p5[m].mean()) if m.any() else None, "observed": rate(yS[m] == 1) if m.any() else None}
                                   for lab, sel in (("high", ~rS["low"]), ("low", rS["low"]), ("r1", rS["r1"]), ("not_r1", ~rS["r1"]))}
                          for b in bS.categories}
    curves = {}
    no_r2 = rS["r1"].astype(int) + rS["r3"] + rS["r5"]
    for name, key in (("rules_then_width", rS["n_rules"] + np.clip(wS, 0, 0.999)), ("width", wS), ("logit_width", lwS),
                      ("rules_without_r2", no_r2 + rS["r4"] + np.clip(wS, 0, 0.999)),
                      ("rules_without_r2_logit", no_r2 + r4l + np.clip(lwS / (lwS.max() + 1e-9), 0, 0.999)),
                      ("rule1_only", rS["r1"].astype(float) + np.clip(lwS / (lwS.max() + 1e-9), 0, 0.999))):
        order = np.argsort(-key, kind="stable")
        pts = []
        for f in np.arange(0, 1.0, 0.1):
            keep = order[int(round(f * len(order))):]
            pts.append({"abstain": round(float(f), 1), "n": A.n(len(keep)), "events": A.n(yS[keep].sum()),
                        "auroc": D._auroc(yS[keep], p5[keep]), "auprc": D._ap(yS[keep], p5[keep]),
                        "event_rate": rate(yS[keep] == 1), "mean_pred": float(p5[keep].mean()),
                        "brier": float(np.mean((p5[keep] - yS[keep]) ** 2))})
        curves[name] = pts
    conf["abstain_curves"] = curves
    R["confidence_sample"] = conf

    # ---- 가림 시험: 잰 검사 하나를 '안 쟀다' 고 가리고 구간을 만들면, 실제 값으로 낸 확률이 구간 안에 드는가 (명목 80%)
    log("가림 시험")
    XSa = XS.to_numpy(float)
    ci = {c: i for i, c in enumerate(cols)}
    mask_res = {}
    for an in MASKABLE:
        rows = np.where(~np.isnan(XSa[:, ci[an + "_latest"]]))[0]
        if not len(rows):
            continue
        Xm = XSa[rows].copy()
        for s, v in (("_latest", np.nan), ("_age_h", np.nan), ("_n24", 0.0), ("_delta24", np.nan)):
            Xm[:, ci[an + s]] = v
        pm = prob(b5, Xm)
        pt = p5[rows]
        one = shaker.run(Xm, shake=False, only=an)  # 그 항목만 기준 행으로 (흔들기 없음)
        full = shaker.run(Xm)  # 화면과 같은 구간 (빠진 것 대체 + 잰 것 흔들기)
        res = {"n": A.n(len(rows))}
        for nm, iv in (("impute_only", one), ("screen_interval", full)):
            l_, h_ = np.array([o[1] for o in iv]), np.array([o[2] for o in iv])
            res[nm] = {"width": q(h_ - l_), "true_inside": rate((pt >= l_ - 1e-12) & (pt <= h_ + 1e-12)),
                       "true_above": rate(pt > h_ + 1e-12), "true_below": rate(pt < l_ - 1e-12),
                       "masked_inside": rate((pm >= l_ - 1e-12) & (pm <= h_ + 1e-12)), "masked_above": rate(pm > h_ + 1e-12)}
        res["masked_minus_true"] = q(pm - pt)
        mask_res[an] = res
    R["masking_test"] = mask_res

    # ---- 4-3 결과 대기: 대기 검사가 있던 시각에서 보고 뒤 확률 변화 (대조: 대기 없는 시각, 같은 지연 분포)
    log("결과 대기 뒤 변화")
    pendS = pendE[Es_idx]
    core = lab[lab.analyte.isin(CORE) & lab.stay_id.isin(set(Es.stay_id))][["stay_id", "charttime", "available_at"]]
    m = Es[["stay_id", "t"]].assign(_i=np.arange(len(Es))).merge(core, on="stay_id")
    m = m[(m.charttime <= m.t) & (m.available_at > m.t)]
    t2 = m.groupby("_i").available_at.max()
    has = np.zeros(len(Es), bool)
    has[t2.index.values] = True
    delay = ((t2 - Es.t.iloc[t2.index].values).dt.total_seconds() / 3600).to_numpy()
    T2 = Es.t.copy()
    T2.iloc[t2.index.values] = t2.values
    ctrl = np.where(~has)[0]
    if len(delay):
        T2.iloc[ctrl] = Es.t.iloc[ctrl].values + pd.to_timedelta(rng.choice(delay, len(ctrl)), unit="h")
    else:
        T2.iloc[ctrl] = Es.t.iloc[ctrl].values
    X2 = feat(pd.DataFrame({"stay_id": Es.stay_id.values, "t": T2.values}))
    dp = prob(b5, X2) - p5

    def change(mk):
        d = dp[mk]
        out = {"n": A.n(mk.sum()), "abs_change": q(np.abs(d)), "abs_ge_1pp": rate(np.abs(d) >= .01), "abs_ge_5pp": rate(np.abs(d) >= .05)}
        for th in ALARMS:
            out[f"alarm_flip_{int(th * 100)}"] = rate((p5[mk] >= th) != ((p5 + dp)[mk] >= th))
        return out
    R["pending"] = {"rate_all_hours": rate(pendE > 0), "rate_sample": rate(has), "delay_hours": q(delay),
                    "consistent_with_count": bool(np.array_equal(has, pendS > 0)),
                    "with_pending": change(has), "without_pending_matched_delay": change(~has)}

    R["meta"]["runtime_minutes"] = round((time.time() - t_start) / 60, 1)
    a.result.parent.mkdir(parents=True, exist_ok=True)
    a.result.write_text(json.dumps(R, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    log(f"완료 {R['meta']['runtime_minutes']}분 → {a.result}")


if __name__ == "__main__":
    main()
