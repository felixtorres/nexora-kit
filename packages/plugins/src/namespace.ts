const NAMESPACE_SEPARATOR = ':';
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;

export function qualifyName(namespace: string, toolName: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}${toolName}`;
}

export function parseQualifiedName(qualifiedName: string): { namespace: string; toolName: string } {
  const separatorIndex = qualifiedName.indexOf(NAMESPACE_SEPARATOR);
  if (separatorIndex === -1) {
    throw new Error(`Invalid qualified name '${qualifiedName}': missing namespace separator`);
  }

  const namespace = qualifiedName.slice(0, separatorIndex);
  const toolName = qualifiedName.slice(separatorIndex + 1);

  if (!namespace || !toolName) {
    throw new Error(`Invalid qualified name '${qualifiedName}': empty namespace or tool name`);
  }

  return { namespace, toolName };
}

export function isQualified(name: string): boolean {
  return name.includes(NAMESPACE_SEPARATOR);
}

export function validateNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `Invalid namespace '${namespace}': must start with a lowercase letter and contain only lowercase letters, digits, and hyphens`,
    );
  }
}
