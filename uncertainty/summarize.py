"""stage1, stage3 결과 JSON (집계) 을 문서에 붙일 표 (마크다운) 로.

  python uncertainty/summarize.py --stage1 stage1_mimic.json --stage3 stage3_mimic.json > summary.md
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def pc(x, d=1):
    return "-" if x is None else f"{x * 100:.{d}f}%"


def pp(x, d=2):
    return "-" if x is None else f"{x * 100:.{d}f}%p"


def f3(x):
    return "-" if x is None else f"{x:.3f}"


def n(x):
    return "<10" if x is None else f"{x:,}"


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def stage1(R) -> str:
    s = []
    c = R["counts"]
    s.append(f"자료: {R['meta']['site']}, 정상 구간 시각 평가 {n(c['eligible_evaluation'])} ({n(c['evaluation_patients'])}명), "
             f"개발 {n(c['eligible_development'])} ({n(c['development_patients'])}명)")
    if R.get("reproduction"):
        r = R["reproduction"]
        s.append(f"재현: 5배 AUROC {r['auroc_here']:.6f}, 모델 카드 {r['model_card_auroc']:.6f} → {'같음' if r['same'] else '다름'}")
    s.append("\n**4-1 배수별 성능 (평가 집단, 정답을 아는 시각)**\n")
    s.append(table(["배수", "시각", "사건", "양성률", "AUROC", "AUPRC", "보정 절편", "보정 기울기"],
                   [[f"{r['k']}배", n(r["n"]), n(r["events"]), pc(r["prevalence"], 2), f3(r["auroc"]), f3(r["auprc"]),
                     f3(r["cal_intercept"]), f3(r["cal_slope"])] for r in R["ladder_by_threshold"]]))
    li = R["ladder_inversion"]
    s.append("\n**4-1 사다리 뒤집힘 (평가 집단 모든 정상 구간 시각)**\n")
    bands = list(li["p5_band_hours"])
    s.append(table(["허용 폭", "시각 비율", "환자 비율 (한 번이라도)"] + [f"5배 확률 {b}" for b in bands],
                   [[pp(t["tol"], 1), pc(t["hours_rate"]), pc(t["patients_rate"])] + [pc(t["by_p5_band"][b]) for b in bands]
                    for t in li["by_tolerance"]]))
    s.append("시각 수 (5배 확률 구간별): " + ", ".join(f"{b} {n(v)}" for b, v in li["p5_band_hours"].items()))
    ra = R["rules_all_hours"]
    s.append("\n**4-7 확신 규칙 (평가 집단 모든 정상 구간 시각, 규칙 4 제외)**\n")
    s.append(table(["규칙", "해당 비율"], [["1 핵심 입력 2개 이상 결측", pc(ra["rate"]["r1"])], ["2 MIMIC 범위 밖 (22개 중 하나라도)", pc(ra["rate"]["r2"])],
                                        ["3 입력 오류 보류", pc(ra["rate"]["r3"])], ["5 사다리 뒤집힘 (허용 0)", pc(ra["rate"]["r5"])],
                                        ["1, 2, 3, 5 중 하나라도 (확신 낮음)", pc(ra["low_without_r4"])]]))
    s.append("\n핵심 입력 결측 비율: " + ", ".join(f"{k} {pc(v)}" for k, v in ra["missing_rate_by_core"].items()))
    s.append("\n규칙 2 대안 (범위 밖 변수 수): " + ", ".join(f"{k.replace('oor>=', '')}개 이상 {pc(v)}" for k, v in ra["r2_alternatives"].items()))
    top = sorted(ra["oor_rate_by_feature"].items(), key=lambda kv: -(kv[1] or 0))[:8]
    s.append("\n범위 밖이 잦은 변수: " + ", ".join(f"{k} {pc(v)}" for k, v in top))
    pk = ra["performance_known"]
    s.append("\n**5장 확신별 성능 (평가 집단 정답을 아는 모든 시각, 규칙 1, 2, 3, 5)**\n")
    rows = []
    for k, lab in [("all", "전체"), ("high", "확신 높음"), ("low", "확신 낮음")] + [(f"{h}_r{j}", f"규칙 {j} {'해당' if h == 'low' else '해당 없음'}")
                                                                              for j in (1, 2, 3, 5) for h in ("high", "low")]:
        g = pk.get(k) or {}
        rows.append([lab, n(g.get("n")), n(g.get("events")), f3(g.get("auroc")), f3(g.get("auprc")), f3(g.get("cal_intercept")), f3(g.get("cal_slope"))])
    s.append(table(["묶음", "시각", "사건", "AUROC", "AUPRC", "보정 절편", "보정 기울기"], rows))
    cal = R.get("calibration") or {}
    if cal.get("original"):
        s.append(f"\n**4-4 재보정 ({cal['fit_on']}: 맞춤 {n(cal['fit_rows'])}시각, 확인 {n(cal['test_rows'])}시각)**\n")
        s.append(table(["방법", "AUROC", "Brier", "보정 절편", "보정 기울기", "상위 10% PPV"],
                       [[m, f3(cal[m]["auroc"]), f"{cal[m]['brier']:.4f}", f3(cal[m]["cal_intercept"]), f3(cal[m]["cal_slope"]), pc(cal[m]["top10_ppv"])]
                        for m in ("original", "logistic", "isotonic")]))
        dec = cal["original"]["deciles"] or []
        s.append("\n보정 구간 (원래 확률, 10분위): " + "; ".join(f"예측 {pc(d['mean_predicted'], 1)} → 실제 {pc(d['observed'], 1)} ({pc(d['ci_low'], 1)}~{pc(d['ci_high'], 1)})" for d in dec))
    lb = R["label_bounds"]
    s.append("\n**4-8 정답 불확실성 범위 (재측정 없는 시각을 모두 음성 / 모두 양성)**\n")
    s.append(table(["정답", "AUROC", "AUPRC", "양성률"], [["아는 시각만", f3(lb["known_only"]["auroc"]), f3(lb["known_only"]["auprc"]), "-"],
                                                     ["모두 음성", f3(lb["all_negative"]["auroc"]), f3(lb["all_negative"]["auprc"]), pc(lb["all_negative"]["prevalence"], 2)],
                                                     ["모두 양성", f3(lb["all_positive"]["auroc"]), f3(lb["all_positive"]["auprc"]), pc(lb["all_positive"]["prevalence"], 2)]]))
    s.append("정답 종류 비율: " + ", ".join(f"{k} {pc(v)}" for k, v in lb["label_share"].items()))
    wl = R["width_limit"]
    s.append(f"\n**4-2 구간** 규칙 4 기준 {pp(wl['value'])} ({wl['source']})")
    if R.get("development_sample"):
        d = R["development_sample"]
        s.append(f"개발 표본 {n(d['n'])}시각: 폭 중앙 {pp(d['width']['p50'])}, 75% {pp(d['width']['p75'])}, 90% {pp(d['width']['p90'])}. "
                 f"규칙별 해당 " + ", ".join(f"{k} {pc(v)}" for k, v in d["rate"].items()) + f", 확신 낮음 {pc(d['low'])}")
    iv = R["interval_sample"]
    s.append(f"\n평가 표본 {n(iv['n'])}시각 (사건 {n(iv['events'])}): 폭 중앙 {pp(iv['width']['p50'])}, 90% {pp(iv['width']['p90'])}, "
             f"확률이 구간 위 {pc(iv['p_above'])}, 아래 {pc(iv['p_below'])}\n")
    s.append(table(["빠진 핵심 입력 수", "시각", "폭 중앙", "폭 90%", "확률이 구간 위", "아래"],
                   [[k, n(v["n"]), pp((v["width"] or {}).get("p50")), pp((v["width"] or {}).get("p90")), pc(v["p_above"]), pc(v["p_below"])]
                    for k, v in iv["by_missing_count"].items()]))
    nx = iv["next_test"]
    if nx.get("best_test_share"):
        s.append(f"\n줄이는 검사 (빠진 항목이 있는 {n(nx['rows_with_missing'])}시각): 가장 많이 줄이는 검사 " +
                 ", ".join(f"{k} {pc(v)}" for k, v in nx["best_test_share"].items() if v) +
                 f". 폭 중앙 {pp(nx['width_now']['p50'])} → {pp(nx['width_after_best']['p50'])} (상대 감소 중앙 {pc(nx['relative_reduction']['p50'])})")
    mt = R["masking_test"]
    s.append("\n**가림 시험: 잰 검사를 가리고 만든 구간에 실제 값의 확률이 드는가 (명목 80%)**\n")
    s.append(table(["검사", "시각", "그 항목만 대체: 안에 듦", "위로 벗어남", "가린 확률이 안에 듦", "화면 구간: 안에 듦", "가린 확률 - 실제 확률 (중앙)"],
                   [[k, n(v["n"]), pc(v["impute_only"]["true_inside"]), pc(v["impute_only"]["true_above"]), pc(v["impute_only"]["masked_inside"]),
                     pc(v["screen_interval"]["true_inside"]), pp(v["masked_minus_true"]["p50"])] for k, v in mt.items()]))
    cs = R["confidence_sample"]
    s.append(f"\n**확신 (규칙 1~5, 평가 시각 {cs.get('rows', 'one-per-patient')})**: 확신 낮음 {pc(cs['low'])}. 규칙별 " + ", ".join(f"{k} {pc(v)}" for k, v in cs["rate"].items()) + "\n")
    grp = [("전체", cs["all"]), ("확신 높음", cs["high"]), ("확신 낮음", cs["low_group"]), ("규칙 4 해당 없음", cs["high_r4"]), ("규칙 4 해당", cs["low_r4"])]
    if cs.get("r4_logit"):
        grp += [("규칙 4 (로짓 폭) 해당 없음", cs["r4_logit"]["high"]), ("규칙 4 (로짓 폭) 해당", cs["r4_logit"]["low"])]
    s.append(table(["묶음", "시각", "사건", "평균 예측", "실제", "AUROC", "AUPRC", "보정 절편", "보정 기울기"],
                   [[lab, n(g.get("n")), n(g.get("events")), pc(g.get("mean_pred"), 2), pc(g.get("prevalence"), 2), f3(g.get("auroc")), f3(g.get("auprc")),
                     f3(g.get("cal_intercept")), f3(g.get("cal_slope"))] for lab, g in grp]))
    if cs.get("r4_logit"):
        s.append(f"\n규칙 4 대안 (로짓 폭, 개발 표본 상위 25% = {cs['r4_logit']['limit']:.3f}): 해당 {pc(cs['r4_logit']['rate'])}")
    if cs.get("by_p5_band"):
        s.append("\n같은 예측 확률대 안에서 실제 발생률 (평균 예측 / 실제, 시각 수)\n")
        labs = [("high", "확신 높음"), ("low", "확신 낮음"), ("not_r1", "규칙 1 해당 없음"), ("r1", "규칙 1 해당")]
        s.append(table(["5배 확률대"] + [l for _, l in labs],
                       [[b] + [f"{pc(v[k]['mean_pred'], 2)} / {pc(v[k]['observed'], 2)} ({n(v[k]['n'])})" if v[k]["n"] else "-" for k, _ in labs]
                        for b, v in cs["by_p5_band"].items()]))
    s.append("\n보류 곡선 (확신 낮은 순으로 보류할 때 남은 시각의 AUROC / 사건률)\n")
    cur = cs["abstain_curves"]
    names = {"rules_then_width": "규칙 수, 그다음 폭", "width": "구간 폭 (%p)", "logit_width": "구간 폭 (로짓)", "rules_without_r2": "규칙 2 를 뺀 규칙 수, 그다음 폭",
             "rules_without_r2_logit": "규칙 2 를 빼고 규칙 4 를 로짓 폭으로", "rule1_only": "규칙 1, 그다음 로짓 폭"}
    fr = [p["abstain"] for p in next(iter(cur.values()))]
    s.append(table(["순서"] + [f"{int(f * 100)}% 보류" for f in fr],
                   [[names.get(k, k)] + [f"{f3(p['auroc'])} / {pc(p.get('event_rate'), 1)}" for p in v] for k, v in cur.items()]))
    pe = R["pending"]
    s.append(f"\n**4-3 결과 대기**: 보고 대기 핵심 검사가 있는 시각 {pc(pe['rate_all_hours'])} (평가 집단 전체), 표본 {pc(pe['rate_sample'])}. "
             f"대기 시간 중앙 {pe['delay_hours']['p50']:.1f}시간 (90% {pe['delay_hours']['p90']:.1f})\n" if pe.get("delay_hours") else "")
    s.append(table(["묶음", "시각", "|변화| 중앙", "|변화| 90%", "1%p 이상", "5%p 이상", "경보 뒤집힘 10%", "20%", "30%"],
                   [[lab, n(g["n"]), pp(g["abs_change"]["p50"]) if g["abs_change"] else "-", pp(g["abs_change"]["p90"]) if g["abs_change"] else "-",
                     pc(g["abs_ge_1pp"]), pc(g["abs_ge_5pp"]), pc(g["alarm_flip_10"]), pc(g["alarm_flip_20"]), pc(g["alarm_flip_30"])]
                    for lab, g in [("대기 검사 있음 (보고 뒤)", pe["with_pending"]), ("대기 없음 (같은 시간 뒤)", pe["without_pending_matched_delay"])]]))
    return "\n".join(s)


def stage3(R) -> str:
    s = []
    p = R["prognosis"]
    s.append(f"**4-5 예후 경로 집합 (90%)**: 기준 반 {n(p['fit_n'])}건, 확인 반 {n(p['test_n'])}건 (회복 판정 가능 사건). 1순위 정확도 {pc(p['top1_accuracy'])}\n")
    rows = []
    for k, lab in (("aps", "APS (확률 큰 순으로 더함, 기준 {:.3f})"), ("lac", "LAC (확률 {:.3f} 이상)"), ("screen_provisional", "화면 임시 (더해서 {:.2f})")):
        v = p[k]
        thr = v.get("threshold_mass", v.get("min_prob", v.get("mass")))
        rows.append([lab.format(thr), pc(v["coverage"]), f"{v['mean_size']:.2f}", pc(v["two_or_more"])] +
                    [pc(v["size_share"].get(str(i))) for i in range(1, 5)])
    if p.get("transported"):
        for k in ("aps", "lac"):
            v = p["transported"][k]
            rows.append([f"{p['transported']['from_site']} 기준 그대로 ({k})", pc(v["coverage"]), f"{v['mean_size']:.2f}", pc(v["two_or_more"])] +
                        [pc(v["size_share"].get(str(i))) for i in range(1, 5)])
    s.append(table(["방법", "포함률", "평균 크기", "2개 이상 (규칙 6)", "1개", "2개", "3개", "4개"], rows))
    s.append("\n경로별 포함률 (APS): " + ", ".join(f"{k} {pc(v)}" for k, v in p["aps"]["coverage_by_true_path"].items()))
    s.append("평균 예측 대 실제: " + ", ".join(f"{k} {pc(v['pred'])} / {pc(v['obs'])}" for k, v in p["mean_pred_vs_observed"].items()))
    if R.get("icu_death"):
        d = R["icu_death"]
        s.append(f"ICU 사망 모델 (모든 사건 {n(d['n'])}건): AUROC {f3(d['auroc'])}, 보정 절편 {f3(d['cal_intercept'])}, 기울기 {f3(d['cal_slope'])}")
    t = R["trajectory"]
    s.append(f"\n**4-5 궤적 띠 (80%, CQR)**: 시각 {n(t['landmarks'])} (4시간 간격)\n")
    head = ["검사", "시간", "확인 시각", "원래 포함률", "CQR 포함률", "넓힐 폭 (배)", "원래 폭 중앙 (배)", "넓힌 폭 중앙 (배)"]
    rows = [[r["analyte"], r["horizon_h"], n(r["test_n"]), pc(r["coverage_raw"]), pc(r["coverage_cqr"]), f"{r['widen_factor']:.2f}",
             f"{2 ** r['width_raw_log2']['p50']:.2f}", f"{2 ** r['width_cqr_log2']['p50']:.2f}"] for r in t["rows"]]
    if any("coverage_transported" in r for r in t["rows"]):
        head.append("이식 기준 포함률")
        for row, r in zip(rows, t["rows"]):
            row.append(pc(r.get("coverage_transported")))
    s.append(table(head, rows))
    return "\n".join(s)


CAUSE_KO = {"hypoxic_hepatitis": "1 저산소성 간염", "congestive_hepatopathy": "2 울혈성 간병증", "sepsis_cholestasis": "3 패혈증 담즙정체",
            "dili": "4 약물 간손상", "pn_associated": "5 정맥영양 관련", "biliary_obstruction_cholangitis": "6 담도 폐쇄, 담관염",
            "cholecystitis": "7 담낭염", "hemolysis": "8 용혈", "viral_hepatitis": "9 바이러스 간염", "others": "10 기타 (근육 등)"}


def stage4(R) -> str:
    s = []
    o = R["overall"]
    s.append(f"**4-6 원인 판정의 단단함** ({R['meta']['site']}, 사건 {n(R['meta']['events'])}, 규칙 {R['meta']['rule_model']}, 검사 오차 ±{int(R['meta']['error_range'] * 100)}%)")
    s.append(f"판단 보류 {pc(o['abstain'])}, 판정 취약 원인이 하나라도 있는 사건 {pc(o['any_fragile'])}, 사건당 해당 원인 평균 {o['mean_positive_causes']:.2f}개\n")
    rows = []
    for c, v in R["by_cause"].items():
        by = ", ".join(f"{k}" for k in list(v["fragile_by_input"])[:3])
        rows.append([CAUSE_KO.get(c, c), pc(v["positive"]), pc(v["fragile_among_positive"]), pc(v["fragile_among_negative"]),
                     pc(v["completeness_mean"], 0), pc(v["complete_among_positive"]), by or "-"])
    s.append(table(["원인", "해당", "해당 중 취약", "해당 없음 중 취약", "근거 완성도 평균", "해당 중 근거 다 있음", "뒤집는 검사 (많은 순)"], rows))
    s.append("\n근거 항목별 '있음' 비율")
    for c, v in R["by_cause"].items():
        s.append(f"- {CAUSE_KO.get(c, c)}: " + ", ".join(f"{k} {pc(x)}" for k, x in v["items_present"].items()))
    return "\n".join(s)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage1", type=Path)
    ap.add_argument("--stage3", type=Path)
    ap.add_argument("--stage4", type=Path)
    a = ap.parse_args(argv)
    if a.stage1:
        print(stage1(json.loads(a.stage1.read_text(encoding="utf-8"))))
    if a.stage3:
        print()
        print(stage3(json.loads(a.stage3.read_text(encoding="utf-8"))))
    if a.stage4:
        print()
        print(stage4(json.loads(a.stage4.read_text(encoding="utf-8"))))


if __name__ == "__main__":
    main()
