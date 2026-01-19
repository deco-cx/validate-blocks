import ts from "npm:typescript@5.3.3";
import { dirname, join } from "https://deno.land/std@0.208.0/path/mod.ts";

export interface TypeSchema {
  kind: "primitive" | "array" | "object" | "union" | "any" | "special";
  type?: string; // For primitives: "string", "number", "boolean", "null"
  optional?: boolean;
  elementType?: TypeSchema; // For arrays
  properties?: Record<string, TypeSchema>; // For objects
  unionTypes?: TypeSchema[]; // For unions
  specialType?: string; // For special types: "ImageWidget", "Product", etc
}

// Set to track types being processed (prevents infinite recursion)
const processingTypes = new Set<string>();

// Cache for import maps by projectRoot
const importMapCache = new Map<string, Record<string, string>>();

/**
 * Loads and caches the import map from deno.json
 */
export function loadImportMap(projectRoot: string): Record<string, string> {
  // Return from cache if already loaded
  if (importMapCache.has(projectRoot)) {
    return importMapCache.get(projectRoot)!;
  }

  const denoJsonPath = join(projectRoot, "deno.json");
  try {
    const content = Deno.readTextFileSync(denoJsonPath);
    const config = JSON.parse(content);
    const imports = config.imports || {};
    importMapCache.set(projectRoot, imports);
    return imports;
  } catch {
    // If unable to read, return empty
    importMapCache.set(projectRoot, {});
    return {};
  }
}

/**
 * Clears the import map cache (useful for tests)
 */
export function clearImportMapCache(): void {
  importMapCache.clear();
}

/**
 * Extracts the Props interface from a TypeScript file
 * @param filePath - Absolute path to the file
 * @param projectRoot - Project root (for resolving import map aliases)
 */
