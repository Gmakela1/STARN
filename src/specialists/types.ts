export interface SpecialistPackage {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  requiresCritic: boolean;
  criticRubric?: string;
  secretSauceExamples: string[];
  prerequisiteArtifactId?: string;
}
