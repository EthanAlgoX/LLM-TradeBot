import type { StrategySummary } from '../api/strategyWorkspace';

export function suggestStrategyCopyName(templateName: string, strategies: StrategySummary[]) {
  const existingNames = new Set(strategies.map((strategy) => strategy.name.trim()));
  const baseName = `${templateName.trim()} 副本`;
  if (!existingNames.has(baseName)) return baseName;

  let copyNumber = 2;
  while (existingNames.has(`${baseName} ${copyNumber}`)) copyNumber += 1;
  return `${baseName} ${copyNumber}`;
}
