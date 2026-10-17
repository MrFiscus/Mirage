export interface Metric {
  name: string;
  value: string;
  passed: number;
  total: number;
  detail: string;
  failures: string[];
  /** For counts of bad outcomes, where 0 is the goal. */
  lowerIsBetter?: boolean;
}
