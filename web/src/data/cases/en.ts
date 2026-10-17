// 사례 자료 문구의 영어 (화면에 보일 때만 바꿈). 판정 로직은 원래 한국어 자료를 그대로 쓴다.
import { lang } from '../../lib/i18n'

const EN: Record<string, string> = {
  // 투약 분류, 투약 문구
  '승압제·심혈관': 'Vasopressors · cardiovascular', 항혈전: 'Antithrombotic', '진통·진정': 'Analgesia · sedation', 항생제: 'Antibiotics',
  기타: 'Other', 수혈: 'Transfusion', '지속 주입': 'Continuous infusion', 지속: 'Continuous', 중단: 'Stopped', 시작: 'Started',
  '1 g (예방)': '1 g (prophylaxis)', '2 g (수술 예방)': '2 g (surg. ppx)', '500 mg (수술 예방)': '500 mg (surg. ppx)',
  농축적혈구: 'Packed red cells', '1단위': '1 unit', '33~36도': '33–36 °C',
  // 배지
  기계환기: 'Ventilator', '목표 체온 유지': 'Targeted temperature', 승압제: 'Vasopressor', '연명의료 중단': 'Life support withdrawn',
  '알레르기 없음': 'No allergies', '수술 뒤': 'Post-op', '연명의료 유보': 'Life support withheld', 간경변: 'Cirrhosis',
  // 퇴실
  사망: 'Died', '소화기내과 병동': 'Gastroenterology ward', '외과 병동': 'Surgical ward',
  // 미생물
  '혈액 (말초)': 'Blood (peripheral)', '혈액배양 2회': 'Blood culture ×2', '5일 배양 균 자라지 않음': 'No growth at 5 days',
  '48시간 균 자라지 않음': 'No growth at 48 h', 복수: 'Ascites', '일반 배양': 'Routine culture',
  '장내세균 혼합 (E. coli, Bacteroides fragilis)': 'Mixed enteric flora (E. coli, Bacteroides fragilis)',
  '그람음성 막대균 (E. coli 추정)': 'Gram-negative rods (likely E. coli)', 그람음성: 'Gram-negative', '그람음성 막대균': 'Gram-negative rods',
  'Escherichia coli (piperacillin/tazobactam 감수성)': 'Escherichia coli (piperacillin/tazobactam susceptible)',
  담즙: 'Bile', '그람양성 알균': 'Gram-positive cocci', 배액: 'Drain fluid', '장내세균 혼합': 'Mixed enteric flora',
  // 영상·처치
  처치: 'Procedure', 영상: 'Imaging', 검사: 'Test', '관상동맥 중재술 (스텐트)': 'Coronary intervention (stent)',
  '목표 체온 유지 시작': 'Targeted temperature management started', '응급실에서 삽관': 'Intubated in the ED', '경흉부 심초음파': 'Transthoracic echo',
  '판독문 없음': 'No report', '뇌 CT': 'Brain CT', '목표 체온 유지 종료': 'Targeted temperature management ended', 뇌파: 'EEG',
  '연명의료 중단 결정': 'Decision to withdraw life support', '복부 CT': 'Abdominal CT', '응급 개복술 (하트만 수술)': 'Emergency laparotomy (Hartmann procedure)',
  '기계환기 (수술 뒤)': 'Mechanical ventilation (post-op)', '중심정맥관 삽입': 'Central line', '동맥관 삽입': 'Arterial line',
  '연명의료 유보 결정': 'Decision to withhold life support', '위내시경 정맥류 결찰': 'Endoscopic variceal ligation', '복부 초음파': 'Abdominal ultrasound',
  '적혈구 수혈 2단위': 'Red cell transfusion ×2', '정맥류 결찰': 'Variceal ligation', 'ERCP 결석 제거, 담관 스텐트': 'ERCP stone removal, biliary stent',
  저위전방절제술: 'Low anterior resection', '경피 배액': 'Percutaneous drainage',
  // 자료에 없는 기록
  '측정 기록 없음': 'Not measured', '간염 바이러스 표지자': 'Hepatitis virus markers', 합토글로빈: 'Haptoglobin',
  '측정 기록 없음 (용혈 판단 불가)': 'Not measured (hemolysis cannot be judged)', 'NT-proBNP': 'NT-proBNP',
  '영상·뇌파 판독문': 'Imaging and EEG reports', '영상 판독문': 'Imaging reports', '영상·시술 판독문': 'Imaging and procedure reports',
  '자료에 시행 기록만 있고 판독문 없음': 'Only the order is recorded; no report', 'D1~D2 INR, 젖산': 'INR, lactate on D1–D2',
  '수술 뒤 안정기에 측정하지 않음': 'Not measured while stable after surgery',
  // 시간선
  'MAP 65 미만': 'MAP < 65', 노르에피네프린: 'Norepinephrine', 에피네프린: 'Epinephrine', 바소프레신: 'Vasopressin', 혈액배양: 'Blood culture',
  테를리프레신: 'Terlipressin', 세프트리악손: 'Ceftriaxone', '피페라실린/타조박탐': 'Piperacillin/tazobactam', 아세트아미노펜: 'Acetaminophen',
  // 검사 묶음
  '간 기능': 'Liver', '근육·용혈': 'Muscle · hemolysis', 신장: 'Kidney', '전해질·대사': 'Electrolytes · metabolic', 혈액가스: 'Blood gas', '혈액·염증': 'Blood · inflammation',
  // 과거력
  '알코올 간경변': 'Alcoholic cirrhosis',
  // 환자 목록 (이름은 가운데 글자를 가린 로마자)
  '한○수': 'Han ○-su', '윤○자': 'Yoon ○-ja', '강○철': 'Kang ○-cheol', '서○희': 'Seo ○-hee', '임○호': 'Lim ○-ho',
  '정○민': 'Jeong ○-min', '이○희': 'Lee ○-hee', '최○영': 'Choi ○-young', '윤○아': 'Yoon ○-a', '문○석': 'Moon ○-seok',
  '급성 심근경색, 심실세동 심정지 뒤 자발순환 회복 (스텐트 시술)': 'Acute MI, VF arrest with ROSC (stent placed)',
  'S결장 천공, 범발성 복막염, 응급 개복술 뒤': 'Sigmoid perforation, diffuse peritonitis, after emergency laparotomy',
  '식도정맥류 출혈, 알코올 간경변': 'Esophageal variceal bleeding, alcoholic cirrhosis',
  '총담관 결석, 급성 담관염, 패혈성 쇼크': 'Common bile duct stone, acute cholangitis, septic shock',
  '직장암, 저위전방절제술 뒤 문합부 누출': 'Rectal cancer, anastomotic leak after low anterior resection',
  '급성 심근경색': 'Acute MI', '상부 위장관 출혈': 'Upper GI bleeding', 횡문근융해: 'Rhabdomyolysis', 폐렴: 'Pneumonia', '급성 호흡곤란 증후군': 'ARDS',
  순환기내과: 'Cardiology', 외과: 'Surgery', 소화기내과: 'Gastroenterology', 신장내과: 'Nephrology', 호흡기내과: 'Pulmonology',
}

/** 숫자가 들어간 시간선 이름 */
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^MAP 최저 (\d+)$/, m => `MAP nadir ${m[1]}`],
  [/^젖산 ([\d.]+)$/, m => `Lactate ${m[1]}`],
  [/^발열 ([\d.]+)$/, m => `Fever ${m[1]}`],
  [/^발열 ([\d.]+), MAP (\d+)$/, m => `Fever ${m[1]}, MAP ${m[2]}`],
  [/^([\d.]+) 시작$/, m => `${m[1]} started`],
]

/** 사례 자료 문구를 지금 언어로 (영어 번역이 없으면 그대로) */
export function tx(s: string): string
export function tx(s: string | undefined): string | undefined
export function tx(s: string | undefined): string | undefined {
  if (s === undefined || lang() !== 'en') return s
  if (EN[s]) return EN[s]
  for (const [re, f] of PATTERNS) {
    const m = s.match(re)
    if (m) return f(m)
  }
  return s
}
