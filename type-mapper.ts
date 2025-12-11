import { join, relative } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * Mapeia __resolveType para o caminho absoluto do arquivo
 */
export function resolveTypeToFile(
  resolveType: string,
  projectRoot: string,
): string {
  // Remove prefixo "site/" se existir
  const cleanPath = resolveType.replace(/^site\//, "");

  // Converte para caminho absoluto
  const absolutePath = join(projectRoot, cleanPath);

  return absolutePath;
}

/**
 * Converte caminho de arquivo para __resolveType
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
 * Verifica se o resolveType é uma section
 */
export function isSection(resolveType: string): boolean {
  return resolveType.includes("/sections/");
}

/**
 * Verifica se o resolveType é um loader
 */
export function isLoader(resolveType: string): boolean {
  return resolveType.includes("/loaders/");
}

/**
 * Extrai o nome do arquivo do resolveType
 */
export function getFileName(resolveType: string): string {
  const parts = resolveType.split("/");
  return parts[parts.length - 1].replace(/\.(tsx?|jsx?)$/, "");
}