export async function extractPropsInterface(
  filePath: string,
  projectRoot?: string,
): Promise<TypeSchema | null> {
  try {
    // Clear the set of types being processed
    processingTypes.clear();

    const sourceCode = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
    );

    // Check if it's a re-export (export { default } from "other-file")
    const reExportPath = findReExportPath(sourceFile, filePath, projectRoot);
    if (reExportPath) {
      return await extractPropsInterface(reExportPath, projectRoot);
    }

    // First, try to find the default export and extract the parameter type
    const defaultExportType = findDefaultExportParamType(sourceFile, filePath);
    if (defaultExportType) {
      return defaultExportType;
    }

    // Fallback: look for interface/type called Props
    let propsInterface: ts.InterfaceDeclaration | null = null;
    let propsType: ts.TypeAliasDeclaration | null = null;

    function visit(node: ts.Node) {
      if (
        ts.isInterfaceDeclaration(node) &&
        node.name.text === "Props"
      ) {
        propsInterface = node;
      }
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === "Props"
      ) {
        propsType = node;
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    if (propsInterface) {
      return buildValidationSchema(propsInterface, sourceFile, filePath);
    }

    if (propsType) {
      const typeAlias: ts.TypeAliasDeclaration = propsType;
      return resolveTypeNode(typeAlias.type, sourceFile, filePath);
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error processing ${filePath}:`, message);
    return null;
  }
}

/**
 * Detects if the file is a re-export and returns the path of the source file
 */
function findReExportPath(
  sourceFile: ts.SourceFile,
  currentFilePath: string,
  projectRoot?: string,
): string | null {
  let reExportPath: string | null = null;

  function visit(node: ts.Node) {
    // Detects: export { default } from "./path"
    // or: export { default, loader } from "./path"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const hasDefaultExport = node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.some((el) => el.name.text === "default");

      if (hasDefaultExport && ts.isStringLiteral(node.moduleSpecifier)) {
        const importPath = node.moduleSpecifier.text;
        reExportPath = resolveImportPath(importPath, currentFilePath, projectRoot);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return reExportPath;
}

/**
 * Resolves an import path to an absolute path
 * Supports:
 * - Relative paths: "./foo", "../bar"
 * - Deno import map aliases: "$store/", "apps/", "site/"
 */
export function resolveImportPath(
  importPath: string,
  currentFilePath: string,
  projectRoot?: string,
): string {
  // Extensions to try when file has no extension
  const extensions = [".tsx", ".ts", ".jsx", ".js"];

  // Helper function to resolve file extension
  const resolveExtension = (path: string): string => {
    try {
      Deno.statSync(path);
      return path;
    } catch {
      // Try adding extensions
      for (const ext of extensions) {
        try {
          const pathWithExt = path + ext;
          Deno.statSync(pathWithExt);
          return pathWithExt;
        } catch {
          // Continue trying
        }
      }
    }
    return path;
  };

  // Check if it's a relative path
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const currentDir = dirname(currentFilePath);
    const resolvedPath = join(currentDir, importPath);
    return resolveExtension(resolvedPath);
  }

  // If we have projectRoot, try to resolve via import map
  if (projectRoot) {
    const importMap = loadImportMap(projectRoot);

    // Sort aliases by descending length to avoid partial matches
    // Ex: "$store/islands/" should be checked before "$store/"
    const sortedAliases = Object.keys(importMap).sort(
      (a, b) => b.length - a.length
    );

    for (const alias of sortedAliases) {
      if (importPath.startsWith(alias)) {
        const target = importMap[alias];
        const relativePart = importPath.slice(alias.length);

        // Only resolve local aliases (starting with "./" or "../")
        // Ignore external URLs (http://, https://, npm:, jsr:, etc)
        if (target.startsWith("./") || target.startsWith("../")) {
          const resolvedTarget = join(projectRoot, target);
          const fullPath = join(resolvedTarget, relativePart);
          return resolveExtension(fullPath);
        }

        // For external URLs, we can't resolve locally
        // Return original path so caller knows it failed
        break;
      }
    }
  }

  // If couldn't resolve as alias and it's not relative,
  // try as relative path to current directory (old fallback)
  const currentDir = dirname(currentFilePath);
  const resolvedPath = join(currentDir, importPath);
  return resolveExtension(resolvedPath);
}

/**
 * Finds the default export and extracts the parameter type
 */
function findDefaultExportParamType(
  sourceFile: ts.SourceFile,
  filePath: string,
): TypeSchema | null {
  let defaultExport: ts.Node | null = null;

  // Look for default export
  function visit(node: ts.Node) {
    // export default function Component(props: Type) {}
    if (
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((m) =>
        m.kind === ts.SyntaxKind.ExportKeyword &&
        node.modifiers?.some((m2) => m2.kind === ts.SyntaxKind.DefaultKeyword)
      )
    ) {
      defaultExport = node;
    }

    // export default Component (reference to a function)
    if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      ts.isIdentifier(node.expression)
    ) {
      const exportedName = node.expression.text;
      // Find the exported function/const
      const declaration = findDeclarationByName(exportedName, sourceFile);
      if (declaration) {
        defaultExport = declaration;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!defaultExport) {
    return null;
  }

  // Extract the type of the first parameter
  return extractFirstParamType(defaultExport, sourceFile, filePath);
}

/**
 * Finds a declaration (function, const, etc) by name
 */
function findDeclarationByName(
  name: string,
  sourceFile: ts.SourceFile,
): ts.Node | null {
  let found: ts.Node | null = null;

  function visit(node: ts.Node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
    }
    if (!found) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return found;
}

/**
 * Extracts the type of the first parameter of a function/component
 */
function extractFirstParamType(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
): TypeSchema | null {
  let parameters: ts.NodeArray<ts.ParameterDeclaration> | undefined;

  // Function declaration
  if (ts.isFunctionDeclaration(node)) {
    parameters = node.parameters;
  }

  // Variable declaration with arrow function or function expression
  if (ts.isVariableDeclaration(node) && node.initializer) {
    if (
      ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer)
    ) {
      parameters = node.initializer.parameters;
    }
  }

  if (!parameters || parameters.length === 0) {
    return null;
  }

  const firstParam = parameters[0];
  if (!firstParam.type) {
    return null;
  }

  return resolveTypeNode(firstParam.type, sourceFile, filePath);
}

/**
 * Builds the validation schema from the interface
 */
function buildValidationSchema(
  interfaceDecl: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
): TypeSchema {
  const properties: Record<string, TypeSchema> = {};

  // Process inheritance (extends)
  if (interfaceDecl.heritageClauses) {
    for (const clause of interfaceDecl.heritageClauses) {
      for (const type of clause.types) {
        const baseInterface = resolveInterfaceReference(
          type.expression,
          sourceFile,
          filePath,
        );
        if (baseInterface) {
          const baseSchema = buildValidationSchema(
            baseInterface,
            sourceFile,
            filePath,
          );
          if (baseSchema.properties) {
            Object.assign(properties, baseSchema.properties);
          }
        }
      }
    }
  }

  // Process interface members
  for (const member of interfaceDecl.members) {
    if (ts.isPropertySignature(member) && member.name) {
      // Check if property has @ignore in JSDoc comments
      const jsDocTags = ts.getJSDocTags(member);
      const hasIgnore = jsDocTags.some((tag) => tag.tagName.text === "ignore");

      if (hasIgnore) {
        continue; // Skip properties marked with @ignore
      }

      const propertyName = member.name.getText(sourceFile);
      const optional = !!member.questionToken;
      const propertySchema = resolveTypeNode(
        member.type,
        sourceFile,
        filePath,
        optional,
      );
      properties[propertyName] = propertySchema;
    }
  }

  return {
    kind: "object",
    properties,
  };
}

/**
 * Resolves a TypeScript type node to a TypeSchema
 */
function resolveTypeNode(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  filePath: string,
  optional = false,
): TypeSchema {
  if (!typeNode) {
    return { kind: "any", optional };
  }

  // Protection against infinite recursion
  const typeKey = typeNode.getText(sourceFile);
  if (processingTypes.has(typeKey)) {
    return { kind: "any", optional };
  }

  processingTypes.add(typeKey);

  try {
    // String, number, boolean, null
    if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
      return { kind: "primitive", type: "string", optional };
    }
    if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
      return { kind: "primitive", type: "number", optional };
    }
    if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
      return { kind: "primitive", type: "boolean", optional };
    }
    if (typeNode.kind === ts.SyntaxKind.NullKeyword) {
      return { kind: "primitive", type: "null", optional };
    }
    if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
      return { kind: "any", optional };
    }

    // Array
    if (ts.isArrayTypeNode(typeNode)) {
      const elementType = resolveTypeNode(
        typeNode.elementType,
        sourceFile,
        filePath,
      );
      return { kind: "array", elementType, optional };
    }

    // Union types
    if (ts.isUnionTypeNode(typeNode)) {
      const unionTypes = typeNode.types.map((t) =>
        resolveTypeNode(t, sourceFile, filePath)
      );
      return { kind: "union", unionTypes, optional };
    }

    // Type reference (interface, type alias, etc)
    if (ts.isTypeReferenceNode(typeNode)) {
      const typeName = typeNode.typeName.getText(sourceFile);

      // Known special types
      const specialTypes = [
        "ImageWidget",
        "RichText",
        "Color",
        "DateWidget",
        "DateTimeWidget",
        "Product",
        "ProductListingPage",
        "ProductDetailsPage",
      ];

      if (specialTypes.includes(typeName)) {
        return { kind: "special", specialType: typeName, optional };
      }

      // Utility types: Omit, Pick, Partial, etc
      if (typeName === "Omit" && typeNode.typeArguments) {
        return resolveOmitType(typeNode, sourceFile, filePath, optional);
      }
      if (typeName === "Pick" && typeNode.typeArguments) {
        return resolvePickType(typeNode, sourceFile, filePath, optional);
      }
      if (typeName === "Partial" && typeNode.typeArguments) {
        return resolvePartialType(typeNode, sourceFile, filePath, optional);
      }

      // Try to resolve the reference
      const referencedInterface = resolveInterfaceByName(
        typeName,
        sourceFile,
        filePath,
      );
      if (referencedInterface) {
        const schema = buildValidationSchema(
          referencedInterface,
          sourceFile,
          filePath,
        );
        // Preserve the optional from parent property
        schema.optional = optional;
        return schema;
      }

      // Try to resolve type alias
      const referencedType = resolveTypeAliasByName(
        typeName,
        sourceFile,
        filePath,
      );
      if (referencedType) {
        return resolveTypeNode(
          referencedType.type,
          sourceFile,
          filePath,
          optional,
        );
      }

      // If unable to resolve, treat as any
      return { kind: "any", optional };
    }

    // Type literal (inline object)
    if (ts.isTypeLiteralNode(typeNode)) {
      const properties: Record<string, TypeSchema> = {};
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.name) {
          // Check if property has @ignore in JSDoc comments
          const jsDocTags = ts.getJSDocTags(member);
          const hasIgnore = jsDocTags.some((tag) =>
            tag.tagName.text === "ignore"
          );

          if (hasIgnore) {
            continue; // Skip properties marked with @ignore
          }

          const propertyName = member.name.getText(sourceFile);
          const propertyOptional = !!member.questionToken;
          properties[propertyName] = resolveTypeNode(
            member.type,
            sourceFile,
            filePath,
            propertyOptional,
          );
        }
      }
      return { kind: "object", properties, optional };
    }

    // Default: any
    return { kind: "any", optional };
  } finally {
    processingTypes.delete(typeKey);
  }
}

/**
 * Resolves an interface/type reference by name
 */
function resolveInterfaceByName(
  typeName: string,
  sourceFile: ts.SourceFile,
  _filePath: string,
): ts.InterfaceDeclaration | null {
  let foundInterface: ts.InterfaceDeclaration | null = null;

  function visit(node: ts.Node) {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text === typeName
    ) {
      foundInterface = node;
    }
    if (!foundInterface) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return foundInterface;
}

/**
 * Resolves an interface reference from an expression
 */
function resolveInterfaceReference(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  filePath: string,
): ts.InterfaceDeclaration | null {
  const typeName = expression.getText(sourceFile);
  return resolveInterfaceByName(typeName, sourceFile, filePath);
}

/**
 * Resolves a type alias by name
 */
function resolveTypeAliasByName(
  typeName: string,
  sourceFile: ts.SourceFile,
  _filePath: string,
): ts.TypeAliasDeclaration | null {
  let foundType: ts.TypeAliasDeclaration | null = null;

  function visit(node: ts.Node) {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === typeName
    ) {
      foundType = node;
    }
    if (!foundType) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return foundType;
}

/**
 * Resolves the Omit<T, K> type
 */
function resolveOmitType(
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  filePath: string,
  optional: boolean,
): TypeSchema {
  if (!typeNode.typeArguments || typeNode.typeArguments.length < 2) {
    return { kind: "any", optional };
  }

  const baseType = resolveTypeNode(
    typeNode.typeArguments[0],
    sourceFile,
    filePath,
  );
  const omittedKeys = extractLiteralKeys(typeNode.typeArguments[1], sourceFile);

  if (baseType.kind === "object" && baseType.properties) {
    const properties = { ...baseType.properties };
    for (const key of omittedKeys) {
      delete properties[key];
    }
    return { kind: "object", properties, optional };
  }

  return baseType;
}

/**
 * Resolves the Pick<T, K> type
 */
function resolvePickType(
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  filePath: string,
  optional: boolean,
): TypeSchema {
  if (!typeNode.typeArguments || typeNode.typeArguments.length < 2) {
    return { kind: "any", optional };
  }

  const baseType = resolveTypeNode(
    typeNode.typeArguments[0],
    sourceFile,
    filePath,
  );
  const pickedKeys = extractLiteralKeys(typeNode.typeArguments[1], sourceFile);

  if (baseType.kind === "object" && baseType.properties) {
    const properties: Record<string, TypeSchema> = {};
    for (const key of pickedKeys) {
      if (baseType.properties[key]) {
        properties[key] = baseType.properties[key];
      }
    }
    return { kind: "object", properties, optional };
  }

  return baseType;
}

/**
 * Resolves the Partial<T> type
 */
function resolvePartialType(
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  filePath: string,
  optional: boolean,
): TypeSchema {
  if (!typeNode.typeArguments || typeNode.typeArguments.length < 1) {
    return { kind: "any", optional };
  }

  const baseType = resolveTypeNode(
    typeNode.typeArguments[0],
    sourceFile,
    filePath,
  );

  if (baseType.kind === "object" && baseType.properties) {
    const properties: Record<string, TypeSchema> = {};
    for (const [key, schema] of Object.entries(baseType.properties)) {
      properties[key] = { ...schema, optional: true };
    }
    return { kind: "object", properties, optional };
  }

  return baseType;
}

/**
 * Extracts literal keys from a union of literal types
 */
function extractLiteralKeys(
  typeNode: ts.TypeNode,
  _sourceFile: ts.SourceFile,
): string[] {
  const keys: string[] = [];

  function visit(node: ts.TypeNode) {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      keys.push(node.literal.text);
    } else if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
    }
  }

  visit(typeNode);
  return keys;
}
