"""불확실성 3단계 (불확실성 기획안 4-5): 예후와 궤적의 보장된 범위 (split conformal). 고정 모델을 다시 학습하지 않는다.

- 예후 (4경로, 회복 판정 가능 사건): '이 중 하나일 확률 90%' 인 경로 집합.
  APS: 확률 큰 순으로 더해 기준값에 이를 때까지 (화면의 경로 집합과 같은 모양, 화면의 임시 기준 0.9 를 이 기준값으로 바꿈).
  LAC: 확률이 (1 - 기준값) 이상인 경로. 둘 다 기준 반에서 정하고 확인 반에서 포함률과 집합 크기를 봄.
- 궤적 (ALT, AST, ALP, 총빌리 x 6, 12, 18, 24시간): 10~90% 띠가 실제로 80% 를 포함하도록 넓힐 폭 (CQR, log2 ULN 배수).
- 기준을 정하는 곳: 평가 집단 환자를 반으로 나눠 앞 반 (기준), 뒤 반 (확인). MIMIC 은 (가) 안, K-MIMIC 은 병원별로 같은 방식
  (또는 --fit-on development 로 개발 70% 에서 정하고 평가 30% 에서 확인).

  python uncertainty/stage3.py --package <모델 패키지> --out-dir <노트북 출력 폴더> --data-root <hosp/ 가 있는 폴더> \
      [--exclude-subjects ...] --site mimic-iv --result <결과 json>
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage1 import SEED, Agg, load, log, q, rate, read_hosp  # noqa: E402

ALPHA_PATH = 0.10  # 경로 집합: 90%
ALPHA_TRAJ = 0.20  # 궤적 띠: 80% (10~90%)
SCREEN_PATH_MASS = 0.9  # 화면의 임시 기준 (보장 없음)


def conformal_q(scores: np.ndarray, alpha: float) -> float:
    """split conformal 기준값: 기준 반 점수의 ceil((n+1)(1-alpha))/n 분위 (높은 쪽)"""
    s = np.sort(np.asarray(scores, float))
    n = len(s)
    k = math.ceil((n + 1) * (1 - alpha))
    return float(s[min(k, n) - 1]) if n else float("nan")


def halves(ids: pd.Series, fit_on: str, split: pd.Series) -> np.ndarray:
    """True = 기준 반 (fit), False = 확인 반"""
    if fit_on == "development":
        return split.eq("development").to_numpy()
    u = ids.drop_duplicates().sample(frac=1, random_state=SEED)
    return ids.isin(set(u.iloc[: len(u) // 2])).to_numpy()


def aps_sets(P: np.ndarray, mass: float) -> np.ndarray:
    """확률 큰 순으로 더해 mass 에 이를 때까지 (화면 pathSet 과 같음). 반환: 집합 표시 (행 x 경로)"""
    order = np.argsort(-P, axis=1, kind="stable")
    Ps = np.take_along_axis(P, order, 1)
    cum = np.cumsum(Ps, 1)
    before = cum - Ps  # 이 경로를 넣기 전까지의 합
    take_sorted = before < mass - 1e-9
    S = np.zeros_like(P, bool)
    np.put_along_axis(S, order, take_sorted, 1)
    return S


def aps_scores(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    """정답 경로까지 (포함) 확률 큰 순으로 더한 값"""
    order = np.argsort(-P, axis=1, kind="stable")
    Ps = np.take_along_axis(P, order, 1)
    cum = np.cumsum(Ps, 1)
    rank = np.argmax(order == y[:, None], axis=1)
    return cum[np.arange(len(y)), rank]


def set_summary(S: np.ndarray, y: np.ndarray, classes: list[str], A: Agg) -> dict:
    size = S.sum(1)
    cover = S[np.arange(len(y)), y]
    return {"n": A.n(len(y)), "coverage": rate(cover), "mean_size": float(size.mean()),
            "size_share": {str(k): rate(size == k) for k in range(1, len(classes) + 1)},
            "two_or_more": rate(size >= 2),
            "coverage_by_true_path": {c: rate(cover[y == i]) for i, c in enumerate(classes) if (y == i).any()},
            "n_by_true_path": {c: A.n((y == i).sum()) for i, c in enumerate(classes)}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, default=None)
    ap.add_argument("--exclude-subjects", type=Path, default=None)
    ap.add_argument("--site", default="mimic-iv")
    ap.add_argument("--result", type=Path, required=True)
    ap.add_argument("--min-cell", type=int, default=10)
    ap.add_argument("--fit-on", choices=["halves", "development"], default="halves")
    ap.add_argument("--traj-landmarks", type=int, default=150_000, help="궤적 시각 수 상한 (4시간 간격, 무작위)")
    ap.add_argument("--all-evaluation", action="store_true", help="모든 환자를 평가 집단으로 (순수 외부 검증)")
    ap.add_argument("--apply-from", type=Path, default=None,
                    help="다른 자료 (MIMIC) 의 stage3 결과 json. 그 기준값을 이 자료의 확인 반에 그대로 적용 (이식 시험, 기획안 4-5 가 안)")
    a = ap.parse_args(argv)
    if a.all_evaluation and a.fit_on == "development":
        raise SystemExit("--all-evaluation 에서는 --fit-on halves 만 됩니다")
    src = json.loads(a.apply_from.read_text(encoding="utf-8")) if a.apply_from else None
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
    A = Agg(a.min_cell)
    exclude = set(pd.read_csv(a.exclude_subjects).subject_id) if a.exclude_subjects else set()
    log("자료 읽기")
    cohort, lab, events, context, n_excl = load(a.out_dir, exclude, D.PRESSORS)
    adm = read_hosp(a.data_root, "admissions", ["subject_id", "hadm_id", "dischtime"])
    dx = read_hosp(a.data_root, "diagnoses_icd", ["subject_id", "hadm_id", "icd_code", "icd_version"])
    hist = D.history_flags(cohort, adm, dx)
    del adm, dx
    if a.all_evaluation:
        cohort["split"], events["split"] = "evaluation", "evaluation"
    outcomes = pd.read_csv(a.out_dir / "10_outcomes_EVALUATION_ONLY.csv", low_memory=False)
    feat = lambda rows: D.build_features(rows[["stay_id", "t"]], lab, context, cohort, hist)
    R = {"meta": {"site": a.site, "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": SEED,
                  "package": pkg.name, "sklearn": sklearn.__version__, "fit_on": a.fit_on, "min_cell_suppression": a.min_cell,
                  "excluded_subjects_in_cohort": n_excl, "alpha_path": ALPHA_PATH, "alpha_trajectory": ALPHA_TRAJ}}

    # ---- 예후 경로 집합
    log("예후: 첫 이상 시점 확률")
    b2 = joblib.load(pkg / "models" / "prognosis_gbm.joblib")
    classes = list(b2["classes"])
    ev = events.merge(outcomes[["case_id", "observed_path", "died_icu"]], on="case_id", how="inner")
    ev = ev[ev.split.eq("evaluation")] if a.fit_on == "halves" else ev
    ev2 = ev[ev.observed_path.isin(classes)].reset_index(drop=True)
    R["prognosis_counts"] = {"events": A.n(len(ev)), "assessable": A.n(len(ev2)),
                             "path_share": {k: rate(ev.observed_path.eq(k)) for k in sorted(ev.observed_path.unique())}}
    X2 = feat(ev2.rename(columns={"t0": "t"}))
    P = b2["model"].predict_proba(X2.reindex(columns=b2["features"]).astype(float))
    y = np.array([classes.index(c) for c in ev2.observed_path])
    fit = halves(ev2.subject_id, a.fit_on, ev2.split)
    te = ~fit
    lac_q = conformal_q(1 - P[fit, y[fit]] if fit.any() else np.array([]), ALPHA_PATH)
    aps_q = conformal_q(aps_scores(P[fit], y[fit]), ALPHA_PATH)
    pro = {"classes": classes, "fit_n": A.n(fit.sum()), "test_n": A.n(te.sum()),
           "aps": {"threshold_mass": aps_q, **set_summary(aps_sets(P[te], aps_q), y[te], classes, A)},
           "lac": {"threshold": lac_q, "min_prob": 1 - lac_q, **set_summary(P[te] >= 1 - lac_q - 1e-12, y[te], classes, A)},
           "screen_provisional": {"mass": SCREEN_PATH_MASS, **set_summary(aps_sets(P[te], SCREEN_PATH_MASS), y[te], classes, A)},
           "top1_accuracy": rate(P[te].argmax(1) == y[te])}
    # 확률의 보정 (경로별): 평균 예측 대 실제 비율
    if src:
        sp = src["prognosis"]
        pro["transported"] = {"from_site": src["meta"]["site"],
                              "aps": {"threshold_mass": sp["aps"]["threshold_mass"], **set_summary(aps_sets(P[te], sp["aps"]["threshold_mass"]), y[te], classes, A)},
                              "lac": {"threshold": sp["lac"]["threshold"], **set_summary(P[te] >= 1 - sp["lac"]["threshold"] - 1e-12, y[te], classes, A)}}
    pro["mean_pred_vs_observed"] = {c: {"pred": float(P[te, i].mean()), "obs": rate(y[te] == i)} for i, c in enumerate(classes)}
    R["prognosis"] = pro
    log(f"예후 APS 기준 {aps_q:.3f}, 확인 반 포함률 {pro['aps']['coverage']:.3f} (화면 임시 0.9: {pro['screen_provisional']['coverage']:.3f})")

    # ICU 사망 확률 (모든 사건, 판정 불가 포함): 보정만 확인
    if "death_model" in b2:
        Xd = feat(ev.rename(columns={"t0": "t"}))
        pdth = b2["death_model"].predict_proba(Xd.reindex(columns=b2["death_features"]).astype(float))[:, 1]
        yd = ev.died_icu.astype(str).str.lower().isin(["true", "1"]).to_numpy().astype(int)
        mt = D.binary_metrics(yd, pdth, ev.subject_id.to_numpy(), 0)
        R["icu_death"] = {k: (A.n(v) if k in ("n", "events", "patients") else v) for k, v in mt.items()
                          if k in ("n", "events", "patients", "prevalence", "auroc", "auprc", "brier", "cal_intercept", "cal_slope")}

    # ---- 궤적 띠 (CQR)
    log("궤적: 시각과 정답")
    tb = joblib.load(pkg / "models" / "trajectory_qgbm.joblib")
    coh = cohort[cohort.split.eq("evaluation")] if a.fit_on == "halves" else cohort
    Lt, targets = D.trajectory_rows(coh, lab, step_hours=4, max_landmarks=a.traj_landmarks)
    Xt = feat(Lt)
    fit_t = halves(Lt.subject_id, a.fit_on, Lt.split)
    rows, adj = [], {}
    for an, qs in tb["models"].items():
        has = Xt[f"{an}_latest"].notna().to_numpy()
        for h in D.TRAJ_HORIZONS:
            yv = targets[(an, h)]
            ok = has & np.isfinite(yv)
            if ok.sum() < 20:
                continue
            XA = Xt.loc[ok, tb["features"]].astype(float).assign(horizon_h=float(h))
            Pq = D._noncrossing({qq: qs[qq].predict(XA) for qq in D.TRAJ_QUANTILES})
            lo, hi, yy, f = Pq[0.1], Pq[0.9], yv[ok], fit_t[ok]
            s = np.maximum(lo - yy, yy - hi)
            qh = conformal_q(s[f], ALPHA_TRAJ)
            t_ = ~f
            raw = (yy[t_] >= lo[t_]) & (yy[t_] <= hi[t_])
            cqr = (yy[t_] >= lo[t_] - qh) & (yy[t_] <= hi[t_] + qh)
            adj[f"{an}_{h}"] = qh
            moved = {}
            if src and f"{an}_{h}" in src["trajectory"]["widen_log2"]:
                qs_ = src["trajectory"]["widen_log2"][f"{an}_{h}"]
                moved = {"widen_log2_transported": qs_, "coverage_transported": rate((yy[t_] >= lo[t_] - qs_) & (yy[t_] <= hi[t_] + qs_))}
            rows.append({**moved, "analyte": an, "horizon_h": h, "fit_n": A.n(f.sum()), "test_n": A.n(t_.sum()), "widen_log2": qh,
                         "widen_factor": float(2 ** qh), "coverage_raw": rate(raw), "coverage_cqr": rate(cqr),
                         "width_raw_log2": q(hi[t_] - lo[t_], (.5,)), "width_cqr_log2": q(hi[t_] - lo[t_] + 2 * qh, (.5,)),
                         "below_raw": rate(yy[t_] < lo[t_]), "above_raw": rate(yy[t_] > hi[t_])})
    R["trajectory"] = {"landmarks": A.n(len(Lt)), "step_hours": 4, "rows": rows, "widen_log2": adj}
    R["meta"]["runtime_minutes"] = round((time.time() - t_start) / 60, 1)
    a.result.parent.mkdir(parents=True, exist_ok=True)
    a.result.write_text(json.dumps(R, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    log(f"완료 {R['meta']['runtime_minutes']}분 → {a.result}")


if __name__ == "__main__":
    main()
