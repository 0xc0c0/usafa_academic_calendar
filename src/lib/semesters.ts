import fall2026 from '../../config/fall-2026.json';
import spring2027 from '../../config/spring-2027.json';
import { validateSemesterConfig } from './config.ts';
import type { SemesterConfig } from './types.ts';

/**
 * All published semesters, validated at module load so a malformed config
 * fails the build/tests, never production. Add a semester by dropping a new
 * config JSON in config/ and importing it here.
 */
export const SEMESTERS: SemesterConfig[] = [
  validateSemesterConfig(fall2026),
  validateSemesterConfig(spring2027),
];

export function getSemester(id: string): SemesterConfig | undefined {
  return SEMESTERS.find((s) => s.id === id);
}
