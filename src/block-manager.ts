export function isSavedBlock(resolveType: string): boolean {
  if (resolveType === "resolved") {
    return false;
  }
  if (resolveType.startsWith("site/") || resolveType.startsWith("website/")) {
    return false;
  }
  if (resolveType.endsWith(".tsx") || resolveType.endsWith(".ts")) {
    return false;
  }
  if (resolveType.includes(".") && !resolveType.endsWith(".")) {
    const parts = resolveType.split("/");
    const lastPart = parts[parts.length - 1];
    if (
      lastPart.includes(".") &&
      (lastPart.endsWith(".tsx") || lastPart.endsWith(".ts"))
    ) {
      return false;
    }
  }
  return true;
}

export function isAppSection(resolveType: string): boolean {
  return resolveType.startsWith("site/");
}

export function blockNameToFileName(blockName: string): string {
  return encodeURIComponent(blockName) + ".json";
}

export function fileNameToBlockName(fileName: string): string {
  return decodeURIComponent(fileName);
}

export function resolveTypeToPath(resolveType: string): string[] {
  const paths: string[] = [];

  if (isSavedBlock(resolveType)) {
    const fileName = blockNameToFileName(resolveType);
    paths.push(`.deco/blocks/${fileName}`);
    return paths;
  }

  if (!resolveType.startsWith("site/")) {
    return paths;
  }

  const path = resolveType.replace("site/", "./sections/");
  paths.push(path);
  paths.push(path.replace("./sections/", "./"));

  const pathsWithExtensions: string[] = [];
  for (const p of paths) {
    if (!p.endsWith(".tsx") && !p.endsWith(".ts")) {
      pathsWithExtensions.push(`${p}.tsx`);
      pathsWithExtensions.push(`${p}.ts`);
    } else {
      pathsWithExtensions.push(p);
    }
  }

  return pathsWithExtensions;
}

export async function getSavedBlockContent(
  resolveType: string,
): Promise<string | null> {
  if (!isSavedBlock(resolveType)) {
    return null;
  }

  const fileName = blockNameToFileName(resolveType);
  const blockPath = `.deco/blocks/${fileName}`;

  try {
    const content = await Deno.readTextFile(blockPath);
    return content;
  } catch {
    return null;
  }
}

export async function getSectionContent(
  resolveType: string,
): Promise<string | null> {
  if (isSavedBlock(resolveType)) {
    return null;
  }

  const paths = resolveTypeToPath(resolveType);

  for (const path of paths) {
    try {
      const content = await Deno.readTextFile(path);
      return content;
    } catch {
      continue;
    }
  }

  return null;
}
