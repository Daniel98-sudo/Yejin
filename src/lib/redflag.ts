import { Answer, RedFlagResult } from '../types/index';

interface RedFlagRule {
  level: 'EMERGENCY' | 'URGENT' | 'WARNING';
  symptomKeywords: string[];
  associatedKeywords?: string[];
  reason: string;
  action: string;
}

const RED_FLAG_RULES: RedFlagRule[] = [
  // EMERGENCY
  {
    level: 'EMERGENCY',
    symptomKeywords: ['두통', '머리'],
    associatedKeywords: ['의식 흐림', '팔다리 저림', '마비'],
    reason: '뇌졸중 의심 증상이 감지됐어요',
    action: '지금 바로 119에 전화하거나 응급실로 가세요.',
  },
  {
    level: 'EMERGENCY',
    symptomKeywords: ['가슴', '흉통', '심장'],
    associatedKeywords: ['팔다리 저림', '호흡 곤란', '식은땀'],
    reason: '심근경색(AMI) 의심 증상이 감지됐어요',
    action: '지금 바로 119에 전화하거나 응급실로 가세요.',
  },
  {
    level: 'EMERGENCY',
    symptomKeywords: ['숨', '호흡', '질식'],
    associatedKeywords: ['호흡 곤란'],
    reason: '호흡부전 의심 증상이 감지됐어요',
    action: '지금 바로 119에 전화하거나 응급실로 가세요.',
  },
  {
    level: 'EMERGENCY',
    symptomKeywords: ['의식', '쓰러', '실신'],
    associatedKeywords: ['의식 흐림'],
    reason: '의식 저하 의심 증상이 감지됐어요',
    action: '지금 바로 119에 전화하거나 응급실로 가세요.',
  },
  // URGENT
  {
    level: 'URGENT',
    symptomKeywords: ['복통', '배'],
    associatedKeywords: ['발열', '구역질', '구토'],
    reason: '충수염 등 급성 복증이 의심돼요',
    action: '오늘 중으로 응급실 또는 외과를 방문하세요.',
  },
  {
    level: 'URGENT',
    symptomKeywords: ['청력', '귀', '소리'],
    associatedKeywords: [],
    reason: '갑작스러운 청력 소실이 의심돼요',
    action: '24시간 내 이비인후과를 방문하세요.',
  },
  {
    level: 'URGENT',
    symptomKeywords: ['눈', '시야', '보이지'],
    associatedKeywords: [],
    reason: '갑작스러운 시력 변화가 의심돼요',
    action: '오늘 중으로 안과 또는 응급실을 방문하세요.',
  },
  // WARNING
  {
    level: 'WARNING',
    symptomKeywords: ['기침'],
    associatedKeywords: [],
    reason: '장기 지속 기침으로 정밀 검사가 필요해요',
    action: '1주일 내 내과 또는 호흡기내과를 방문하세요.',
  },
  {
    level: 'WARNING',
    symptomKeywords: ['체중', '살', '빠'],
    associatedKeywords: [],
    reason: '원인 불명 체중 감소로 검사가 필요해요',
    action: '2주 내 내과를 방문하세요.',
  },
];

export function evaluateRedFlag(answers: Answer[]): RedFlagResult {
  const chiefComplaint = String(
    answers.find((a) => a.questionId === 'chief_complaint')?.value ?? ''
  ).toLowerCase();

  const associatedSymptoms = answers.find(
    (a) => a.questionId === 'associated_symptoms'
  )?.value as string[] | undefined;

  const associatedLower = (associatedSymptoms ?? []).map((s) =>
    s.toLowerCase()
  );

  // 통증 강도 10점 → 무조건 URGENT 이상
  const painScale = Number(
    answers.find((a) => a.questionId === 'pain_scale')?.value ?? 0
  );

  for (const rule of RED_FLAG_RULES) {
    const symptomMatch = rule.symptomKeywords.some((kw) =>
      chiefComplaint.includes(kw)
    );
    if (!symptomMatch) continue;

    const associatedMatch =
      !rule.associatedKeywords || rule.associatedKeywords.length === 0
        ? true
        : rule.associatedKeywords.some((kw) =>
            associatedLower.some((s) => s.includes(kw.toLowerCase()))
          );

    if (associatedMatch) {
      return {
        level: rule.level,
        reason: rule.reason,
        action: rule.action,
      };
    }
  }

  if (painScale >= 8) {
    return {
      level: 'URGENT',
      reason: '통증 강도가 매우 높아요 (8점 이상)',
      action: '오늘 중으로 진료를 받으세요.',
    };
  }

  return {
    level: 'ROUTINE',
    reason: '현재 감지된 응급 징후가 없어요',
    action: '일반 외래 진료를 예약하세요.',
  };
}
