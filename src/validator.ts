import {
  blockNameToFileName,
  getSavedBlockContent,
  getSectionContent,
  isSavedBlock,
  resolveTypeToPath,
} from "./block-manager.ts";
import { findSectionsInJson } from "./section-finder.ts";
import { getExportDefaultFunctionProps, resolveType } from "./type-parser.ts";
import { Property, ValidationError, ValidationResult } from "./types.ts";

export function isNumericIndex(propName: string): boolean {
  const num = Number(propName);
  return !isNaN(num) && num >= 0 && num.toString() === propName;
}

export function isLoaderOrAction(resolveType: string): boolean {
  // Pattern: <appname>/loaders/<path> or <appname>/actions/<path>
  const parts = resolveType.split("/");
  if (parts.length < 3) return false;

  const secondPart = parts[1];
  return secondPart === "loaders" || secondPart === "actions";
}

export function isPrimitiveType(type: string): boolean {
  const primitives = [
    "string",
    "number",
    "boolean",
    "null",
    "undefined",
    "void",
    "any",
    "unknown",
  ];
  return primitives.some(
    (p) => type === p || type.startsWith(p + "[]"),
  );
}

function extractArrayElementType(arrayType: string): string | null {
  // Remove union types like "| undefined" or "| null" first
  let cleanedType = arrayType.trim();
  const unionMatch = cleanedType.match(/^(.+?)\s*\|\s*(undefined|null|void)$/);
  if (unionMatch) {
    cleanedType = unionMatch[1].trim();
  }

  // Extract element type from array
  if (cleanedType.endsWith("[]")) {
    return cleanedType.slice(0, -2).trim();
  }
  return null;
}

function isArrayObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;

  const numericKeys = keys.filter((k) => isNumericIndex(k));
  if (numericKeys.length === 0) return false;

  const indices = numericKeys.map((k) => Number(k)).sort((a, b) => a - b);

  // Check if indices are consecutive starting from 0
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) return false;
  }

  return numericKeys.length === keys.length;
}

function convertArrayObjectToArray(obj: Record<string, unknown>): unknown[] {
  const keys = Object.keys(obj)
    .filter((k) => isNumericIndex(k))
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  return keys.map((k) => obj[k.toString()]);
}

function findPropertyLineInJson(
  jsonContent: string,
  propertyPath: string,
): number | undefined {
  try {
    // Split path into parts (e.g., "badges[0].image" -> ["badges", "[0]", "image"])
    const parts = propertyPath.split(/[\.\[\]]+/).filter((p) => p);
    if (parts.length === 0) return undefined;

    // Find the first property in the JSON string
    const firstProp = parts[0];
    const escapedProp = firstProp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Look for the property with quotes and colon
    const regex = new RegExp(`"${escapedProp}"\\s*:`, "g");
    let match;
    let bestMatch: { index: number; line: number } | null = null;

    while ((match = regex.exec(jsonContent)) !== null) {
      // Count lines up to this position
      const line = jsonContent.substring(0, match.index).split("\n").length;
      if (!bestMatch || match.index < bestMatch.index) {
        bestMatch = { index: match.index, line };
      }
    }

    return bestMatch?.line;
  } catch {
    return undefined;
  }
}

