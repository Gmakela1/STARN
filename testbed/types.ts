export interface TestPrompt {
  id: string;
  name: string;
  description: string;
  expectedSpecialist: string;
  userPrompt: string;
  projectContextFiles?: Record<string, string>;
}

export interface GradingCriteria {
  requiredHeadings: string[];
  requiredKeywords: string[];
  minWordCount: number;
}

export interface GradeResult {
  passed: boolean;
  score: number;
  matchedHeadings: string[];
  missingHeadings: string[];
  matchedKeywords: string[];
  missingKeywords: string[];
  wordCount: number;
  feedback: string[];
}

export interface TestExecutionResult {
  testId: string;
  testName: string;
  passed: boolean;
  specialistRouted: string;
  expectedSpecialist: string;
  grade: GradeResult;
  autoRevisionsRun: number;
  error?: string;
}
