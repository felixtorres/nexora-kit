const SEPARATOR = ':';

export function qualifySkillName(namespace: string, skillName: string): string {
  return `${namespace}${SEPARATOR}${skillName}`;
}

export function parseSkillName(qualifiedName: string): { namespace: string; skillName: string } {
  const idx = qualifiedName.indexOf(SEPARATOR);
  if (idx === -1) {
    return { namespace: '', skillName: qualifiedName };
  }
  return {
    namespace: qualifiedName.slice(0, idx),
    skillName: qualifiedName.slice(idx + 1),
  };
}
