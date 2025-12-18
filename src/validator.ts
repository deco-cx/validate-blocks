import { TypeSchema } from "./ts-parser.ts";

export interface ValidationError {
  path: string;
  message: string;
  severity?: "error" | "warning";
}

/**
 * Valida um valor contra um schema TypeScript
 */
export function validateValue(
  value: any,
  schema: TypeSchema,
  path: string,
  ignoreUnusedProps = false,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Se o valor é undefined e o schema não é opcional, erro
  if (value === undefined) {
    if (!schema.optional) {
      errors.push({
        path,
        message: "propriedade obrigatória ausente",
        severity: "error",
      });
    }
    return errors;
  }

  // Se o schema aceita qualquer coisa, ok
  if (schema.kind === "any") {
    return errors;
  }

  // Valida primitivos
  if (schema.kind === "primitive") {
    return validatePrimitive(value, schema, path);
  }

  // Valida arrays
  if (schema.kind === "array") {
    return validateArray(value, schema, path, ignoreUnusedProps);
  }

  // Valida objetos
  if (schema.kind === "object") {
    return validateObject(value, schema, path, ignoreUnusedProps);
  }

  // Valida unions
  if (schema.kind === "union") {
    return validateUnion(value, schema, path, ignoreUnusedProps);
  }

  // Valida tipos especiais
  if (schema.kind === "special") {
    return validateSpecialType(value, schema, path);
  }

  return errors;
}

/**
 * Valida tipos primitivos
 */
function validatePrimitive(
  value: any,
  schema: TypeSchema,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const actualType = value === null ? "null" : typeof value;

  if (schema.type === "string" && typeof value !== "string") {
    errors.push({
      path,
      message: `esperado string, recebido ${actualType}`,
      severity: "error",
    });
  } else if (schema.type === "number" && typeof value !== "number") {
    errors.push({
      path,
      message: `esperado number, recebido ${actualType}`,
      severity: "error",
    });
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push({
      path,
      message: `esperado boolean, recebido ${actualType}`,
      severity: "error",
    });
  } else if (schema.type === "null" && value !== null) {
    errors.push({
      path,
      message: `esperado null, recebido ${actualType}`,
      severity: "error",
    });
  }

  return errors;
}

/**
 * Valida arrays
 */
function validateArray(
  value: any,
  schema: TypeSchema,
  path: string,
  ignoreUnusedProps: boolean,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Se recebeu um objeto com __resolveType, é uma referência válida a um loader
  // que deve retornar um array
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "__resolveType" in value
  ) {
    // Aceita como referência válida (o loader referenciado será validado separadamente)
    return errors;
  }

  if (!Array.isArray(value)) {
    errors.push({
      path,
      message: `esperado array, recebido ${typeof value}`,
      severity: "error",
    });
    return errors;
  }

  // Valida cada elemento do array
  if (schema.elementType) {
    value.forEach((item, index) => {
      const itemErrors = validateValue(
        item,
        schema.elementType!,
        `${path}[${index}]`,
        ignoreUnusedProps,
      );
      errors.push(...itemErrors);
    });
  }

  return errors;
}

/**
 * Valida objetos
 */
function validateObject(
  value: any,
  schema: TypeSchema,
  path: string,
  ignoreUnusedProps: boolean,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({
      path,
      message: `esperado object, recebido ${
        Array.isArray(value) ? "array" : typeof value
      }`,
      severity: "error",
    });
    return errors;
  }

  // Valida cada propriedade esperada
  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propPath = path ? `${path}.${propName}` : propName;
      const propValue = value[propName];

      const propErrors = validateValue(
        propValue,
        propSchema,
        propPath,
        ignoreUnusedProps,
      );
      errors.push(...propErrors);
    }

    // Verifica propriedades extras (não definidas no schema) - apenas se não estiver ignorando
    if (!ignoreUnusedProps) {
      for (const key of Object.keys(value)) {
        // Ignora propriedades especiais do sistema
        if (key.startsWith("__")) {
          continue;
        }

        // Se a propriedade não existe no schema, é um warning
        if (!(key in schema.properties)) {
          const propPath = path ? `${path}.${key}` : key;
          errors.push({
            path: propPath,
            message: "propriedade não definida na tipagem (pode ser removida)",
            severity: "warning",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Valida union types
 */
function validateUnion(
  value: any,
  schema: TypeSchema,
  path: string,
  ignoreUnusedProps: boolean,
): ValidationError[] {
  if (!schema.unionTypes || schema.unionTypes.length === 0) {
    return [];
  }

  // Tenta validar contra cada tipo da união
  // Se pelo menos um tipo for válido, ok
  for (const unionType of schema.unionTypes) {
    const errors = validateValue(value, unionType, path, ignoreUnusedProps);
    if (errors.length === 0) {
      return []; // Válido para este tipo da união
    }
  }

  // Se nenhum tipo da união foi válido, retorna erro
  const unionTypeNames = schema.unionTypes
    .map((t) => {
      if (t.kind === "primitive") return t.type;
      if (t.kind === "special") return t.specialType;
      return t.kind;
    })
    .join(" | ");

  return [
    {
      path,
      message:
        `valor não corresponde a nenhum tipo da união (${unionTypeNames})`,
      severity: "error",
    },
  ];
}

/**
 * Valida tipos especiais (ImageWidget, Product, etc)
 */
function validateSpecialType(
  value: any,
  schema: TypeSchema,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  switch (schema.specialType) {
    case "ImageWidget":
    case "RichText":
    case "Color":
    case "DateWidget":
    case "DateTimeWidget":
      // Todos esses são validados como strings
      if (typeof value !== "string") {
        errors.push({
          path,
          message:
            `esperado ${schema.specialType} (string), recebido ${typeof value}`,
          severity: "error",
        });
      }
      break;

    case "Product":
      // Valida estrutura básica de Product
      if (typeof value !== "object" || value === null) {
        errors.push({
          path,
          message: `esperado Product (object), recebido ${typeof value}`,
          severity: "error",
        });
      } else {
        // Valida campos obrigatórios básicos
        if (!value.productID && !value.sku) {
          errors.push({
            path: `${path}.productID`,
            message: "Product deve ter productID ou sku",
            severity: "error",
          });
        }
      }
      break;

    case "ProductListingPage":
      // Valida estrutura básica
      if (typeof value !== "object" || value === null) {
        errors.push({
          path,
          message:
            `esperado ProductListingPage (object), recebido ${typeof value}`,
          severity: "error",
        });
      } else {
        // Valida que tem produtos
        if (!Array.isArray(value.products)) {
          errors.push({
            path: `${path}.products`,
            message: "ProductListingPage deve ter array products",
            severity: "error",
          });
        }
      }
      break;

    case "ProductDetailsPage":
      // Valida estrutura básica
      if (typeof value !== "object" || value === null) {
        errors.push({
          path,
          message:
            `esperado ProductDetailsPage (object), recebido ${typeof value}`,
          severity: "error",
        });
      } else {
        // Valida que tem product
        if (!value.product) {
          errors.push({
            path: `${path}.product`,
            message: "ProductDetailsPage deve ter product",
            severity: "error",
          });
        }
      }
      break;

    default:
      // Tipo especial desconhecido, aceita qualquer coisa
      break;
  }

  return errors;
}
