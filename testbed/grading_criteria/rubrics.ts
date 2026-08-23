import { GradingCriteria } from '../types.js';

export const GRADING_RUBRICS: Record<string, GradingCriteria> = {
  solar_shed_wbs: {
    requiredHeadings: ['Foundation', 'Framing', 'Electrical', 'Commissioning'],
    requiredKeywords: ['pier', 'framing', 'inverter', 'battery', 'ground'],
    minWordCount: 150
  },
  deployable_shelter_conops: {
    requiredHeadings: ['Executive Summary', 'Operational Environment', 'Operational Modes', 'Interfaces'],
    requiredKeywords: ['deployable', 'temperature', 'crew', 'envelope'],
    minWordCount: 150
  },
  tractor_ev_rtm: {
    requiredHeadings: ['Requirements Traceability'],
    requiredKeywords: ['Req ID', 'Method', 'Tooling', 'Threshold', 'Requirement 1.a'],
    minWordCount: 80
  }
};
