"""모델 브리지: MIMIC 연구원의 모델 패키지 (MIMIC-IV 학습, 고정) 를 가상 사례 하나에 그대로 적용해
화면이 시간순으로 재생할 출력을 만든다. 다시 학습하지 않는다.

패키지 함수를 그대로 부른다:
  변수 계산 build_features, 발생 예측 설명 explain_rows (그룹 Shapley, 합성 기준 행),
  궤적 forecast_rows, 원인 규칙 rule_agent1 (snapshot_payload), 간 패턴 군집 assign_clusters, 입력 오류 검사 guard_lab.
불확실성 (모델은 그대로, 출력 위에서 계산): 2, 3, 4배 모델 사다리, 빠진 핵심 입력을 기준 행 10개로 바꿔 넣고
잰 핵심 입력을 검사 오차 범위 안에서 흔든 예측 구간,
MIMIC 개발 집단 5~95% 범위 밖 입력, 원인 규칙의 입력값을 ±10% 바꿨을 때 0/1 이 바뀌는지.
사례 자료를 패키지의 중간 표 (cohort, lab, context, events) 모양으로 바꾸는 부분만 여기서 한다.
정의는 MODEL_CARD.md 를 따른다: 공개 시각 = max(채혈, 보고), 정상 = 세 항목 모두 24시간 안 측정이고 2배 미만.
다른 점 하나 (10/17 결정): 종료 상태와 원인 추정은 첫 이상 (2배) 이 아니라 5배 사건 시점에 돌린다. 예후 모델은 첫 이상 시점
자료로 학습했으므로 5배 시점 적용은 학습 범위 밖이다 (원인 규칙은 학습이 없어 시점과 무관).
출력에는 환자 식별 번호가 없다 (안에서 쓰는 stay_id 는 1).

  KCD_PYTHON=<python 3.11, scikit-learn 1.9.0 ...> npm run models
  (직접 실행: run_models.py --package <패키지> --cases-dir model-bridge/cases --out-dir src/data/model)
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

SID = 1
VITALS = ["MAP", "HR", "RR", "SPO2", "TEMP_C"]
# 확신 규칙 1 의 핵심 입력 (간 검사 4개, INR, 젖산, 크레아티닌). 빠지면 기준 행 값으로 바꿔 넣어 구간을 만든다
CORE = ["ALT", "AST", "ALP", "TBIL", "INR", "LACTATE", "CREAT"]
BLOCK = ("_latest", "_age_h", "_n24", "_delta24")
# 확신 규칙 2 의 주요 변수 (기준: 발생 예측 모델의 기준 행 = 개발 집단 정상 구간 시각의 변수별 백분위, 첫 행 5%, 끝 행 95%)
RANGE_FEATS = ["ALT_latest", "AST_latest", "ALP_latest", "TBIL_latest", "INR_latest", "ALBUMIN_latest", "LACTATE_latest",
               "CREAT_latest", "BUN_latest", "NTPROBNP_latest", "age", "PLATELET_latest", "WBC_latest", "SODIUM_latest",
               "GLUCOSE_latest", "BICARB_latest", "HEMOGLOBIN_latest", "MAP_latest", "HR_latest", "RR_latest", "SPO2_latest", "TEMP_C_latest"]
LADDER = (2, 3, 4)  # 5배는 발생 예측 모델 (agent3_gbm, agent3_gbm_5x 와 같은 모델)
ERR = 0.10  # 검사 오차 범위 (판정 취약, 구간의 잰 값 흔들기). 임상의 선생님 확인 전 기본값
NOISE = 10  # 잰 값 흔들기 줄 수
AGENT2_INPUTS = ["ALT_latest", "AST_latest", "ALP_latest", "TBIL_latest", "ALT_delta24", "LACTATE_latest", "MAP_latest",
                 "pressor_6h", "CREAT_latest", "INR_latest", "PLATELET_latest", "WBC_latest", "age", "hours_since_icu"]


def r4(x):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 4)


def hourly(a: pd.Timestamp, b: pd.Timestamp):
    ceil = lambda t: t if (t.minute == 0 and t.second == 0) else t.floor("h") + pd.Timedelta(hours=1)
    return list(pd.date_range(ceil(a), ceil(b), freq="h"))


def fmt(t) -> str:
    return pd.Timestamp(t).strftime("%Y-%m-%d %H:%M")


def interval(predict, X: pd.DataFrame, bg: pd.DataFrame):
    """핵심 입력 구간 (불확실성 기획안 4-2). 빠진 핵심 입력 (24시간 안 측정 없음) 은 변수 묶음 (값, 측정 뒤 시간, 횟수,
    24시간 변화) 을 기준 행 10개 (개발 집단 백분위) 로 바꿔 넣고, 빠진 항목이 여럿이면 같은 기준 행을 함께 넣는다.
    잰 핵심 입력은 검사 오차 범위 (±ERR) 안에서 흔든다 (최근 값과 24시간 변화를 같은 양만큼). 흔드는 배율은 ±ERR 를 10칸으로
    나눈 격자를 항목마다 따로 섞어 10줄로 짝지음. 구간 = 기준 행 x 흔들기 줄을 모두 짝지은 예측의 10~90%.
    빠진 항목마다 '그 항목을 재면' 남는 구간도 계산: 그 항목 값을 기준 행 10개에 걸쳐 두고, 나머지만 바꿔 넣고 흔든 구간의 평균."""
    cols, n, out = list(X.columns), len(bg), []
    rng = np.random.default_rng(20261016)
    grid = np.linspace(1 - ERR, 1 + ERR, NOISE)
    shake = {a: rng.permutation(grid) for a in CORE}
    for _, x in X.iterrows():
        miss = [a for a in CORE if pd.isna(x[f"{a}_latest"])]
        meas = [a for a in CORE if a not in miss]

        def fill(ix_bg, ix_shake, fixed=None):  # fixed: (빠진 항목, 그 항목의 기준 행 번호 배열)
            R = pd.DataFrame(np.repeat(x.values[None, :], len(ix_shake), axis=0), columns=cols)
            for a in miss:
                ix = fixed[1] if fixed and fixed[0] == a else ix_bg
                for s in BLOCK:
                    R[a + s] = bg[a + s].values[ix]
            for a in meas:
                d = x[f"{a}_latest"] * (shake[a][ix_shake] - 1)
                R[f"{a}_latest"] = x[f"{a}_latest"] + d
                if pd.notna(x[f"{a}_delta24"]):
                    R[f"{a}_delta24"] = x[f"{a}_delta24"] + d
            return predict(R)

        nb = n if miss else 1
        i, m = np.repeat(np.arange(nb), NOISE), np.tile(np.arange(NOISE), nb)
        lo, hi = np.quantile(fill(i, m), [.1, .9])
        nxt = []
        for a in miss:
            nr = n if len(miss) > 1 else 1  # 남은 빠진 항목의 기준 행
            j = np.repeat(np.arange(n), nr * NOISE)
            i, m = np.tile(np.repeat(np.arange(nr), NOISE), n), np.tile(np.arange(NOISE), n * nr)
            P = fill(i, m, (a, j)).reshape(n, nr * NOISE)  # 행: 그 항목 값, 열: 남은 항목과 흔들기
            q = np.quantile(P, [.1, .9], axis=1)
            nxt.append({"analyte": a, "lo": r4(q[0].mean()), "hi": r4(q[1].mean())})
        nxt.sort(key=lambda d: d["hi"] - d["lo"])
        out.append((miss, [r4(lo), r4(hi)], nxt))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--cases-dir", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    a = ap.parse_args(argv)
    warnings.filterwarnings("ignore")
    pkg = a.package.resolve()
    sys.path.insert(0, str(pkg))
    import joblib
    import sklearn

    card = (pkg / "MODEL_CARD.md").read_text(encoding="utf-8")
    need = re.search(r"scikit-learn ([0-9.]+)", card).group(1)
    if sklearn.__version__ != need:
        raise SystemExit(f"scikit-learn {need} 이 필요합니다 (지금 {sklearn.__version__}). MODEL_CARD.md 의 버전으로 실행하세요.")
    cache = {}
    M = lambda n: cache.setdefault(n, joblib.load(pkg / "models" / n))
    for path in sorted(a.cases_dir.glob("*.json")):
        run_case(json.loads(path.read_text(encoding="utf-8")), pkg, card, M, a.out_dir / path.name)


def run_case(C: dict, pkg: Path, card: str, M, out_path: Path):
    import sklearn
    from kcd_liver import develop as D
    from kcd_liver.pattern import _apply_params, assign_clusters, r_pattern
    from kcd_liver.data_errors import AGE_RANGE, VITAL_RANGE, guard_lab
    from kcd_liver.rule_agent import CAUSE_FLAGS, VERSION as RULE_VERSION, rule_agent1

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
    # 간염 혈청 검사 (원인 규칙 9 가 입원 전체에서 읽음)
    ctx += [{"stay_id": SID, "kind": "serology_record", "label": s["label"], "value": s["value"], "unit": "", "charttime": T(s["time"]),
             "available_at": T(s.get("available_at") or s["time"])} for s in C.get("serology") or []]
    context = pd.DataFrame(ctx)
    # 과거력: 이번 ICU 입실 전에 퇴원한 이전 입원의 진단 코드 (없으면 결측, 0 이 아님)
    prev = C.get("history") or []
    adm = pd.DataFrame([{"subject_id": SID, "hadm_id": 100 + i, "dischtime": T(h["discharged"])} for i, h in enumerate(prev)]) if prev else None
    dx = pd.DataFrame([{"subject_id": SID, "hadm_id": 100 + i, "icd_code": c["code"], "icd_version": c["version"]}
                       for i, h in enumerate(prev) for c in h["codes"]]) if prev else None
    hist = D.history_flags(cohort, adm, dx)
    hist_row = {k: v for k, v in hist.drop(columns="stay_id").iloc[0].items()}

    # ---- 제외 기준, 첫 이상 (2배, 발생 예측이 멈추는 시점), 5배 사건 (종료 상태와 원인 추정이 도는 시점)
    pre = lab[lab.analyte.isin(D.TRIGGERS) & (lab.charttime < intime) & (lab.ratio >= 2)]
    if len(pre):
        raise SystemExit("ICU 입실 전 같은 입원에서 이미 2배 이상: 분석 대상이 아닙니다")
    inside = lab[lab.analyte.isin(D.TRIGGERS) & (lab.available_at >= intime) & (lab.available_at <= outtime)]
    hits = inside[inside.ratio >= 2].sort_values(["available_at", "charttime"])
    t0 = hits.available_at.iloc[0] if len(hits) else None
    ceil_h = lambda t: t if t.minute == 0 else t.floor("h") + pd.Timedelta(hours=1)
    detect = None if t0 is None else ceil_h(t0)
    hits5 = inside[inside.ratio >= 5].sort_values(["available_at", "charttime"])
    t5 = hits5.available_at.iloc[0] if len(hits5) else None

    ticks = hourly(intime, outtime)
    out = {"meta": {}, "first_event": None, "target_event": None, "a1": [], "a2": None, "a3": None, "cluster": None, "a4": []}

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
    bg = b1["background"].reset_index(drop=True)
    ref = {f: (float(bg[f].min()), float(bg[f].max())) for f in RANGE_FEATS}  # 기준 행 첫 행 5%, 끝 행 95%
    # 입력 오류 검사 (패키지 data_errors): 보류된 검사값, 생리적으로 불가능한 활력징후와 나이
    _, held = guard_lab(lab)
    vit = context[context.kind.eq("vital")].assign(v=lambda d: pd.to_numeric(d.value, errors="coerce"))

    def guard_at(t):
        g = [{"var": q.analyte, "value": r4(q.value), "at": fmt(q.charttime), "reason": q.reason}
             for q in held[(held.available_at <= t) & (held.charttime >= t - pd.Timedelta(hours=24))].itertuples()]
        w = vit[(vit.available_at <= t) & (vit.charttime >= t - pd.Timedelta(hours=6))]
        g += [{"var": q.label, "value": r4(q.v), "at": fmt(q.charttime), "reason": "range"} for q in w.itertuples()
              if q.label in VITAL_RANGE and not VITAL_RANGE[q.label][0] <= q.v <= VITAL_RANGE[q.label][1]]
        if not AGE_RANGE[0] <= float(C["age"]) <= AGE_RANGE[1]:
            g.append({"var": "age", "value": float(C["age"]), "at": None, "reason": "range"})
        return g

    pred = {}
    if len(ok):
        X1 = D.build_features(ok, lab, context, cohort, hist).reindex(columns=b1["features"]).astype(float)
        p1 = b1["model"].predict_proba(X1)[:, 1]
        ex = D.explain_rows(b1, X1)
        # 심각도 사다리: 같은 입력으로 2, 3, 4배 모델 (5배는 위 확률)
        lad = {}
        for k in LADDER:
            m = M(f"agent3_gbm_{k}x.joblib")
            lad[k] = m["model"].predict_proba(X1.reindex(columns=m["features"]).astype(float))[:, 1]
        imp = interval(lambda A: b1["model"].predict_proba(A[b1["features"]].astype(float))[:, 1], X1, bg)
        for j, t in enumerate(ok.t):
            miss, iv, nxt = imp[j]
            x = X1.iloc[j]
            pred[fmt(t)] = {
                "p": r4(p1[j]), "base": r4(ex[j]["base"]),
                "groups": [{"group": g["group"], "label": g["label"], "value": r4(g["value"])} for g in ex[j]["groups"]],
                "ladder": {**{str(k): r4(lad[k][j]) for k in LADDER}, "5": r4(p1[j])},
                "missing_core": miss, "interval": iv, "next_test": nxt,
                "out_of_range": [{"var": f.removesuffix("_latest"), "value": r4(x[f])} for f in RANGE_FEATS
                                 if pd.notna(x[f]) and not ref[f][0] <= x[f] <= ref[f][1]],
                "guard": guard_at(t),
            }
    for i, t in enumerate(rows.t):
        if not any_lab[i]:
            continue  # 첫 간 검사 결과 전에는 돌지 않음
        key = fmt(t)
        out["a1"].append({"time": key, "eligible": True, **pred[key]} if key in pred else {"time": key, "eligible": False})

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

    if t5 is not None:
        trig = hits5.iloc[0]
        out["target_event"] = {"t0": fmt(t5), "drawn": fmt(trig.charttime), "analyte": trig.analyte, "ratio": r4(trig.ratio), "detect": fmt(ceil_h(t5))}
        X0 = D.build_features(pd.DataFrame({"stay_id": [SID], "t": [t5]}), lab, context, cohort, hist)

        # ---- 2 종료 상태: 4경로 확률 + ICU 사망 (별도 모델)
        b2 = M("prognosis_gbm.joblib")
        P = b2["model"].predict_proba(X0.reindex(columns=b2["features"]).astype(float))[0]
        pd_ = b2["death_model"].predict_proba(X0.reindex(columns=b2["death_features"]).astype(float))[0, 1]
        out["a2"] = {"t0": fmt(t5), "classes": list(b2["classes"]), "probs": {c: r4(v) for c, v in zip(b2["classes"], P)},
                     "icu_death": r4(pd_), "inputs": {k: r4(X0[k].iloc[0]) for k in AGENT2_INPUTS if k in X0}}

        # ---- 3 원인: 규칙 (학습 없음), 48시간 스냅숏
        payload = D.snapshot_payload(SID, t5, {SID: lab}, {SID: context}, hist_row)
        r = rule_agent1(payload)
        out["a3"] = {"t0": fmt(t5), "model": RULE_VERSION, "pattern": r["pattern"], "abstain": r["abstain"], "history": {k: (None if pd.isna(v) else bool(v)) for k, v in hist_row.items()},
                     "uncertainty": r["uncertainty"], "flags": {c: r["flags"][c] for c in CAUSE_FLAGS},
                     "snapshot": {"labs": len(payload["labs"]), "context": len(payload["context"])}}
        # 규칙이 읽은 입력 (근거 완성도 계산용): 스냅숏 속 검사, 활력징후 종류, 기록 종류, 혈색소 감소, 혈청 검사 수
        ex0 = payload.get("exposures") or {}
        out["a3"]["inputs"] = {
            "labs": {l["analyte"]: {"value": r4(l["value"]), "ratio": r4(l["ratio"]), "at": fmt(l["measured_at"])} for l in payload["labs"]},
            "vitals": sorted({c["label"] for c in payload["context"] if c["kind"] == "vital"}),
            "records": sorted({c["kind"] for c in payload["context"] if c["kind"] != "vital"}),
            "hb_drop": r4(payload.get("hemoglobin_drop_48h")), "serology": len(ex0.get("serology", [])), "pn_days": ex0.get("pn_days"),
        }

        # 판정 취약: 규칙이 읽은 검사값 (와 48시간 혈색소 감소) 을 하나씩 검사 오차 범위 (±10%) 만큼 바꿔 다시 돌렸을 때 0/1 이 바뀌는 범주
        fragile = {}

        def recheck(P, name, f, v):
            rr_ = rule_agent1(P)
            for c in CAUSE_FLAGS:
                if rr_["flags"][c]["present"] != r["flags"][c]["present"]:
                    fragile.setdefault(c, []).append({"input": name, "change": f"{f - 1:+.0%}", "value": r4(v), "to": rr_["flags"][c]["present"],
                                                      "score": rr_["flags"][c]["score"]})

        for i, l in enumerate(payload["labs"]):
            for f in (1 - ERR, 1 + ERR):
                P = copy.deepcopy(payload)
                P["labs"][i]["value"] = l["value"] * f
                if l["ratio"] is not None:
                    P["labs"][i]["ratio"] = l["ratio"] * f
                recheck(P, l["analyte"], f, l["value"])
        if payload.get("hemoglobin_drop_48h") is not None:
            for f in (1 - ERR, 1 + ERR):
                recheck({**payload, "hemoglobin_drop_48h": payload["hemoglobin_drop_48h"] * f}, "HEMOGLOBIN_DROP", f, payload["hemoglobin_drop_48h"])
        out["a3"]["fragile"] = fragile
        out["a3"]["error_range"] = ERR

        # ---- 보조: 간 패턴 군집 (원인 판정에 쓰지 않음). 임상 표현형 군집은 개발 때 불안정 → 쓰지 않음
        cm = M("cluster_models.joblib")
        last = lambda an: lab[lab.analyte.eq(an) & (lab.available_at <= t5) & (lab.charttime >= t5 - pd.Timedelta(hours=24))].sort_values("charttime").tail(1)
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
                   "case": C["caseId"], "note": "가상 사례에 고정 모델을 적용한 출력. 환자 식별 번호 없음.",
                   "error_range": ERR,
                   # 확신 규칙 2 의 기준 (발생 예측 모델 기준 행의 5%, 95%. 개발 집단 정상 구간 시각의 변수별 백분위)
                   "reference": {f.removesuffix("_latest"): [r4(lo), r4(hi)] for f, (lo, hi) in ref.items()},
                   # 연결부가 모델에 넘기는 자료 (넘기지 않는 것은 화면에서 '연결 안 됨')
                   "connected": {"labs": C.get("connected") or [], "history": True, "serology": True,
                                 "infusion": True, "emar": True, "imaging_report": False}}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n1 = sum(1 for x in out["a1"] if x["eligible"])
    print(f"{out_path}: 발생 예측 {len(out['a1'])}시각 (정상 {n1}), 궤적 {len(out['a4'])}시각, 첫 이상 {out['first_event'] and out['first_event']['t0']}, "
          f"5배 사건 {out['target_event'] and out['target_event']['t0']}")


if __name__ == "__main__":
    main()
