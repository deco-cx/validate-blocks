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

export async function validateProps(
  jsonProps: Record<string, unknown>,
  expectedProps: Property[],
  sectionContent: string,
  sectionFile?: string,
  path: string = "",
): Promise<string[]> {
  const errors: string[] = [];
  const expectedPropsMap = new Map(
    expectedProps.map((p) => [p.name, p]),
  );

  for (const prop of expectedProps) {
    if (!prop.optional && !(prop.name in jsonProps)) {
      const errorPath = path ? `${path}.${prop.name}` : prop.name;
      errors.push(
        `Missing required property: "${errorPath}" (type: ${prop.type})`,
      );
    }
  }

  for (const propName of Object.keys(jsonProps)) {
    const expectedProp = expectedPropsMap.get(propName);
    const jsonValue = jsonProps[propName];
    const errorPath = path ? `${path}.${propName}` : propName;

    if (!expectedProp) {
      errors.push(`Unexpected property: "${errorPath}"`);
      continue;
    }

    if (isNumericIndex(propName) && expectedProp.type.includes("[]")) {
      continue;
    }

    if (
      !isPrimitiveType(expectedProp.type) &&
      typeof jsonValue === "object" &&
      jsonValue !== null &&
      !Array.isArray(jsonValue)
    ) {
      const nestedProps = await resolveType(
        sectionContent,
        expectedProp.type,
        sectionFile,
      );

      if (nestedProps && nestedProps.length > 0) {
        const nestedErrors = await validateProps(
          jsonValue as Record<string, unknown>,
          nestedProps,
          sectionContent,
          sectionFile,
          errorPath,
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
      );

      if (validationErrors.length > 0) {
        errors.push({
          file: filePath,
          sectionPath: section.path.join("."),
          resolveType: section.resolveType,
          errors: validationErrors,
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
