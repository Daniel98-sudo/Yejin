export type RedFlagLevel = 'EMERGENCY' | 'URGENT' | 'WARNING' | 'ROUTINE';

export type QuestionType = 'text' | 'choice' | 'slider' | 'multi-choice';

export interface Question {
  id: string;
  step: number;
  text: string;
  type: QuestionType;
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface Answer {
  questionId: string;
  questionText: string;
  value: string | number | string[];
}

export interface RedFlagResult {
  level: RedFlagLevel;
  reason: string;
  action: string;
}

export interface ConsultationSession {
  sessionId: string;
  answers: Answer[];
  currentStep: number;
  redFlag: RedFlagResult;
  complete: boolean;
}

export interface ReportSection {
  chiefComplaint: string;
  onset: string;
  painScale: number;
  associatedSymptoms: string[];
  previousHistory: string;
  medicationChanges: string;
  questionsForDoctor: string[];
  redFlag: RedFlagResult;
  generatedAt: string;
  algorithmVersion: string;
}

// API 요청/응답 타입
export interface StartSessionResponse {
  sessionId: string;
  firstQuestion: Question;
}

export interface AnswerRequest {
  sessionId: string;
  answers: Answer[];
  currentStep: number;
}

export interface AnswerResponse {
  nextQuestion: Question | null;
  redFlag: RedFlagResult;
  complete: boolean;
}

export interface ReportRequest {
  sessionId: string;
  // 신규 적응형 모드: summary + history 사용
  summary?: ChatSummary;
  history?: { role: 'user' | 'assistant'; content: string }[];
  redFlag?: RedFlagResult;
  // 레거시 호환: 정적 OPQRST 모드
  answers?: Answer[];
}

export interface ChatSummary {
  chiefComplaint?: string;
  onset?: string;
  duration?: string;
  character?: string;
  location?: string;
  radiation?: string;
  aggravating?: string;
  relieving?: string;
  painScale?: number;
  associatedSymptoms?: string[];
  previousSimilar?: string;
  chronicConditions?: string[];
  medications?: string;
  questionsForDoctor?: string[];
  narrativeSummary?: string;
}

export interface ReportResponse {
  report: ReportSection;
}