export async function validateProps(
  jsonProps: Record<string, unknown>,
  expectedProps: Property[],
  sectionContent: string,
  sectionFile?: string,
  path: string = "",
  jsonContent?: string,
): Promise<Array<{ message: string; line?: number }>> {
  const errors: Array<{ message: string; line?: number }> = [];
  const expectedPropsMap = new Map(
    expectedProps.map((p) => [p.name, p]),
  );

  for (const prop of expectedProps) {
    if (!prop.optional && !(prop.name in jsonProps)) {
      const errorPath = path ? `${path}.${prop.name}` : prop.name;
      const line = jsonContent
        ? findPropertyLineInJson(jsonContent, errorPath)
        : undefined;
      errors.push({
        message:
          `Missing required property: "${errorPath}" (type: ${prop.type})`,
        line,
      });
    }
  }

  for (const propName of Object.keys(jsonProps)) {
    const expectedProp = expectedPropsMap.get(propName);
    const jsonValue = jsonProps[propName];
    const errorPath = path ? `${path}.${propName}` : propName;

    if (!expectedProp) {
      // Skip numeric indices that are part of an array
      if (isNumericIndex(propName)) {
        continue;
      }
      const line = jsonContent
        ? findPropertyLineInJson(jsonContent, errorPath)
        : undefined;
      errors.push({
        message: `Unexpected property: "${errorPath}"`,
        line,
      });
      continue;
    }

    // Handle array types
    // First, clean the type to handle union types like "Badge[] | undefined"
    let cleanedType = expectedProp.type.trim();
    const unionMatch = cleanedType.match(
      /^(.+?)\s*\|\s*(undefined|null|void)$/,
    );
    if (unionMatch) {
      cleanedType = unionMatch[1].trim();
    }

    if (cleanedType.endsWith("[]")) {
      const elementType = extractArrayElementType(cleanedType);
      if (!elementType) continue;

      // Check if the value is an object with __resolveType that is a loader or action
      // If so, skip array validation (loaders/actions return types are not reliable)
      if (
        typeof jsonValue === "object" &&
        jsonValue !== null &&
        !Array.isArray(jsonValue)
      ) {
        const jsonValueRecord = jsonValue as Record<string, unknown>;
        if (
          "__resolveType" in jsonValueRecord &&
          typeof jsonValueRecord.__resolveType === "string"
        ) {
          // Skip validation for loaders and actions
          if (isLoaderOrAction(jsonValueRecord.__resolveType)) {
            continue;
          }
          // Also skip if it's a saved block (they resolve dynamically)
          if (isSavedBlock(jsonValueRecord.__resolveType)) {
            continue;
          }
        }
      }

      let arrayElements: unknown[] = [];

      // Check if it's already an array
      if (Array.isArray(jsonValue)) {
        arrayElements = jsonValue;
      } // Check if it's an object with numeric indices (serialized array)
      else if (
        typeof jsonValue === "object" &&
        jsonValue !== null &&
        !Array.isArray(jsonValue) &&
        isArrayObject(jsonValue as Record<string, unknown>)
      ) {
        arrayElements = convertArrayObjectToArray(
          jsonValue as Record<string, unknown>,
        );
      } // If it's a primitive array type, skip validation
      else if (isPrimitiveType(elementType)) {
        continue;
      } // Otherwise, it's not a valid array
      else {
        const line = jsonContent
          ? findPropertyLineInJson(jsonContent, errorPath)
          : undefined;
        errors.push({
          message:
            `Property "${errorPath}" should be an array (type: ${expectedProp.type})`,
          line,
        });
        continue;
      }

      // Validate each element of the array
      if (!isPrimitiveType(elementType)) {
        // Clean the element type (remove any extra whitespace or union types)
        const cleanedElementType = elementType.trim();

        const elementProps = await resolveType(
          sectionContent,
          cleanedElementType,
          sectionFile,
        );

        if (!elementProps || elementProps.length === 0) {
          // If we can't resolve the type, we can't validate it, but continue
          continue;
        }

        for (let i = 0; i < arrayElements.length; i++) {
          const element = arrayElements[i];
          if (
            typeof element === "object" &&
            element !== null &&
            !Array.isArray(element)
          ) {
            // Skip validation if element has __resolveType that is a loader or action
            const elementRecord = element as Record<string, unknown>;
            if (
              "__resolveType" in elementRecord &&
              typeof elementRecord.__resolveType === "string" &&
              isLoaderOrAction(elementRecord.__resolveType)
            ) {
              continue;
            }

            const elementErrors = await validateProps(
              elementRecord,
              elementProps,
              sectionContent,
              sectionFile,
              `${errorPath}[${i}]`,
              jsonContent,
            );

            errors.push(...elementErrors);
          }
        }
      }
      continue;
    }

    // Skip numeric indices that are part of an array (handled above)
    if (isNumericIndex(propName)) {
      continue;
    }

    if (
      !isPrimitiveType(expectedProp.type) &&
      typeof jsonValue === "object" &&
      jsonValue !== null &&
      !Array.isArray(jsonValue)
    ) {
      const jsonValueRecord = jsonValue as Record<string, unknown>;

      // Skip validation if object has __resolveType that is a loader or action
      if (
        "__resolveType" in jsonValueRecord &&
        typeof jsonValueRecord.__resolveType === "string" &&
        isLoaderOrAction(jsonValueRecord.__resolveType)
      ) {
        continue;
      }

      const nestedProps = await resolveType(
        sectionContent,
        expectedProp.type,
        sectionFile,
      );

      if (nestedProps && nestedProps.length > 0) {
        const nestedErrors = await validateProps(
          jsonValueRecord,
          nestedProps,
          sectionContent,
          sectionFile,
          errorPath,
          jsonContent,
        );
        errors.push(...nestedErrors);
      }
    }
  }

  return errors;
}

