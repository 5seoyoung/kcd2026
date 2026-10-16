import type { Patient } from '../types'

// 모두 가상 환자. 이름은 가운데 글자를 가린 형태로만 쓴다.
// plannedScenario 는 아직 기록을 만들지 않은 사례의 계획 (화면에는 안 나옴). 4명이 종료 상태 4가지를 하나씩 맡는다.
export const patients: Patient[] = [
  { id: 'p01', bed: 'MICU-01', name: '박○호', sex: 'M', age: 72, stayDay: 9, dx: '패혈성 쇼크, 담관염 의증', dept: '소화기내과', liverAlert: true, plannedScenario: '미회복 · 사망. 총빌리가 계속 오르는 담즙정체. Sepsis-induced cholestasis 와 담도폐쇄, 담관염이 함께 해당하는 원인 중첩, 궤적이 계속 오르는 그림자 사례' },
  { id: 'p02', bed: 'MICU-02', name: '이○희', sex: 'F', age: 58, stayDay: 2, dx: '상부 위장관 출혈', dept: '소화기내과', liverAlert: false },
  { id: 'p03', bed: 'MICU-03', name: '최○영', sex: 'F', age: 45, stayDay: 5, dx: '횡문근융해', dept: '신장내과', liverAlert: false },
  { id: 'p04', bed: 'MICU-04', name: '정○민', sex: 'M', age: 63, stayDay: 1, dx: '급성 심근경색', dept: '순환기내과', liverAlert: false },
  { id: 'p06', bed: 'MICU-06', name: '강○우', sex: 'M', age: 39, stayDay: 4, dx: '감염성 심내막염', dept: '감염내과', liverAlert: true, plannedScenario: '미회복 · 생존. 항생제 DILI (혼합형). 의심 약제를 보여 주고, 퇴실 때 ALT 가 2배 이상으로 남음' },
  { id: 'p07', bed: 'MICU-07', name: '김○수', sex: 'M', age: 67, stayDay: 3, dx: '지역사회획득 폐렴, 급성 호흡부전', dept: '호흡기내과', liverAlert: true, caseId: 'c01' },
  { id: 'p08', bed: 'MICU-08', name: '조○현', sex: 'F', age: 81, stayDay: 6, dx: '심부전 악화', dept: '순환기내과', liverAlert: true, plannedScenario: '회복 · 사망. 빌리루빈 단독 상승, 심초음파와 도말 없음 (Congestive hepatopathy 근거 부족, 담낭염 판단 불가). 퇴실 때 세 항목 모두 2배 미만이지만 ICU 사망' },
  { id: 'p09', bed: 'MICU-09', name: '윤○아', sex: 'F', age: 52, stayDay: 3, dx: '폐렴', dept: '호흡기내과', liverAlert: false },
  { id: 'p10', bed: 'MICU-10', name: '한○석', sex: 'M', age: 70, stayDay: 12, dx: '급성 호흡곤란 증후군', dept: '호흡기내과', liverAlert: false },
  { id: 'p11', bed: 'MICU-11', name: '서○진', sex: 'F', age: 66, stayDay: 2, dx: '당뇨병성 케톤산증', dept: '내분비내과', liverAlert: false },
]
