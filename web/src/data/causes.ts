// 원인 범주 10개 (임상의 선생님 기준, 10/16). 에이전트 3 출력, 전문의 판정, 군집 설명표가 모두 이 번호를 쓴다.
// '정보 부족, 판단 보류' 는 범주가 아니라 출력 상태 (AgentRun.abstain) 로 따로 둔다.
import { tr } from '../lib/i18n'

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

/** 영어 화면의 범주 이름 (영어 이름은 그대로) */
const CAUSES_EN: Record<number, string> = { ...CAUSES, 6: 'Biliary obstruction / cholangitis', 7: 'Cholecystitis', 10: 'Others' }

export const causeName = (id: number) => (CAUSES[id] ? tr(CAUSES[id], CAUSES_EN[id]) : tr(`범주 ${id}`, `Category ${id}`))

/** 원인 10개 근거 지도 (근거 위키) */
export const EVIDENCE_MAP = 'synthesis/icu-liver-cause-evidence-map'

/** 범주별 근거 위키: 근거 지도의 절과 자세한 개념 페이지 */
// section, page 는 위키 앵커라 그대로 두고, title 만 지금 언어로 (CAUSE_WIKI[n].title 로 읽음)
const wiki = (section: string, page: string, ko: string, en: string) => ({
  section,
  page,
  get title() {
    return tr(ko, en)
  },
})
export const CAUSE_WIKI: Record<number, { section: string; page: string; title: string }> = {
  1: wiki('1. 저산소성 간염 (hypoxic hepatitis)', 'concepts/hypoxic-hepatitis', '저산소성 간염', 'Hypoxic hepatitis'),
  2: wiki('2. 울혈성 간병증 (congestive hepatopathy)', 'concepts/congestive-hepatopathy', '울혈성 간병증', 'Congestive hepatopathy'),
  3: wiki('3. 패혈증 유발 담즙정체 (sepsis-associated cholestasis)', 'concepts/critical-illness-cholestatic-dysfunction', '패혈증·중증 질환 담즙정체', 'Sepsis and critical-illness cholestasis'),
  4: wiki('4. 약물 유발 간손상 (DILI)', 'concepts/dili-diagnosis-and-causality', 'DILI 진단 기준과 인과성 평가', 'DILI diagnosis and causality assessment'),
  5: wiki('5. 정맥영양 관련 간기능 이상 (PN-associated)', 'concepts/parenteral-nutrition-icu-cholestasis', '정맥영양과 ICU 담즙정체', 'Parenteral nutrition and ICU cholestasis'),
  6: wiki('6. 담도폐쇄·담관염', 'concepts/cholestatic-injury-workup', '담즙정체형 손상 평가', 'Cholestatic injury workup'),
  7: wiki('7. 담낭염', EVIDENCE_MAP, '원인 10개 근거 지도', 'Evidence map of the 10 causes'),
  8: wiki('8. 용혈', 'concepts/isolated-hyperbilirubinemia', '빌리루빈 단독 상승', 'Isolated hyperbilirubinemia'),
  9: wiki('9. 바이러스 간염', 'concepts/viral-hepatitis-testing', '바이러스 간염 검사', 'Viral hepatitis testing'),
  10: wiki('10. 기타', EVIDENCE_MAP, '원인 10개 근거 지도', 'Evidence map of the 10 causes'),
}
