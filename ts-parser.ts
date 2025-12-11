import ts from "npm:typescript@5.3.3";
import { dirname, join } from "https://deno.land/std@0.208.0/path/mod.ts";

export interface TypeSchema {
  kind: "primitive" | "array" | "object" | "union" | "any" | "special";
  type?: string; // Para primitivos: "string", "number", "boolean", "null"
  optional?: boolean;
  elementType?: TypeSchema; // Para arrays
  properties?: Record<string, TypeSchema>; // Para objetos
  unionTypes?: TypeSchema[]; // Para unions
  specialType?: string; // Para tipos especiais: "ImageWidget", "Product", etc
}

// Set para rastrear tipos sendo processados (evita recursão infinita)
const processingTypes = new Set<string>();

/**
 * Extrai a interface Props de um arquivo TypeScript
 */
export async function extractPropsInterface(
  filePath: string,
): Promise<TypeSchema | null> {
  try {
    // Limpa o set de tipos sendo processados
    processingTypes.clear();

    const sourceCode = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true,
    );

    // Verifica se é um re-export (export { default } from "outro-arquivo")
    const reExportPath = findReExportPath(sourceFile, filePath);
    if (reExportPath) {
      return await extractPropsInterface(reExportPath);
    }

    // Primeiro, tenta encontrar o export default e extrair o tipo dos parâmetros
    const defaultExportType = findDefaultExportParamType(sourceFile, filePath);
    if (defaultExportType) {
      return defaultExportType;
    }

    // Fallback: procura por interface/type chamada Props
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
    console.error(`Erro ao processar ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Detecta se o arquivo é um re-export e retorna o caminho do arquivo de origem
 */
function findReExportPath(
  sourceFile: ts.SourceFile,
  currentFilePath: string,
): string | null {
  let reExportPath: string | null = null;

  function visit(node: ts.Node) {
    // Detecta: export { default } from "./caminho"
    // ou: export { default, loader } from "./caminho"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const hasDefaultExport = node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.some((el) => el.name.text === "default");

      if (hasDefaultExport && ts.isStringLiteral(node.moduleSpecifier)) {
        const importPath = node.moduleSpecifier.text;
        reExportPath = resolveImportPath(importPath, currentFilePath);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return reExportPath;
}

/**
 * Resolve um caminho de import relativo para caminho absoluto
 */
function resolveImportPath(
  importPath: string,
  currentFilePath: string,
): string {
  const currentDir = dirname(currentFilePath);
  const resolvedPath = join(currentDir, importPath);

  // Adiciona extensões se não tiver
  const extensions = [".tsx", ".ts", ".jsx", ".js"];

  try {
    Deno.statSync(resolvedPath);
    return resolvedPath;
  } catch {
    // Tenta adicionar extensões
    for (const ext of extensions) {
      try {
        const pathWithExt = resolvedPath + ext;
        Deno.statSync(pathWithExt);
        return pathWithExt;
      } catch {
        // Continua tentando
      }
    }
  }

  return resolvedPath;
}

/**
 * Encontra o export default e extrai o tipo dos parâmetros
 */
function findDefaultExportParamType(
  sourceFile: ts.SourceFile,
  filePath: string,
): TypeSchema | null {
  let defaultExport: ts.Node | null = null;

  // Procura pelo export default
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

    // export default Component (referência a uma função)
    if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      ts.isIdentifier(node.expression)
    ) {
      const exportedName = node.expression.text;
      // Busca a função/const exportada
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

  // Extrai o tipo do primeiro parâmetro
  return extractFirstParamType(defaultExport, sourceFile, filePath);
}

/**
 * Encontra uma declaração (função, const, etc) por nome
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
 * Extrai o tipo do primeiro parâmetro de uma função/componente
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

  // Variable declaration com arrow function ou function expression
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
 * Constrói o schema de validação a partir da interface
 */
function buildValidationSchema(
  interfaceDecl: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
): TypeSchema {
  const properties: Record<string, TypeSchema> = {};

  // Processa herança (extends)
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

  // Processa membros da interface
  for (const member of interfaceDecl.members) {
    if (ts.isPropertySignature(member) && member.name) {
      // Verifica se a propriedade tem @ignore nos comentários JSDoc
      const jsDocTags = ts.getJSDocTags(member);
      const hasIgnore = jsDocTags.some((tag) => tag.tagName.text === "ignore");

      if (hasIgnore) {
        continue; // Pula propriedades marcadas com @ignore
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
 * Resolve um nó de tipo TypeScript para um TypeSchema
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

  // Proteção contra recursão infinita
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

      // Tipos especiais conhecidos
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

      // Tenta resolver a referência
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
        // Preserva o optional da propriedade pai
        schema.optional = optional;
        return schema;
      }

      // Tenta resolver type alias
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

      // Se não conseguir resolver, trata como any
      return { kind: "any", optional };
    }

    // Type literal (objeto inline)
    if (ts.isTypeLiteralNode(typeNode)) {
      const properties: Record<string, TypeSchema> = {};
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.name) {
          // Verifica se a propriedade tem @ignore nos comentários JSDoc
          const jsDocTags = ts.getJSDocTags(member);
          const hasIgnore = jsDocTags.some((tag) =>
            tag.tagName.text === "ignore"
          );

          if (hasIgnore) {
            continue; // Pula propriedades marcadas com @ignore
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
 * Resolve uma referência de interface/tipo por nome
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
 * Resolve uma referência de interface a partir de uma expressão
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
 * Resolve um type alias por nome
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
 * Resolve o tipo Omit<T, K>
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
 * Resolve o tipo Pick<T, K>
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
 * Resolve o tipo Partial<T>
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
 * Extrai chaves literais de um tipo union de literais
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
