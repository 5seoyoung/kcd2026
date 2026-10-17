"""불확실성 4단계 (불확실성 기획안 4-6): 원인 판정의 단단함. 규칙 모델 (rule_agent1, 학습 없음) 을 첫 이상 시점에 돌린다.

- 근거 완성도: 원인마다 필요한 근거 중 그 시점 자료에 있는 비율 (화면 web/src/lib/uncertainty.ts 의 NEED 표와 같음).
  연결된 기록 (승압제 주입, 투약, 정맥영양) 은 연결되어 있으면 '있음', 영상 판독은 자료에 없음, 과거력은 이전 입원이 있어야 '있음'.
- 판정 취약: 규칙이 읽은 검사값 (와 48시간 혈색소 감소) 을 하나씩 검사 오차 범위 (±10%) 만큼 바꿔 다시 돌렸을 때 0/1 이 바뀌는 원인
  (화면 web/model-bridge/run_models.py 와 같음).

  python uncertainty/stage4.py --package <모델 패키지> --out-dir <노트북 출력 폴더> --data-root <hosp/ 가 있는 폴더> \
      [--exclude-subjects ...] --site mimic-iv --result <결과 json> [--all-evaluation]
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage1 import SEED, Agg, log, rate, read_hosp, shared  # noqa: E402

ERR = 0.10

_lab = lambda *a: (lambda P: any(x in P["labs"] for x in a))
_vital = lambda v: (lambda P: v in P["vitals"])
_either = lambda f, g: (lambda P: f(P) or g(P))
_connected = lambda P: True  # 연결부가 넘기는 기록은 '있음' (화면과 같음)
_hist = lambda P: P["hist_known"]
NEED = {
    "hypoxic_hepatitis": [("AST 또는 ALT", _lab("AST", "ALT")), ("MAP", _vital("MAP")), ("젖산", _lab("LACTATE")), ("승압제 기록", _connected)],
    "congestive_hepatopathy": [("간 검사 배수", _lab("ALT", "ALP", "TBIL")), ("심부전 과거력", _hist), ("NT-proBNP", _lab("NTPROBNP"))],
    "sepsis_cholestasis": [("총빌리 또는 ALP", _lab("TBIL", "ALP")),
                           ("R 비", lambda P: "ALT" in P["labs"] and bool(P["labs"].get("ALP"))),
                           ("백혈구 또는 체온", _either(_lab("WBC"), _vital("TEMP_C"))), ("혈소판", _lab("PLATELET")), ("승압제 기록", _connected)],
    "dili": [("48시간 투약 기록", _connected)],
    "pn_associated": [("정맥영양 기록", _connected)],
    "biliary_obstruction_cholangitis": [("총빌리", _lab("TBIL")), ("ALP", _lab("ALP")), ("GGT", _lab("GGT")), ("AST", _lab("AST")),
                                        ("ALT", _lab("ALT")), ("염증 지표", _either(_lab("WBC"), _vital("TEMP_C")))],
    "cholecystitis": [("영상 판독", lambda P: False)],
    "hemolysis": [("직접빌리", _lab("DBIL")), ("합토글로빈", _lab("HAPTO")), ("LDH", _lab("LDH")), ("혈색소 변화", lambda P: P["hb_drop"] is not None)],
    "viral_hepatitis": [("간염 혈청 검사", lambda P: P["serology"] > 0), ("과거력", _hist)],
    "others": [("CK", _lab("CK")), ("과거력", _hist)],
}


def load_events(out_dir: Path, exclude: set, split: str | None):
    rd = lambda n, **k: pd.read_csv(out_dir / n, low_memory=False, **k)
    cohort = rd("01_cohort_private.csv")
    for c in ["intime", "outtime", "admittime", "dischtime"]:
        if c in cohort:
            cohort[c] = pd.to_datetime(cohort[c], errors="coerce").astype("datetime64[ns]")
    cohort = cohort[~cohort.subject_id.isin(exclude)]
    events = rd("05_events_private.csv")
    events["t0"] = pd.to_datetime(events.t0).astype("datetime64[ns]")
    events = events[events.stay_id.isin(set(cohort.stay_id))]
    if split:
        events = events[events.split.eq(split)]
    stays = set(events.stay_id)
    lab = rd("03_labs_private.csv", usecols=lambda c: c in {"stay_id", "analyte", "value", "ratio", "charttime", "available_at", "valid_value"})
    lab = lab[lab.stay_id.isin(stays)]
    lab = lab[lab.valid_value.astype(str).str.lower().eq("true")] if lab.valid_value.dtype == object else lab[lab.valid_value]
    for c in ["charttime", "available_at"]:
        lab[c] = pd.to_datetime(lab[c], errors="coerce").astype("datetime64[ns]")
    parts = []
    for ch in pd.read_csv(out_dir / "07_context_private.csv", chunksize=2_000_000, low_memory=False):
        ch = ch[ch.stay_id.isin(stays)].copy()
        for c in ["charttime", "available_at"]:
            ch[c] = pd.to_datetime(ch[c], errors="coerce").astype("datetime64[ns]")
        ch["kind"], ch["label"] = shared(ch.kind), shared(ch.label.astype(str))
        parts.append(ch)
    context = pd.concat(parts, ignore_index=True)
    return cohort, events.reset_index(drop=True), lab, context


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, default=None)
    ap.add_argument("--exclude-subjects", type=Path, default=None)
    ap.add_argument("--site", default="mimic-iv")
    ap.add_argument("--result", type=Path, required=True)
    ap.add_argument("--min-cell", type=int, default=10)
    ap.add_argument("--all-evaluation", action="store_true", help="모든 사건 (순수 외부 검증). 없으면 평가 집단 사건만")
    a = ap.parse_args(argv)
    t_start = time.time()
    pkg = a.package.resolve()
    sys.path.insert(0, str(pkg))
    from kcd_liver import develop as D
    from kcd_liver.rule_agent import CAUSE_FLAGS, VERSION, rule_agent1

    A = Agg(a.min_cell)
    exclude = set(pd.read_csv(a.exclude_subjects).subject_id) if a.exclude_subjects else set()
    log("자료 읽기 (사건이 있는 입실만)")
    cohort, events, lab, context = load_events(a.out_dir, exclude, None if a.all_evaluation else "evaluation")
    adm = read_hosp(a.data_root, "admissions", ["subject_id", "hadm_id", "dischtime"])
    dx = read_hosp(a.data_root, "diagnoses_icd", ["subject_id", "hadm_id", "icd_code", "icd_version"])
    hist = D.history_flags(cohort[cohort.stay_id.isin(set(events.stay_id))], adm, dx).set_index("stay_id")
    del adm, dx
    lab_g = {k: g for k, g in lab.groupby("stay_id")}
    ctx_g = {k: g for k, g in context.groupby("stay_id")}
    log(f"사건 {len(events):,}, 검사 {len(lab):,}, 맥락 {len(context):,}")

    rows = []
    for i, e in enumerate(events.itertuples(), 1):
        hrow = hist.loc[e.stay_id].to_dict() if e.stay_id in hist.index else {}
        P = D.snapshot_payload(e.stay_id, e.t0, lab_g, ctx_g, hrow)
        r = rule_agent1(P)
        ex = P.get("exposures") or {}
        info = {"labs": {l["analyte"]: l["ratio"] for l in P["labs"]}, "vitals": {c["label"] for c in P["context"] if c["kind"] == "vital"},
                "hb_drop": P.get("hemoglobin_drop_48h"), "serology": len(ex.get("serology", [])),
                "hist_known": any(pd.notna(v) for v in hrow.values())}
        comp = {c: [bool(f(info)) for _, f in NEED[c]] for c in CAUSE_FLAGS}
        flips = {c: [] for c in CAUSE_FLAGS}

        def recheck(Q, name, f):
            rr = rule_agent1(Q)
            for c in CAUSE_FLAGS:
                if rr["flags"][c]["present"] != r["flags"][c]["present"]:
                    flips[c].append((name, f))

        for j, l in enumerate(P["labs"]):
            for f in (1 - ERR, 1 + ERR):
                Q = copy.deepcopy(P)
                Q["labs"][j]["value"] = l["value"] * f
                if l["ratio"] is not None:
                    Q["labs"][j]["ratio"] = l["ratio"] * f
                recheck(Q, l["analyte"], f)
        if P.get("hemoglobin_drop_48h") is not None:
            for f in (1 - ERR, 1 + ERR):
                recheck({**P, "hemoglobin_drop_48h": P["hemoglobin_drop_48h"] * f}, "HEMOGLOBIN_DROP", f)
        rows.append({"abstain": bool(r["abstain"]), "uncertainty": r.get("uncertainty"), "pattern": r.get("pattern"),
                     **{f"{c}__present": int(r["flags"][c]["present"]) for c in CAUSE_FLAGS},
                     **{f"{c}__fragile": int(bool(flips[c])) for c in CAUSE_FLAGS},
                     **{f"{c}__have": sum(comp[c]) for c in CAUSE_FLAGS}, **{f"{c}__need": len(comp[c]) for c in CAUSE_FLAGS},
                     **{f"{c}__i{k}": v for c in CAUSE_FLAGS for k, v in enumerate(comp[c])},
                     **{f"{c}__by": "|".join(sorted({n for n, _ in flips[c]})) for c in CAUSE_FLAGS}})
        if i % 500 == 0:
            log(f"{i:,}/{len(events):,}")
    T = pd.DataFrame(rows)
    per = {}
    for c in CAUSE_FLAGS:
        pos = T[f"{c}__present"].eq(1).to_numpy()
        fr = T[f"{c}__fragile"].eq(1).to_numpy()
        share = (T[f"{c}__have"] / T[f"{c}__need"]).to_numpy()
        by = T.loc[fr, f"{c}__by"].str.split("|").explode().value_counts()
        per[c] = {"positive": rate(pos), "positive_n": A.n(pos.sum()), "fragile": rate(fr),
                  "fragile_among_positive": rate(fr[pos]) if pos.any() else None,
                  "fragile_among_negative": rate(fr[~pos]) if (~pos).any() else None,
                  "completeness_mean": float(share.mean()), "complete": rate(share >= 1 - 1e-9), "half_or_less": rate(share <= 0.5 + 1e-9),
                  "complete_among_positive": rate(share[pos] >= 1 - 1e-9) if pos.any() else None,
                  "items_present": {n: rate(T[f"{c}__i{k}"]) for k, (n, _) in enumerate(NEED[c])},
                  "fragile_by_input": {k: A.n(v) for k, v in by.head(5).items()}}
    fr_any = T[[f"{c}__fragile" for c in CAUSE_FLAGS]].max(axis=1).to_numpy().astype(bool)
    npos = T[[f"{c}__present" for c in CAUSE_FLAGS]].sum(axis=1).to_numpy()
    R = {"meta": {"site": a.site, "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rule_model": VERSION,
                  "error_range": ERR, "min_cell_suppression": a.min_cell, "events": A.n(len(T)),
                  "runtime_minutes": round((time.time() - t_start) / 60, 1)},
         "overall": {"abstain": rate(T.abstain), "any_fragile": rate(fr_any),
                     "positive_causes": {**{str(k): rate(npos == k) for k in range(0, 5)}, "5+": rate(npos >= 5)},
                     "mean_positive_causes": float(npos.mean()),
                     "pattern": {str(k): rate(T.pattern.eq(k)) for k in T.pattern.dropna().unique()}},
         "by_cause": per}
    a.result.parent.mkdir(parents=True, exist_ok=True)
    a.result.write_text(json.dumps(R, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    log(f"완료 {R['meta']['runtime_minutes']}분 → {a.result}")


if __name__ == "__main__":
    main()
