import { join, relative } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * Maps __resolveType to the absolute file path
 */
export function resolveTypeToFile(
  resolveType: string,
  projectRoot: string,
): string {
  // Remove "site/" prefix if present
  const cleanPath = resolveType.replace(/^site\//, "");

  // Convert to absolute path
  const absolutePath = join(projectRoot, cleanPath);

  return absolutePath;
}

/**
 * Converts file path to __resolveType
 * Ex: /Users/.../sections/Header/Header.tsx -> site/sections/Header/Header.tsx
 */
export function filePathToResolveType(
  filePath: string,
  projectRoot: string,
): string {
  const relativePath = relative(projectRoot, filePath);
  return `site/${relativePath}`;
}

/**
 * Checks if the resolveType is a section
 */
export function isSection(resolveType: string): boolean {
  return resolveType.includes("/sections/");
}

/**
 * Checks if the resolveType is a loader
 */
export function isLoader(resolveType: string): boolean {
  return resolveType.includes("/loaders/");
}

/**
 * Checks if the resolveType is an action
 */
export function isAction(resolveType: string): boolean {
  return resolveType.includes("/actions/");
}

/**
 * Extracts the file name from the resolveType
 */
export function getFileName(resolveType: string): string {
  const parts = resolveType.split("/");
  return parts[parts.length - 1].replace(/\.(tsx?|jsx?)$/, "");
}
