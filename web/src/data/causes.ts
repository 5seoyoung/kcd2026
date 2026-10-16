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
