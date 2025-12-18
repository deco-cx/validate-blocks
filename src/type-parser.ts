import { join } from "jsr:@std/path";
import { Property } from "./types.ts";

export function removeComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inJSDoc = false;

  while (i < text.length) {
    const char = text[i];
    const nextChar = i + 1 < text.length ? text[i + 1] : "";
    const prevChar = i > 0 ? text[i - 1] : "";

    if (!inSingleLineComment && !inMultiLineComment && !inJSDoc) {
      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = true;
        stringChar = char;
        result += char;
        i++;
        continue;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
        result += char;
        i++;
        continue;
      }
    }

    if (inString) {
      result += char;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "/" && !inMultiLineComment && !inJSDoc) {
      inSingleLineComment = true;
      i += 2;
      continue;
    }

    if (inSingleLineComment && char === "\n") {
      inSingleLineComment = false;
      result += char;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      if (i + 2 < text.length && text[i + 2] === "*") {
        inJSDoc = true;
        i += 3;
        continue;
      } else {
        inMultiLineComment = true;
        i += 2;
        continue;
      }
    }

    if ((inMultiLineComment || inJSDoc) && char === "*" && nextChar === "/") {
      inMultiLineComment = false;
      inJSDoc = false;
      i += 2;
      continue;
    }

    if (!inSingleLineComment && !inMultiLineComment && !inJSDoc) {
      result += char;
    }

    i++;
  }

  return result;
}

function cleanType(type: string): string {
  type = type.replace(/\/\*\*[\s\S]*?\*\//g, "");
  type = type.replace(/\/\/.*$/gm, "");
  type = type.replace(/\n\s*\n/g, "\n").trim();
  type = type.split("\n").map((line) => line.trim()).join(" ").trim();
  return type;
}

export function extractObjectLiteralProperties(
  objLiteral: string,
): Property[] {
  const properties: Property[] = [];
  let content = objLiteral.trim();

  if (!content.startsWith("{")) return properties;

  content = removeComments(content);
  content = content.slice(1);
  let depth = 0;
  let endIndex = -1;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : "";

    if (!inString && (char === '"' || char === "'" || char === "`")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== "\\") {
      inString = false;
    } else if (!inString) {
      if (char === "{") depth++;
      else if (char === "}") {
        if (depth === 0) {
          endIndex = i;
          break;
        }
        depth--;
      }
    }
  }

  if (endIndex === -1) return properties;

  content = content.slice(0, endIndex).trim();
  if (!content) return properties;

  let i = 0;
  while (i < content.length) {
    while (i < content.length && /\s/.test(content[i])) i++;
    if (i >= content.length) break;

    let propName = "";
    while (i < content.length && /\w/.test(content[i])) {
      propName += content[i];
      i++;
    }

    if (!propName) {
      i++;
      continue;
    }

    let optional = false;
    while (i < content.length && /\s/.test(content[i])) i++;
    if (i < content.length && content[i] === "?") {
      optional = true;
      i++;
    }

    while (
      i < content.length && (/\s/.test(content[i]) || content[i] === ":")
    ) i++;

    let typeStr = "";
    depth = 0;
    inString = false;
    stringChar = "";

    while (i < content.length) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : "";

      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = true;
        stringChar = char;
        typeStr += char;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
        typeStr += char;
      } else if (!inString) {
        if (char === "{") {
          depth++;
          typeStr += char;
        } else if (char === "}") {
          depth--;
          typeStr += char;
        } else if (char === "," && depth === 0) {
          i++;
          break;
        } else if (char === ";" && depth === 0) {
          i++;
          break;
        } else {
          typeStr += char;
        }
      } else {
        typeStr += char;
      }
      i++;
    }

    if (propName && typeStr) {
      const cleanedType = cleanType(typeStr.trim());
      if (cleanedType) {
        properties.push({
          name: propName,
          type: cleanedType,
          optional,
        });
      }
    }
  }

  return properties;
}

export function findTypeImports(content: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importRegex =
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[2];
    const typeNames = match[1].split(",").map((t) => t.trim());

    for (const typeName of typeNames) {
      const name = typeName.split(/\s+as\s+/)[0].trim();
      imports.set(name, importPath);
    }
  }

  return imports;
}

export async function resolveImportPath(
  importPath: string,
  currentFile: string,
): Promise<string | null> {
  if (importPath.startsWith(".")) {
    const currentDir = currentFile.substring(0, currentFile.lastIndexOf("/"));
    const resolved = join(currentDir, importPath);

    for (const ext of [".ts", ".tsx", ".d.ts"]) {
      try {
        await Deno.stat(resolved + ext);
        return resolved + ext;
      } catch {
        continue;
      }
    }

    try {
      await Deno.stat(resolved);
      return resolved;
    } catch {
      return null;
    }
  }

  return null;
}

