export interface Property {
  name: string;
  type: string;
  optional?: boolean;
}

export interface ValidationError {
  file: string;
  sectionPath: string;
  resolveType: string;
  errors: string[];
}

export interface ValidationResult {
  errors: ValidationError[];
  unresolvedResolveTypes: Array<{
    file: string;
    sectionPath: string;
    resolveType: string;
  }>;
  usedSavedBlocks: Set<string>;
}

export interface SectionInJson {
  resolveType: string;
  props: Record<string, unknown>;
  path: string[];
}