export async function validateJsonFile(
  filePath: string,
  jsonContent: string,
  processedBlocks: Set<string> = new Set(),
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const unresolvedResolveTypes: Array<{
    file: string;
    sectionPath: string;
    resolveType: string;
  }> = [];
  const usedSavedBlocks = new Set<string>();

  try {
    const json = JSON.parse(jsonContent);
    const sections = findSectionsInJson(json);

    for (const section of sections) {
      if (isSavedBlock(section.resolveType)) {
        usedSavedBlocks.add(section.resolveType);

        if (processedBlocks.has(section.resolveType)) {
          errors.push({
            file: filePath,
            sectionPath: section.path.join("."),
            resolveType: section.resolveType,
            errors: [`Circular reference detected: ${section.resolveType}`],
          });
          continue;
        }

        const extraProps = Object.keys(section.props);
        if (extraProps.length > 0) {
          errors.push({
            file: filePath,
            sectionPath: section.path.join("."),
            resolveType: section.resolveType,
            errors: [
              `Saved block should not have extra properties. Found: ${
                extraProps.join(", ")
              }`,
            ],
          });
        }

        const blockContent = await getSavedBlockContent(section.resolveType);
        if (!blockContent) {
          errors.push({
            file: filePath,
            sectionPath: section.path.join("."),
            resolveType: section.resolveType,
            errors: [`Saved block not found: ${section.resolveType}`],
          });
          continue;
        }

        const newProcessedBlocks = new Set(processedBlocks);
        newProcessedBlocks.add(section.resolveType);

        const blockResult = await validateJsonFile(
          `.deco/blocks/${blockNameToFileName(section.resolveType)}`,
          blockContent,
          newProcessedBlocks,
        );
        blockResult.usedSavedBlocks.forEach((block) =>
          usedSavedBlocks.add(block)
        );
        unresolvedResolveTypes.push(...blockResult.unresolvedResolveTypes);
        for (const blockError of blockResult.errors) {
          errors.push({
            file: filePath,
            sectionPath: `${
              section.path.join(".")
            } -> ${blockError.sectionPath}`,
            resolveType: blockError.resolveType,
            errors: blockError.errors,
          });
        }
        continue;
      }

      const sectionContent = await getSectionContent(section.resolveType);
      if (!sectionContent) {
        unresolvedResolveTypes.push({
          file: filePath,
          sectionPath: section.path.join("."),
          resolveType: section.resolveType,
        });
        errors.push({
          file: filePath,
          sectionPath: section.path.join("."),
          resolveType: section.resolveType,
          errors: [`Section not found: ${section.resolveType}`],
        });
        continue;
      }

      const sectionPaths = resolveTypeToPath(section.resolveType);
      const sectionFilePath = sectionPaths.length > 0
        ? sectionPaths[0]
        : undefined;

      const expectedProps = await getExportDefaultFunctionProps(
        sectionContent,
        sectionFilePath,
      );

      if (!expectedProps || expectedProps.length === 0) {
        continue;
      }

      const validationErrors = await validateProps(
        section.props,
        expectedProps,
        sectionContent,
        sectionFilePath,
        "",
        jsonContent,
      );

      if (validationErrors.length > 0) {
        // Group errors by line number for better display
        const errorsByLine = new Map<number | undefined, string[]>();
        for (const err of validationErrors) {
          const lineErrors = errorsByLine.get(err.line) || [];
          lineErrors.push(err.message);
          errorsByLine.set(err.line, lineErrors);
        }

        // Create ValidationError with line information
        // Use the first error's line as the representative line
        const firstError = validationErrors[0];
        errors.push({
          file: filePath,
          sectionPath: section.path.join("."),
          resolveType: section.resolveType,
          errors: validationErrors.map((e) => e.message),
          errorLine: firstError.line,
        });
      }
    }
  } catch (e) {
    errors.push({
      file: filePath,
      sectionPath: "",
      resolveType: "",
      errors: [`Error processing JSON: ${e.message}`],
    });
  }

  return {
    errors,
    unresolvedResolveTypes,
    usedSavedBlocks,
  };
}
