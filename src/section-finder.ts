import { SectionInJson } from "./types.ts";
import { isAppSection, isSavedBlock } from "./block-manager.ts";

export function shouldIgnore(resolveType: string): boolean {
  if (!isSavedBlock(resolveType) && !isAppSection(resolveType)) {
    return true;
  }
  return false;
}

export function findSectionsInJson(
  obj: unknown,
  path: string[] = [],
): SectionInJson[] {
  const sections: SectionInJson[] = [];

  if (typeof obj !== "object" || obj === null) {
    return sections;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      sections.push(...findSectionsInJson(item, [...path, `[${index}]`]));
    });
    return sections;
  }

  const record = obj as Record<string, unknown>;

  if ("__resolveType" in record && typeof record.__resolveType === "string") {
    const resolveType = record.__resolveType;

    if (shouldIgnore(resolveType)) {
      for (const [key, value] of Object.entries(record)) {
        if (key === "__resolveType") continue;
        const nestedSections = findSectionsInJson(value, [...path, key]);
        sections.push(...nestedSections);
      }
      return sections;
    }

    const { __resolveType, ...props } = record;

    sections.push({
      resolveType,
      props,
      path: [...path],
    });
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "__resolveType") continue;
    sections.push(...findSectionsInJson(value, [...path, key]));
  }

  return sections;
}
