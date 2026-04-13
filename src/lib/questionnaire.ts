/**
 * 정형 문진 엔진.
 * - 각 단계는 정해진 선택지 (또는 슬라이더/텍스트). AI 호출 없음.
 * - 첫 카테고리 답변에 따라 증상별 분기.
 * - 모든 choice/multi-choice 의 allowOther=true 면 마지막에 "기타 (직접 입력)" 자동 추가.
 * - 종료 후 누적된 answers 를 TSV 로 빌드 → 단 한 번의 Gemini 호출로 리포트 생성.
 *
 * 참고 출처(공통 임상 문진 가이드):
 *  - OPQRST/SAMPLE 통증 평가
 *  - HINTS (현훈), POUNDing (편두통), HEART score 인풋(가슴통증) 등
 *  - 응급 Red Flag 키 (출혈/마비/시야장애/흉통+땀+방사 등)
 */

export type InputType = 'choice' | 'multi-choice' | 'slider' | 'text';

export interface QStep {
  id: string;
  text: string;
  inputType: InputType;
  options?: string[];
  allowOther?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface QAnswer {
  questionId: string;
  questionText: string;
  inputType: InputType;
  rawValue: string | string[] | number;
  displayValue: string;
  otherText?: string;
}

export const OTHER_LABEL = '기타 (직접 입력)';

// ── 도입 (모든 환자 공통) ─────────────────────────────────

const UNIVERSAL_INTRO: QStep[] = [
  {
    id: 'chief_complaint_category',
    text: '오늘 어떤 증상으로 오셨나요? 가장 가까운 것 하나만 골라주세요.',
    inputType: 'choice',
    options: [
      '머리가 아파요 (두통)',
      '가슴이 아프거나 답답해요',
      '배가 아파요',
      '기침 / 숨쉬기 불편',
      '어지러워요',
      '열이 나요',
      '허리·관절·근육이 아파요',
      '메스꺼움·구토·설사',
      '피부 발진·가려움',
      '소변·생식기 문제',
    ],
    allowOther: true,
  },
  {
    id: 'chief_complaint_detail',
    text: '증상을 조금 더 자세히 알려주세요. 어디가, 어떻게, 언제부터 느끼셨는지 편하게 적어주세요.',
    inputType: 'text',
    placeholder: '예) 어제 저녁부터 오른쪽 머리가 욱신거려요',
  },
  {
    id: 'onset',
    text: '증상이 처음 시작된 건 언제인가요?',
    inputType: 'choice',
    options: [
      '오늘 (몇 시간 전)',
      '어제 (1일 이내)',
      '2~3일 전',
      '4~7일 전',
      '1~4주 전',
      '한 달 이상',
    ],
  },
  {
    id: 'pain_scale',
    text: '지금 느끼는 불편(통증)의 강도는 어느 정도인가요? (0=전혀 없음, 10=인생에서 가장 심함)',
    inputType: 'slider',
    min: 0,
    max: 10,
  },
  {
    id: 'duration_pattern',
    text: '증상이 어떻게 나타나고 있나요?',
    inputType: 'choice',
    options: [
      '계속 지속되고 있어요',
      '하루에 여러 번 반복돼요',
      '하루에 한두 번 정도예요',
      '한두 번 있고 좋아진 적이 있어요',
      '점점 심해지고 있어요',
    ],
  },
];

// ── 증상별 분기 ───────────────────────────────────────────

const HEADACHE: QStep[] = [
  { id: 'h_thunder', text: '갑자기 "쾅" 하고 얻어맞은 듯 시작된 두통이 있었나요?', inputType: 'choice',
    options: ['예', '아니오', '잘 모르겠음'] },
  { id: 'h_worst', text: '지금까지 살면서 경험한 두통 중 가장 심한가요?', inputType: 'choice',
    options: ['예, 인생에서 가장 심해요', '비슷하게 아픈 적 있음', '아니요, 평소 두통과 비슷'] },
  { id: 'h_character', text: '두통의 양상은 어떤가요?', inputType: 'choice',
    options: ['욱신거림 (박동성)', '쪼개지는 듯', '뻐근하게 짓누름', '찌릿함', '머리띠를 두른 듯 조임'],
    allowOther: true },
  { id: 'h_location', text: '주로 어느 부위가 아픈가요?', inputType: 'choice',
    options: ['머리 전체', '왼쪽 (편측)', '오른쪽 (편측)', '뒤통수·목덜미', '관자놀이/이마', '눈 주변'] },
  { id: 'h_associated', text: '아래 증상이 같이 있나요? (해당되는 것 모두 선택)', inputType: 'multi-choice',
    options: ['구토 또는 메스꺼움', '시야 흐림·번쩍임', '한쪽 팔다리 힘 빠짐', '말이 어눌해짐', '발열', '목이 뻣뻣함', '의식이 흐려짐', '해당 없음'] },
];

const CHEST: QStep[] = [
  { id: 'c_location', text: '가슴 어느 쪽이 가장 아픈가요?', inputType: 'choice',
    options: ['가운데', '왼쪽', '오른쪽', '명치 (위쪽 배 가까이)', '가슴 전체'] },
  { id: 'c_radiation', text: '통증이 다른 곳으로 뻗어 나가나요? (모두 선택)', inputType: 'multi-choice',
    options: ['왼쪽 팔로', '턱·목으로', '등으로', '오른팔로', '뻗지 않음'] },
  { id: 'c_character', text: '통증의 느낌은 어떤가요?', inputType: 'choice',
    options: ['짓누르거나 조이는 듯', '찌르는 듯', '타는 듯', '쥐어짜는 듯', '뻐근함'],
    allowOther: true },
  { id: 'c_dyspnea', text: '숨쉬기가 답답하거나 호흡곤란이 있나요?', inputType: 'choice',
    options: ['심하게 있음', '약간 있음', '없음'] },
  { id: 'c_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['식은땀', '실신·어지러움', '구토', '심장이 빠르게 두근거림', '발열', '왼팔 저림', '해당 없음'] },
  { id: 'c_history', text: '평소 심혈관 관련 진단을 받으신 적이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['고혈압', '당뇨', '고지혈증', '심근경색·협심증', '부정맥', '뇌졸중', '없음'] },
];

const ABDOMINAL: QStep[] = [
  { id: 'a_location', text: '배의 어느 부위가 가장 아픈가요?', inputType: 'choice',
    options: ['명치 (윗배 가운데)', '오른쪽 윗배', '왼쪽 윗배', '배꼽 주위', '오른쪽 아랫배', '왼쪽 아랫배', '배 전체'] },
  { id: 'a_meal', text: '식사와 관련이 있나요?', inputType: 'choice',
    options: ['식사 직후 심해져요', '공복일 때 심해져요', '특정 음식을 먹으면 심해져요', '식사와 무관해요'] },
  { id: 'a_vomiting', text: '구토나 메스꺼움이 있나요?', inputType: 'choice',
    options: ['구토했음', '메스꺼움만 있음', '없음'] },
  { id: 'a_stool', text: '대변 상태에 변화가 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['설사', '변비', '검은 변', '혈변', '점액 섞임', '평소와 같음'] },
  { id: 'a_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['발열', '오한', '소변 색 변화', '소변 시 통증', '복부 팽만', '체중 감소', '해당 없음'] },
];

const RESPIRATORY: QStep[] = [
  { id: 'r_cough_type', text: '기침 형태는?', inputType: 'choice',
    options: ['마른 기침 (가래 없음)', '가래 있는 기침', '발작적으로 심한 기침', '기침은 거의 없음'] },
  { id: 'r_phlegm', text: '가래 색은 어떤가요?', inputType: 'choice',
    options: ['투명·맑음', '하얀색', '노란색', '초록색', '피가 섞임', '가래 없음'] },
  { id: 'r_dyspnea', text: '호흡 곤란 정도는 어떤가요?', inputType: 'choice',
    options: ['평소처럼 잘 쉼', '계단 오를 때 숨참', '평지에서도 숨참', '쉴 때도 숨이 참'] },
  { id: 'r_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['발열', '오한', '가슴 통증', '인후통', '콧물', '몸살·근육통', '해당 없음'] },
  { id: 'r_smoking', text: '흡연 경험이 있나요?', inputType: 'choice',
    options: ['현재 흡연 중', '과거 흡연 (금연)', '비흡연'] },
];

const DIZZINESS: QStep[] = [
  { id: 'd_type', text: '어지러움이 어떤 느낌인가요?', inputType: 'choice',
    options: ['빙글빙글 도는 느낌', '몸이 붕 뜨는 느낌', '쓰러질 것 같은 느낌', '머리가 멍한 느낌'],
    allowOther: true },
  { id: 'd_trigger', text: '특정 동작에서 더 심해지나요?', inputType: 'choice',
    options: ['고개를 돌리거나 누울 때', '갑자기 일어설 때', '항상 비슷함', '잘 모르겠음'] },
  { id: 'd_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['실신·실신감', '귀 울림 (이명)', '청력 저하', '두통', '시야 흐림', '구역·구토', '해당 없음'] },
];

const FEVER: QStep[] = [
  { id: 'f_temperature', text: '체온을 재보셨다면 몇 도였나요? (잘 모르면 0으로 두세요)', inputType: 'slider',
    min: 0, max: 41 },
  { id: 'f_pattern', text: '열이 어떤 식으로 오르나요?', inputType: 'choice',
    options: ['계속 높음', '오르락내리락', '저녁에만 높음', '잠깐 났다가 내려감'] },
  { id: 'f_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['오한·떨림', '인후통', '기침', '두통', '근육통', '발진', '복통', '소변 시 통증', '해당 없음'] },
  { id: 'f_recent_event', text: '최근 해외 여행이나 단체 활동이 있었나요?', inputType: 'choice',
    options: ['해외 여행 (3주 이내)', '단체 모임·여행', '없음'] },
];

const MUSCULO: QStep[] = [
  { id: 'm_location', text: '어느 부위가 가장 불편한가요?', inputType: 'choice',
    options: ['목', '어깨', '허리', '무릎', '발목·발', '손목·손', '엉덩이', '척추 전체'],
    allowOther: true },
  { id: 'm_event', text: '다친 일이 있었나요?', inputType: 'choice',
    options: ['최근 다침 (낙상·사고 등)', '운동하다 무리', '물건 들다 삐끗', '특별한 일 없이 시작'] },
  { id: 'm_movement', text: '움직일 때 통증이 어떻게 변하나요?', inputType: 'choice',
    options: ['움직이면 더 아픔', '가만히 있어도 아픔', '특정 자세에서만 아픔', '아침에 더 뻣뻣하고 아픔'] },
  { id: 'm_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['붓기', '멍·피멍', '저림·감각 이상', '힘이 안 들어감', '발열', '해당 없음'] },
];

const GI: QStep[] = [
  { id: 'gi_main', text: '가장 심한 증상은?', inputType: 'choice',
    options: ['메스꺼움', '구토', '설사', '변비', '복부 팽만', '속쓰림'] },
  { id: 'gi_freq', text: '하루에 몇 번 정도 있나요?', inputType: 'choice',
    options: ['1~2번', '3~5번', '6~10번', '10번 이상'] },
  { id: 'gi_blood', text: '구토물이나 변에 피가 보였나요?', inputType: 'choice',
    options: ['예 (붉은색)', '예 (검은색)', '아니오', '확인 못함'] },
  { id: 'gi_food', text: '최근 새로운 음식·약·물(생수 등)을 드셨나요?', inputType: 'text',
    placeholder: '예) 어제 저녁에 회를 먹었어요' },
];

const SKIN: QStep[] = [
  { id: 'sk_location', text: '어느 부위에 발진·증상이 있나요?', inputType: 'choice',
    options: ['얼굴', '몸통', '팔', '다리', '손·발', '전신'],
    allowOther: true },
  { id: 'sk_appearance', text: '발진의 모양은?', inputType: 'choice',
    options: ['붉은 반점', '두드러기 (부어오름)', '물집·수포', '진물·딱지', '가려움만 있음'],
    allowOther: true },
  { id: 'sk_trigger', text: '의심되는 원인이 있나요?', inputType: 'choice',
    options: ['새 음식', '새 약', '화장품·세제', '벌레 물림', '햇빛', '잘 모름'],
    allowOther: true },
  { id: 'sk_systemic', text: '발열·호흡곤란·입술 부음 같은 전신 증상이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['발열', '입술·얼굴 부음', '호흡 곤란', '어지러움', '해당 없음'] },
];

const URO: QStep[] = [
  { id: 'u_main', text: '주된 증상은?', inputType: 'choice',
    options: ['소변 시 통증', '소변 자주 마려움', '소변 색 변화', '혈뇨', '아랫배 통증', '생식기 가려움·발진'],
    allowOther: true },
  { id: 'u_freq', text: '소변 횟수가 평소보다 어떤가요?', inputType: 'choice',
    options: ['훨씬 자주', '평소보다 적음', '비슷함'] },
  { id: 'u_color', text: '소변 색깔은 어떤가요?', inputType: 'choice',
    options: ['평소대로 (옅은 노랑)', '진한 노랑·갈색', '붉은빛 (혈뇨 의심)', '탁함'] },
  { id: 'u_associated', text: '아래 증상이 같이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['발열', '오한', '옆구리 통증', '구토', '해당 없음'] },
];

const GENERAL: QStep[] = [
  { id: 'g_location', text: '아픈 부위를 알려주세요.', inputType: 'text',
    placeholder: '예) 왼쪽 옆구리' },
  { id: 'g_aggravating', text: '어떤 상황에서 더 심해지나요? (모두 선택)', inputType: 'multi-choice',
    options: ['움직일 때', '가만히 있을 때', '눌렀을 때', '특정 자세', '식사 후', '잘 모르겠음'] },
  { id: 'g_relieving', text: '어떻게 하면 좋아지나요?', inputType: 'multi-choice',
    options: ['쉬면 나아짐', '약을 먹으면 나아짐', '특정 자세에서 나아짐', '아무것도 도움 안 됨'],
    allowOther: true },
];

// ── 마무리 (모든 환자 공통) ───────────────────────────────

const COMMON_END: QStep[] = [
  { id: 'chronic_conditions', text: '현재 진단받아 관리 중인 질환이 있나요? (모두 선택)', inputType: 'multi-choice',
    options: ['고혈압', '당뇨', '고지혈증', '심장 질환', '뇌혈관 질환', '신장 질환', '간 질환', '갑상선 질환', '암', '천식·COPD', '없음'],
    allowOther: true },
  { id: 'medications', text: '현재 복용 중이거나 최근 시작·중단한 약이 있나요? 영양제·한약 포함해서 적어주세요.', inputType: 'text',
    placeholder: '예) 혈압약 매일, 일주일 전부터 진통제 복용 중' },
  { id: 'allergies', text: '약물·음식 알레르기가 있나요?', inputType: 'choice',
    options: ['있음 (다음 답변에 적기)', '없음'] },
  { id: 'questions_for_doctor', text: '의사 선생님께 꼭 묻고 싶은 점이 있다면 알려주세요. (없으면 비워두셔도 됩니다)', inputType: 'text',
    placeholder: '예) 회사 다니면서 회복할 수 있을지 궁금해요' },
];

// ── 분기 매핑 ─────────────────────────────────────────────

const CATEGORY_TO_FLOW: Record<string, string> = {
  '머리가 아파요 (두통)': 'headache',
  '가슴이 아프거나 답답해요': 'chest',
  '배가 아파요': 'abdominal',
  '기침 / 숨쉬기 불편': 'respiratory',
  '어지러워요': 'dizziness',
  '열이 나요': 'fever',
  '허리·관절·근육이 아파요': 'musculo',
  '메스꺼움·구토·설사': 'gi',
  '피부 발진·가려움': 'skin',
  '소변·생식기 문제': 'uro',
};

const BRANCH_MAP: Record<string, QStep[]> = {
  headache: HEADACHE, chest: CHEST, abdominal: ABDOMINAL, respiratory: RESPIRATORY,
  dizziness: DIZZINESS, fever: FEVER, musculo: MUSCULO, gi: GI, skin: SKIN, uro: URO,
  general: GENERAL,
};

export function getFlowKey(collected: Record<string, unknown>): string {
  const cat = collected['chief_complaint_category'];
  if (typeof cat === 'string') {
    if (CATEGORY_TO_FLOW[cat]) return CATEGORY_TO_FLOW[cat];
    if (cat.startsWith('기타')) return 'general';
  }
  return 'general';
}

export function buildFlow(collected: Record<string, unknown>): QStep[] {
  const branch = BRANCH_MAP[getFlowKey(collected)] ?? GENERAL;
  return [...UNIVERSAL_INTRO, ...branch, ...COMMON_END];
}

export function getStep(index: number, collected: Record<string, unknown>): QStep | null {
  return buildFlow(collected)[index] ?? null;
}

export function totalSteps(collected: Record<string, unknown>): number {
  return buildFlow(collected).length;
}

export function withOtherOption(step: QStep): QStep {
  if (!step.allowOther || !step.options) return step;
  return { ...step, options: [...step.options, OTHER_LABEL] };
}

// ── TSV 빌더 ──────────────────────────────────────────────

export function answersToTsv(answers: QAnswer[], flowKey: string): string {
  const meta = `# yejin-questionnaire v1\t# flow=${flowKey}\t# generated=${new Date().toISOString()}`;
  const header = ['questionId', 'questionText', 'inputType', 'value', 'other'].join('\t');
  const safe = (s: string) => (s ?? '').replace(/[\t\n\r]/g, ' ').trim();
  const rows = answers.map((a) =>
    [a.questionId, safe(a.questionText), a.inputType, safe(a.displayValue), safe(a.otherText ?? '')].join('\t')
  );
  return [meta, header, ...rows].join('\n');
}

// ── 즉시 응급 신호 (클라이언트 사이드 사전 경고용) ──────

const RED_FLAG_RULES: Array<{ when: (c: Record<string, unknown>) => boolean; reason: string }> = [
  // 두통
  { when: (c) => c['h_thunder'] === '예', reason: '갑작스런 천둥 두통 — 뇌출혈 의심' },
  { when: (c) => Array.isArray(c['h_associated']) && (c['h_associated'] as string[]).some((s) => ['한쪽 팔다리 힘 빠짐', '말이 어눌해짐', '의식이 흐려짐'].includes(s)),
    reason: '뇌졸중 의심 신경학적 신호' },
  // 가슴
  { when: (c) => c['chief_complaint_category'] === '가슴이 아프거나 답답해요'
      && Array.isArray(c['c_associated']) && (c['c_associated'] as string[]).some((s) => ['식은땀', '실신·어지러움', '왼팔 저림'].includes(s)),
    reason: '심근경색 의심 동반 증상' },
  // 호흡
  { when: (c) => c['r_dyspnea'] === '쉴 때도 숨이 참', reason: '안정 시에도 호흡곤란' },
  // 위장
  { when: (c) => c['gi_blood'] === '예 (검은색)' || c['gi_blood'] === '예 (붉은색)',
    reason: '위장관 출혈 의심' },
  // 발열
  { when: (c) => c['chief_complaint_category'] === '머리가 아파요 (두통)'
      && Array.isArray(c['h_associated']) && (c['h_associated'] as string[]).includes('목이 뻣뻣함')
      && (c['h_associated'] as string[]).includes('발열'),
    reason: '뇌막염 의심 (발열+경부강직)' },
  // 통증 강도
  { when: (c) => typeof c['pain_scale'] === 'number' && (c['pain_scale'] as number) >= 9,
    reason: '극심한 통증 (NRS 9 이상)' },
];

export function checkImmediateRedFlag(collected: Record<string, unknown>): { level: 'EMERGENCY'; reason: string } | null {
  for (const rule of RED_FLAG_RULES) {
    try {
      if (rule.when(collected)) return { level: 'EMERGENCY', reason: rule.reason };
    } catch { /* skip */ }
  }
  return null;
}