export async function findTypeDefinition(
  content: string,
  typeName: string,
  currentFile?: string,
): Promise<Property[] | null> {
  const cleanedContent = removeComments(content);

  const interfaceStartRegex = new RegExp(
    `(?:export\\s+)?interface\\s+${typeName}\\s*\\{`,
    "s",
  );
  const interfaceStartMatch = cleanedContent.match(interfaceStartRegex);
  if (interfaceStartMatch) {
    const startIndex = interfaceStartMatch.index! +
      interfaceStartMatch[0].length;
    let depth = 1;
    let endIndex = startIndex;

    for (let i = startIndex; i < cleanedContent.length; i++) {
      if (cleanedContent[i] === "{") depth++;
      else if (cleanedContent[i] === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (depth === 0) {
      const body = cleanedContent.slice(startIndex, endIndex);
      const props = extractObjectLiteralProperties(`{${body}}`);
      return props;
    }
  }

  const typeStartRegex = new RegExp(
    `(?:export\\s+)?type\\s+${typeName}\\s*=\\s*\\{`,
    "s",
  );
  const typeStartMatch = cleanedContent.match(typeStartRegex);
  if (typeStartMatch) {
    const startIndex = typeStartMatch.index! + typeStartMatch[0].length;
    let depth = 1;
    let endIndex = startIndex;

    for (let i = startIndex; i < cleanedContent.length; i++) {
      if (cleanedContent[i] === "{") depth++;
      else if (cleanedContent[i] === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (depth === 0) {
      const body = cleanedContent.slice(startIndex, endIndex);
      const props = extractObjectLiteralProperties(`{${body}}`);
      return props;
    }
  }

  if (currentFile) {
    const imports = findTypeImports(content);
    const importPath = imports.get(typeName);

    if (importPath) {
      const resolvedPath = await resolveImportPath(importPath, currentFile);
      if (resolvedPath) {
        try {
          const importedContent = await Deno.readTextFile(resolvedPath);
          return await findTypeDefinition(
            importedContent,
            typeName,
            resolvedPath,
          );
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function mergeProperties(
  props1: Property[],
  props2: Property[],
): Property[] {
  const merged = new Map<string, Property>();

  for (const prop of props1) {
    merged.set(prop.name, prop);
  }

  for (const prop of props2) {
    merged.set(prop.name, prop);
  }

  return Array.from(merged.values());
}

export async function resolveType(
  content: string,
  typeExpression: string,
  currentFile?: string,
): Promise<Property[] | null> {
  typeExpression = typeExpression.trim();

  if (typeExpression.startsWith("{")) {
    return extractObjectLiteralProperties(typeExpression);
  }

  if (typeExpression.includes("&")) {
    const parts = typeExpression.split("&").map((p) => p.trim());
    let mergedProps: Property[] = [];

    for (const part of parts) {
      if (part.startsWith("{")) {
        const props = extractObjectLiteralProperties(part);
        mergedProps = mergeProperties(mergedProps, props);
      } else {
        const typeName = part.trim();
        const props = await findTypeDefinition(content, typeName, currentFile);
        if (props) {
          mergedProps = mergeProperties(mergedProps, props);
        }
      }
    }

    return mergedProps.length > 0 ? mergedProps : null;
  }

  return await findTypeDefinition(content, typeExpression, currentFile);
}

export async function getExportDefaultFunctionProps(
  content: string,
  filePath?: string,
): Promise<Property[] | null> {
  if (content.startsWith("export {")) {
    const importPath = content.match(/export { [^}]+ } from "([^"]+)";/)?.[1];
    if (!importPath) {
      return null;
    }

    const path = join(Deno.cwd(), importPath);
    const fileContent = await Deno.readTextFile(path).catch(() => null);
    if (!fileContent) {
      return null;
    }

    return getExportDefaultFunctionProps(fileContent, path);
  }

  const match = content.match(/export default function (\w+)\(([^)]+)\)/);
  if (!match || !match[2]) {
    return null;
  }

  const firstParam = match[2].split(",").map((p) => p.trim())[0];
  const typeMatch = firstParam.match(/:\s*(.+)$/);

  if (!typeMatch) {
    return null;
  }

  const typeExpression = typeMatch[1].trim();
  return await resolveType(content, typeExpression, filePath);
}
