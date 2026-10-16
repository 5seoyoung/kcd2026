import type { Patient } from '../types'

// 모두 가상 환자. 이름은 가운데 글자를 가린 형태로만 쓴다. 시연 사례 5명 (c1~c5) 을 순서대로 위에 두고, 나머지는 병동 목록을 채우는 환자다.
export const patients: Patient[] = [
  { id: 'c1', bed: 'CCU-01', name: '한○수', sex: 'M', age: 57, stayDay: 9, dx: '급성 심근경색, 심실세동 심정지 뒤 자발순환 회복 (스텐트 시술)', dept: '순환기내과', liverAlert: true, caseId: 'c1' },
  { id: 'c2', bed: 'SICU-05', name: '윤○자', sex: 'F', age: 81, stayDay: 2, dx: 'S결장 천공, 범발성 복막염, 응급 개복술 뒤', dept: '외과', liverAlert: true, caseId: 'c2' },
  { id: 'c3', bed: 'MICU-03', name: '강○철', sex: 'M', age: 58, stayDay: 3, dx: '식도정맥류 출혈, 알코올 간경변', dept: '소화기내과', liverAlert: true, caseId: 'c3' },
  { id: 'c4', bed: 'MICU-09', name: '서○희', sex: 'F', age: 74, stayDay: 3, dx: '총담관 결석, 급성 담관염, 패혈성 쇼크', dept: '소화기내과', liverAlert: true, caseId: 'c4' },
  { id: 'c5', bed: 'SICU-08', name: '임○호', sex: 'M', age: 66, stayDay: 5, dx: '직장암, 저위전방절제술 뒤 문합부 누출', dept: '외과', liverAlert: true, caseId: 'c5' },
  { id: 'f1', bed: 'CCU-02', name: '정○민', sex: 'M', age: 63, stayDay: 1, dx: '급성 심근경색', dept: '순환기내과', liverAlert: false },
  { id: 'f2', bed: 'MICU-01', name: '이○희', sex: 'F', age: 58, stayDay: 2, dx: '상부 위장관 출혈', dept: '소화기내과', liverAlert: false },
  { id: 'f3', bed: 'MICU-02', name: '최○영', sex: 'F', age: 45, stayDay: 5, dx: '횡문근융해', dept: '신장내과', liverAlert: false },
  { id: 'f4', bed: 'MICU-05', name: '윤○아', sex: 'F', age: 52, stayDay: 3, dx: '폐렴', dept: '호흡기내과', liverAlert: false },
  { id: 'f5', bed: 'MICU-10', name: '문○석', sex: 'M', age: 70, stayDay: 12, dx: '급성 호흡곤란 증후군', dept: '호흡기내과', liverAlert: false },
]
