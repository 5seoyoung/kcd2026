"""모델 브리지: MIMIC 연구원의 모델 패키지 (MIMIC-IV 학습, 고정) 를 가상 사례 하나에 그대로 적용해
화면이 시간순으로 재생할 출력을 만든다. 다시 학습하지 않는다.

패키지 함수를 그대로 부른다:
  변수 계산 build_features, 발생 예측 설명 explain_rows (그룹 Shapley, 합성 기준 행),
  궤적 forecast_rows, 원인 규칙 rule_agent1 (snapshot_payload), 간 패턴 군집 assign_clusters.
사례 자료를 패키지의 중간 표 (cohort, lab, context, events) 모양으로 바꾸는 부분만 여기서 한다.
정의는 MODEL_CARD.md 를 따른다: 공개 시각 = max(채혈, 보고), 정상 = 세 항목 모두 24시간 안 측정이고 2배 미만.
출력에는 환자 식별 번호가 없다 (안에서 쓰는 stay_id 는 1).

  KCD_PYTHON=<python 3.11, scikit-learn 1.9.0 ...> npm run models
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

SID = 1
VITALS = ["MAP", "HR", "RR", "SPO2", "TEMP_C"]
AGENT2_INPUTS = ["ALT_latest", "AST_latest", "ALP_latest", "TBIL_latest", "ALT_delta24", "LACTATE_latest", "MAP_latest",
                 "pressor_6h", "CREAT_latest", "INR_latest", "PLATELET_latest", "WBC_latest", "age", "hours_since_icu"]


def r4(x):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 4)


def hourly(a: pd.Timestamp, b: pd.Timestamp):
    ceil = lambda t: t if (t.minute == 0 and t.second == 0) else t.floor("h") + pd.Timedelta(hours=1)
    return list(pd.date_range(ceil(a), ceil(b), freq="h"))


def fmt(t) -> str:
    return pd.Timestamp(t).strftime("%Y-%m-%d %H:%M")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--case", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    warnings.filterwarnings("ignore")
    pkg = a.package.resolve()
    sys.path.insert(0, str(pkg))
    import joblib
    import sklearn
    from kcd_liver import develop as D
    from kcd_liver.pattern import _apply_params, assign_clusters, r_pattern
    from kcd_liver.rule_agent import CAUSE_FLAGS, VERSION as RULE_VERSION, rule_agent1

    card = (pkg / "MODEL_CARD.md").read_text(encoding="utf-8")
    need = re.search(r"scikit-learn ([0-9.]+)", card).group(1)
    if sklearn.__version__ != need:
        raise SystemExit(f"scikit-learn {need} 이 필요합니다 (지금 {sklearn.__version__}). MODEL_CARD.md 의 버전으로 실행하세요.")
    M = lambda n: joblib.load(pkg / "models" / n)

    C = json.loads(a.case.read_text(encoding="utf-8"))
    T = pd.Timestamp
    intime, outtime = T(C["icuIn"]), T(C["icuOut"])

    # ---- 패키지 중간 표 모양으로
    cohort = pd.DataFrame([{"stay_id": SID, "subject_id": SID, "hadm_id": SID, "split": "evaluation", "intime": intime,
                            "outtime": outtime, "admittime": T(C["admitTime"]) if C.get("admitTime") else pd.NaT,
                            "monitor_end": outtime, "obs_end": outtime, "age": float(C["age"]), "gender": C["sex"]}])
    lab = pd.DataFrame([{"stay_id": SID, "analyte": r["analyte"], "value": float(r["value"]),
                         "ratio": r["value"] / r["uln"] if r.get("uln") else np.nan,
                         "charttime": T(r["charttime"]), "available_at": T(r["available_at"]), "id": r["id"]} for r in C["labs"]])
    ctx = [{"stay_id": SID, "kind": "vital", "label": k, "value": v[k], "unit": "", "charttime": T(v["time"]), "available_at": T(v["time"])}
           for v in C["vitals"] for k in VITALS if v.get(k) is not None]
    ctx += [{"stay_id": SID, "kind": m["kind"], "label": m["drug"], "value": m["value"], "unit": "", "charttime": T(m["time"]),
             "available_at": T(m["time"])} for m in C["meds"]]
    context = pd.DataFrame(ctx)
    hist = D.history_flags(cohort, None, None)  # 이전 입원 없음 → 과거력은 결측 (0 이 아님)

    # ---- 제외 기준과 첫 이상 (2배)
    pre = lab[lab.analyte.isin(D.TRIGGERS) & (lab.charttime < intime) & (lab.ratio >= 2)]
    if len(pre):
        raise SystemExit("ICU 입실 전 같은 입원에서 이미 2배 이상: 분석 대상이 아닙니다")
    inside = lab[lab.analyte.isin(D.TRIGGERS) & (lab.available_at >= intime) & (lab.available_at <= outtime)]
    hits = inside[inside.ratio >= 2].sort_values(["available_at", "charttime"])
    t0 = hits.available_at.iloc[0] if len(hits) else None
    detect = None if t0 is None else (t0 if t0.minute == 0 else t0.floor("h") + pd.Timedelta(hours=1))
    events = pd.DataFrame([{"case_id": C["caseId"], "stay_id": SID, "subject_id": SID, "hadm_id": SID, "t0": t0, "split": "evaluation"}]) if t0 is not None else pd.DataFrame()

    ticks = hourly(intime, outtime)
    out = {"meta": {}, "first_event": None, "a1": [], "a2": None, "a3": None, "cluster": None, "a4": []}

    # ---- 1 발생 예측 (패키지 Agent 3): 첫 이상을 알기 전 매시간, 정상 구간에서만
    b1 = M("agent3_gbm.joblib")
    rows = pd.DataFrame({"stay_id": SID, "t": [t for t in ticks if detect is None or t < detect]})
    E = rows.copy()
    E["_i"] = np.arange(len(E))
    for an in D.TRIGGERS:  # agent3_landmarks 와 같은 판정: 세 항목 모두 24시간 안 측정 (보고된 것) 이고 2배 미만
        E = D._asof(E, lab[lab.analyte.eq(an)], "available_at", ["ratio", "charttime"], f"{an}_")
        E[f"{an}_fresh"] = ((E.t - E[f"{an}_charttime"]).dt.total_seconds() / 3600 <= 24) & E[f"{an}_ratio"].notna()
    E = E.sort_values("_i").reset_index(drop=True)
    fresh = np.logical_and.reduce([E[f"{an}_fresh"].values for an in D.TRIGGERS])
    below = np.logical_and.reduce([(E[f"{an}_ratio"] < 2).fillna(False).values for an in D.TRIGGERS])
    elig = fresh & below
    any_lab = np.logical_or.reduce([E[f"{an}_charttime"].notna().values for an in D.TRIGGERS])
    ok = rows[elig].reset_index(drop=True)
    pred = {}
    if len(ok):
        X1 = D.build_features(ok, lab, context, cohort, hist).reindex(columns=b1["features"]).astype(float)
        p1 = b1["model"].predict_proba(X1)[:, 1]
        ex = D.explain_rows(b1, X1)
        pred = {fmt(t): (p, e) for t, p, e in zip(ok.t, p1, ex)}
    for i, t in enumerate(rows.t):
        if not any_lab[i]:
            continue  # 첫 간 검사 결과 전에는 돌지 않음
        key = fmt(t)
        if key in pred:
            p, e = pred[key]
            out["a1"].append({"time": key, "eligible": True, "p": r4(p), "base": r4(e["base"]),
                              "groups": [{"group": g["group"], "label": g["label"], "value": r4(g["value"])} for g in e["groups"]]})
        else:
            out["a1"].append({"time": key, "eligible": False})

    # ---- 4 궤적: 매시간, 상태와 무관 (그 시각 24시간 안에 잰 값이 있는 항목만)
    b4 = M("trajectory_qgbm.joblib")
    rows4 = pd.DataFrame({"stay_id": SID, "t": ticks})
    X4 = D.build_features(rows4, lab, context, cohort, hist)
    F4 = D.forecast_rows(b4, X4.reindex(columns=b4["features"]).assign(**{f"{x}_latest": X4[f"{x}_latest"] for x in D.TRAJ_ANALYTES}))
    for t, f in zip(rows4.t, F4):
        if f:
            out["a4"].append({"time": fmt(t), "forecasts": {an: [{k: (r4(v) if k != "h" else v) for k, v in q.items()} for q in qs] for an, qs in f.items()}})

    if t0 is not None:
        trig = hits.iloc[0]
        out["first_event"] = {"t0": fmt(t0), "drawn": fmt(trig.charttime), "analyte": trig.analyte, "ratio": r4(trig.ratio), "detect": fmt(detect)}
        X0 = D.build_features(events.rename(columns={"t0": "t"})[["stay_id", "t"]], lab, context, cohort, hist)

        # ---- 2 종료 상태: 4경로 확률 + ICU 사망 (별도 모델)
        b2 = M("prognosis_gbm.joblib")
        P = b2["model"].predict_proba(X0.reindex(columns=b2["features"]).astype(float))[0]
        pd_ = b2["death_model"].predict_proba(X0.reindex(columns=b2["death_features"]).astype(float))[0, 1]
        out["a2"] = {"t0": fmt(t0), "classes": list(b2["classes"]), "probs": {c: r4(v) for c, v in zip(b2["classes"], P)},
                     "icu_death": r4(pd_), "inputs": {k: r4(X0[k].iloc[0]) for k in AGENT2_INPUTS if k in X0}}

        # ---- 3 원인: 규칙 (학습 없음), 48시간 스냅숏
        payload = D.snapshot_payload(SID, t0, {SID: lab}, {SID: context}, {})
        r = rule_agent1(payload)
        out["a3"] = {"t0": fmt(t0), "model": RULE_VERSION, "pattern": r["pattern"], "abstain": r["abstain"],
                     "uncertainty": r["uncertainty"], "flags": {c: r["flags"][c] for c in CAUSE_FLAGS},
                     "snapshot": {"labs": len(payload["labs"]), "context": len(payload["context"])}}

        # ---- 보조: 간 패턴 군집 (원인 판정에 쓰지 않음). 임상 표현형 군집은 개발 때 불안정 → 쓰지 않음
        cm = M("cluster_models.joblib")
        last = lambda an: lab[lab.analyte.eq(an) & (lab.available_at <= t0) & (lab.charttime >= t0 - pd.Timedelta(hours=24))].sort_values("charttime").tail(1)
        la, lp = last("ALT"), last("ALP")
        rr = (la.ratio.iloc[0] / lp.ratio.iloc[0]) if len(la) and len(lp) and abs((la.charttime.iloc[0] - lp.charttime.iloc[0]).total_seconds()) <= 6 * 3600 else np.nan
        F = pd.DataFrame([{"ALT_ratio": X0["ALT_latest"].iloc[0], "ALP_ratio": X0["ALP_latest"].iloc[0],
                           "TBIL_ratio": X0["TBIL_latest"].iloc[0], "R_ratio": rr}])
        cl = {}
        for k in ("liver_pattern_gmm", "clinical_phenotype_gmm"):
            m = cm[k]
            if not m["stable"]:
                cl[k] = {"used": False, "reason": "개발 집단에서 불안정 (부트스트랩 ARI 중앙값 0.75 미만)"}
                continue
            Z = _apply_params(F, m["prep"])
            post = m["gmm"].predict_proba(Z)[0]
            c = int(assign_clusters(m, F)[0])
            prep = m["prep"]
            centers = []
            for j in range(m["k"]):
                row = {}
                for ci, col in enumerate(prep["cols"]):
                    v = m["gmm"].means_[j, ci] * prep["sd"][col] + prep["mean"][col]
                    row[col] = r4(2 ** v if col in prep["log_cols"] else v)
                centers.append({"cluster": j + 1, "share": r4(m["gmm"].weights_[j]), "center": row})
            cl[k] = {"used": True, "k": m["k"], "cluster": c + 1, "prob": r4(post[c]), "input": {kk: r4(vv) for kk, vv in F.iloc[0].items()},
                     "pattern": r_pattern(F.ALT_ratio.iloc[0], F.ALP_ratio.iloc[0], F.TBIL_ratio.iloc[0], rr), "centers": centers}
        out["cluster"] = cl

    code = re.search(r"코드 버전 (\w+)", card)
    auroc = re.search(r"Agent 3 AUROC ([0-9.]+), AUPRC ([0-9.]+)", card)
    out["meta"] = {"package": pkg.name, "code_version": code.group(1) if code else None, "trained_on": b1.get("trained_on"),
                   "built_at": b1.get("built_at"), "sklearn": sklearn.__version__, "python": sys.version.split()[0],
                   "rule_model": RULE_VERSION, "agent1_internal": {"auroc": r4(float(auroc.group(1))), "auprc": r4(float(auroc.group(2)))} if auroc else None,
                   "case": C["caseId"], "note": "가상 사례에 고정 모델을 적용한 출력. 환자 식별 번호 없음."}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n1 = sum(1 for x in out["a1"] if x["eligible"])
    print(f"{a.out}: 발생 예측 {len(out['a1'])}시각 (정상 {n1}), 궤적 {len(out['a4'])}시각, 첫 이상 {out['first_event'] and out['first_event']['t0']}")


if __name__ == "__main__":
    main()
