import { Question } from '../types/index';

export const QUESTIONS: Question[] = [
  {
    id: 'chief_complaint',
    step: 0,
    text: '안녕하세요! 저는 예진이예요. 오늘 가장 불편하신 증상을 말씀해 주세요.',
    type: 'text',
    placeholder: '예: 두통, 복통, 어지럼증, 기침 등',
  },
  {
    id: 'onset',
    step: 1,
    text: '그 증상이 언제부터 시작됐나요?',
    type: 'choice',
    options: [
      '오늘 갑자기 시작됐어요',
      '2~3일 전부터요',
      '1주일 정도 됐어요',
      '1개월 이상 됐어요',
    ],
  },
  {
    id: 'pain_scale',
    step: 2,
    text: '지금 불편함의 정도를 0~10 사이로 표현한다면?',
    type: 'slider',
    min: 0,
    max: 10,
  },
  {
    id: 'associated_symptoms',
    step: 3,
    text: '아래 중 함께 나타나는 증상이 있나요? (해당하는 것 모두 선택)',
    type: 'multi-choice',
    options: [
      '발열 / 오한',
      '구역질 / 구토',
      '어지럼증',
      '호흡 곤란',
      '가슴 두근거림',
      '의식 흐림 / 혼란',
      '팔다리 저림 / 마비',
      '해당 없음',
    ],
  },
  {
    id: 'previous_history',
    step: 4,
    text: '이런 증상이 전에도 있었나요?',
    type: 'choice',
    options: [
      '처음이에요',
      '가끔 있었는데 이번이 유독 심해요',
      '자주 반복되는 증상이에요',
      '이전에 같은 이유로 병원 간 적 있어요',
    ],
  },
  {
    id: 'medication_changes',
    step: 5,
    text: '최근에 새로 시작하거나 바꾼 약이 있나요?',
    type: 'choice',
    options: [
      '없어요',
      '새로 시작한 약이 있어요',
      '기존 약을 끊었어요',
      '용량이 바뀌었어요',
    ],
  },
  {
    id: 'questions_for_doctor',
    step: 6,
    text: '의사 선생님께 꼭 여쭤보고 싶은 것을 적어주세요. (최대 3가지)',
    type: 'text',
    placeholder: '예: 이게 암일 수도 있나요? / 약을 꼭 먹어야 하나요?',
  },
];

export function getQuestion(step: number): Question | null {
  return QUESTIONS.find((q) => q.step === step) ?? null;
}

export const TOTAL_STEPS = QUESTIONS.length;
