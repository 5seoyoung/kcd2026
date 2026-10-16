// 원인 범주 10개 (임상의 선생님 기준, 10/16). 에이전트 3 출력, 전문의 판정, 군집 설명표가 모두 이 번호를 쓴다.
// '정보 부족, 판단 보류' 는 범주가 아니라 출력 상태 (AgentRun.abstain) 로 따로 둔다.
export const CAUSES: Record<number, string> = {
  1: 'Hypoxic hepatitis',
  2: 'Congestive hepatopathy',
  3: 'Sepsis-induced cholestasis',
  4: 'DILI',
  5: 'PN-associated liver dysfunction',
  6: '담도폐쇄, 담관염',
  7: '담낭염',
  8: 'Hemolysis',
  9: 'Viral hepatitis',
  10: '기타',
}

export const causeName = (id: number) => CAUSES[id] ?? `범주 ${id}`

/** 원인 10개 근거 지도 (근거 위키) */
export const EVIDENCE_MAP = 'synthesis/icu-liver-cause-evidence-map'

/** 범주별 근거 위키: 근거 지도의 절과 자세한 개념 페이지 */
export const CAUSE_WIKI: Record<number, { section: string; page: string; title: string }> = {
  1: { section: '1. 저산소성 간염 (hypoxic hepatitis)', page: 'concepts/hypoxic-hepatitis', title: '저산소성 간염' },
  2: { section: '2. 울혈성 간병증 (congestive hepatopathy)', page: 'concepts/congestive-hepatopathy', title: '울혈성 간병증' },
  3: { section: '3. 패혈증 유발 담즙정체 (sepsis-associated cholestasis)', page: 'concepts/critical-illness-cholestatic-dysfunction', title: '패혈증·중증 질환 담즙정체' },
  4: { section: '4. 약물 유발 간손상 (DILI)', page: 'concepts/dili-diagnosis-and-causality', title: 'DILI 진단 기준과 인과성 평가' },
  5: { section: '5. 정맥영양 관련 간기능 이상 (PN-associated)', page: 'concepts/parenteral-nutrition-icu-cholestasis', title: '정맥영양과 ICU 담즙정체' },
  6: { section: '6. 담도폐쇄·담관염', page: 'concepts/cholestatic-injury-workup', title: '담즙정체형 손상 평가' },
  7: { section: '7. 담낭염', page: EVIDENCE_MAP, title: '원인 10개 근거 지도' },
  8: { section: '8. 용혈', page: 'concepts/isolated-hyperbilirubinemia', title: '빌리루빈 단독 상승' },
  9: { section: '9. 바이러스 간염', page: 'concepts/viral-hepatitis-testing', title: '바이러스 간염 검사' },
  10: { section: '10. 기타', page: EVIDENCE_MAP, title: '원인 10개 근거 지도' },
}
