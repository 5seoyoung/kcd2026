"""패키지 분석 노트북 (KCD_MIMICIV_liver_agents_v2.ipynb) 에서 모델 입력용 중간 파일을 만드는 셀만 실행한다.

만드는 파일 (작업 폴더/kcd_liver_v2_outputs, 환자 단위, 밖으로 내보내지 않음):
  01_cohort_private.csv, 03_labs_private.csv, 04_cohort_flow.csv, 05_events_private.csv, 07_context_private.csv,
  10_outcomes_EVALUATION_ONLY.csv (패키지 load_private 가 읽는 형식)

셀 코드는 그대로 실행한다. 바꾸는 것은 세 가지뿐이다.
  1 자료 위치 ROOT
  2 display: 표 내용을 찍지 않고 모양만 (환자 단위 행이 출력에 남지 않게)
  3 큰 표 읽기 (scan) 의 메모리. 결과는 같다:
    - 시각 열은 덩어리마다 날짜로 바꿈 (셀이 뒤에서 같은 함수로 바꾸는 것을 앞당김)
    - 반복되는 글자 (단위, 약 이름 등) 는 같은 객체를 함께 씀
    - labevents: 코호트 입원이거나 입원 번호가 빈 행만 (셀이 뒤에서 버리는 행을 미리 버림)
    - labevents, chartevents: 숫자값이 있는 행의 원문 값 칸은 비움 (셀은 숫자값이 없는 행의 원문만 씀. 간염 혈청 검사는 그대로)
    - inputevents: 셀이 뒤에서 이름으로 고르는 항목 (승압제, 정맥영양) 만
    - emar: 셀이 뒤에서 남기는 시간 창 (ICU 입실 48시간 전 ~ 관찰 끝) 만

  python uncertainty/run_notebook_cells.py --package kcd_model_package_20261017_0043 \
      --data-root <MIMIC-IV 폴더 (hosp/, icu/)> --work local_mimic
  (점검용: --max-chunks 10 이면 큰 표를 앞 10덩어리만 읽음)
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

CELLS = [6, 8, 10, 12, 14, 16, 25]
NOTEBOOK = "notebooks/KCD_MIMICIV_liver_agents_v2.ipynb"
TIME_COLS = ["charttime", "storetime", "starttime", "endtime"]
SHARED_TEXT = {"labevents": ["valueuom", "flag"], "chartevents": ["valueuom"], "emar": ["medication", "event_txt"],
               "inputevents": ["amountuom", "rateuom", "statusdescription"], "outputevents": ["valueuom"]}
# 셀 16 의 inputevents 이름 조건 그대로
INPUT_LABELS = r"norepinephrine|epinephrine|vasopressin|phenylephrine|dopamine|dobutamine|parenteral|TPN|PPN|clinimix|kabiven|intralipid|smoflipid|lipid emulsion|amino acid"
_TEXT: dict = {}


def rss_gb() -> float:
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / 1e9 if sys.platform == "darwin" else r / 1e6


def shared(s: pd.Series) -> pd.Series:
    return s.map(lambda x: _TEXT.setdefault(x, x) if isinstance(x, str) else x)


def pre_filter(ns: dict, name: str, ch: pd.DataFrame) -> pd.Series:
    """셀이 뒤에서 버리는 행을 미리 버리는 조건 (결과는 같음)"""
    if name == "labevents":
        return ch.hadm_id.isna() | ch.hadm_id.isin(ns["hadms"])
    if name == "inputevents":
        if "_input_items" not in ns:
            di = ns.get("di")
            ns["_input_items"] = set(di.loc[di.label.str.contains(INPUT_LABELS, case=False, na=False), "itemid"]) if di is not None and len(di) else None
        return ch.itemid.isin(ns["_input_items"]) if ns["_input_items"] is not None else pd.Series(True, index=ch.index)
    return pd.Series(True, index=ch.index)


def shrink(ns: dict, name: str, ch: pd.DataFrame) -> pd.DataFrame:
    for c in TIME_COLS:
        if c in ch:
            ch[c] = pd.to_datetime(ch[c], errors="coerce")
    if name in ("labevents", "chartevents") and "value" in ch and "valuenum" in ch:
        num = pd.to_numeric(ch.valuenum, errors="coerce").notna()
        if name == "labevents":
            num &= ~ch.itemid.isin(ns.get("SEROLOGY_ITEMS", {}))
        ch.loc[num, "value"] = np.nan
    if name == "emar":
        c = ns["cohort"].drop_duplicates("hadm_id").set_index("hadm_id")
        lo = ch.hadm_id.map(c.intime - pd.Timedelta(hours=48))
        hi = ch.hadm_id.map(c.obs_end)
        ch = ch[(ch.charttime >= lo) & (ch.charttime <= hi)].copy()
    for c in SHARED_TEXT.get(name, []):
        if c in ch:
            ch[c] = shared(ch[c])
    return ch


def make_scan(ns: dict, chunk: int, max_chunks: int | None):
    def scan(module, name, wanted, filter_fn, required=True):
        p = ns["file_for"](module, name, required)
        if p is None:
            return pd.DataFrame(columns=wanted)
        have = ns["columns"](module, name)
        use = [c for c in wanted if c in have]
        parts, n, read, t0 = [], 0, 0, time.time()
        ns["progress"](f"{module}/{name}: 읽기 시작 ({p.stat().st_size / 1e9:.1f} GB 압축 파일)")
        for i, ch in enumerate(pd.read_csv(p, usecols=use, chunksize=chunk, low_memory=False), 1):
            read += len(ch)
            ch = ch.loc[filter_fn(ch) & pre_filter(ns, name, ch)].copy()
            if len(ch):
                ch = shrink(ns, name, ch)
                if len(ch):
                    parts.append(ch)
                    n += len(ch)
            if i % 20 == 0:
                ns["progress"](f"{module}/{name}: {read:,}행 읽음, {n:,}행 유지, {(time.time() - t0) / 60:.1f}분, 최대 메모리 {rss_gb():.1f} GB")
            if max_chunks and i >= max_chunks:
                ns["progress"](f"{module}/{name}: 점검 모드, {max_chunks}덩어리에서 멈춤")
                break
        ns["progress"](f"{module}/{name}: 완료 {read:,}행 중 {n:,}행 유지, {(time.time() - t0) / 60:.1f}분")
        return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=use)
    return scan


def display(x, *a, **k):
    print(f"[display: {type(x).__name__} {getattr(x, 'shape', '')}]")


def patch(src: str, old: str, new: str) -> str:
    assert src.count(old) == 1, f"바꿀 줄을 찾지 못함: {old!r}"
    return src.replace(old, new)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--max-chunks", type=int, default=None)
    a = ap.parse_args(argv)
    pkg, root, work = a.package.resolve(), a.data_root.resolve(), a.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    os.chdir(work)  # 노트북의 OUT = 지금 폴더/kcd_liver_v2_outputs
    os.environ["KCD_REPO"] = str(pkg)
    sys.path.insert(0, str(pkg))
    nb = json.loads((pkg / NOTEBOOK).read_text(encoding="utf-8"))
    ns = {"__name__": "__kcd_cells__", "_runner_display": display}
    t_all = time.time()
    for i in CELLS:
        src = "".join(nb["cells"][i]["source"])
        if i == 6:
            src = patch(src, "ROOT = Path(r'\\\\10.7.12.146\\데이터 및 소스\\MIMIC\\MIMIC4-V3.1')", f"ROOT = Path(r'{root}')")
            src = patch(src, "from IPython.display import display", "display = _runner_display")
        t = time.time()
        print(f"=== 셀 {i} 시작", flush=True)
        exec(compile(src, f"<notebook cell {i}>", "exec"), ns)
        if i == 6:
            chunk = ns["CHUNK"]
            ns["scan"] = make_scan(ns, chunk, a.max_chunks)
        print(f"=== 셀 {i} 끝 {(time.time() - t) / 60:.1f}분, 최대 메모리 {rss_gb():.1f} GB", flush=True)
    out = work / "kcd_liver_v2_outputs"
    files = {p.name: p.stat().st_size for p in sorted(out.glob("*")) if p.is_file()}
    (work / "run_cells.json").write_text(json.dumps({
        "notebook": NOTEBOOK, "cells": CELLS, "data_root": str(root), "max_chunks": a.max_chunks,
        "minutes": round((time.time() - t_all) / 60, 1), "max_rss_gb": round(rss_gb(), 1), "files_bytes": files,
        "python": sys.version.split()[0], "pandas": pd.__version__}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"완료 {(time.time() - t_all) / 60:.1f}분 → {out}", flush=True)


if __name__ == "__main__":
    main()
