import { TypeSchema } from "./ts-parser.ts";

export interface ValidationError {
  path: string;
  message: string;
  severity?: "error" | "warning";
}

/**
 * Validates a value against a TypeScript schema
 */
export function validateValue(
  value: any,
  schema: TypeSchema,
  path: string,
  ignoreUnusedProps = false,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // If value is undefined and schema is not optional, it's an error
  if (value === undefined) {
    if (!schema.optional) {
      errors.push({
        path,
        message: "required property missing",
        severity: "error",
      });
    }
    return errors;
  }

  // If schema accepts anything, it's ok
  if (schema.kind === "any") {
    return errors;
  }

  // Validate primitives
  if (schema.kind === "primitive") {
    return validatePrimitive(value, schema, path);
  }

  // Validate arrays
  if (schema.kind === "array") {
    return validateArray(value, schema, path, ignoreUnusedProps);
  }

  // Validate objects
  if (schema.kind === "object") {
    return validateObject(value, schema, path, ignoreUnusedProps);
  }

  // Validate unions
  if (schema.kind === "union") {
    return validateUnion(value, schema, path, ignoreUnusedProps);
  }

  // Validate special types
  if (schema.kind === "special") {
    return validateSpecialType(value, schema, path);
  }

  return errors;
}

/**
 * Validates primitive types
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
      message: `expected string, got ${actualType}`,
      severity: "error",
    });
  } else if (schema.type === "number" && typeof value !== "number") {
    errors.push({
      path,
      message: `expected number, got ${actualType}`,
      severity: "error",
    });
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push({
      path,
      message: `expected boolean, got ${actualType}`,
      severity: "error",
    });
  } else if (schema.type === "null" && value !== null) {
    errors.push({
      path,
      message: `expected null, got ${actualType}`,
      severity: "error",
    });
  }

  return errors;
}

/**
 * Validates arrays
 */
function validateArray(
  value: any,
  schema: TypeSchema,
  path: string,
  ignoreUnusedProps: boolean,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // If received an object with __resolveType, it's a valid loader reference
  // that should return an array
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "__resolveType" in value
  ) {
    // Accept as valid reference (the referenced loader will be validated separately)
    return errors;
  }

  if (!Array.isArray(value)) {
    errors.push({
      path,
      message: `expected array, got ${typeof value}`,
      severity: "error",
    });
    return errors;
  }

  // Validate each array element
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
 * Validates objects
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
      message: `expected object, got ${
        Array.isArray(value) ? "array" : typeof value
      }`,
      severity: "error",
    });
    return errors;
  }

  // Validate each expected property
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

    // Check for extra properties (not defined in schema) - only if not ignoring
    if (!ignoreUnusedProps) {
      for (const key of Object.keys(value)) {
        // Ignore system special properties
        if (key.startsWith("__")) {
          continue;
        }

        // If property doesn't exist in schema, it's a warning
        if (!(key in schema.properties)) {
          const propPath = path ? `${path}.${key}` : key;
          errors.push({
            path: propPath,
            message: "property not defined in type (can be removed)",
            severity: "warning",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validates union types
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

  // Try to validate against each type in the union
  // If at least one type is valid, it's ok
  for (const unionType of schema.unionTypes) {
    const errors = validateValue(value, unionType, path, ignoreUnusedProps);
    if (errors.length === 0) {
      return []; // Valid for this union type
    }
  }

  // If no union type was valid, return error
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
        `value does not match any type in union (${unionTypeNames})`,
      severity: "error",
    },
  ];
}

/**
 * Validates special types (ImageWidget, Product, etc)
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
      // All these are validated as strings
      if (typeof value !== "string") {
        errors.push({
          path,
          message:
            `expected ${schema.specialType} (string), got ${typeof value}`,
          severity: "error",
        });
      }
      break;

    case "Product":
      // Validate basic Product structure
      if (typeof value !== "object" || value === null) {
        errors.push({
          path,
          message: `expected Product (object), got ${typeof value}`,
          severity: "error",
        });
      } else {
        // Validate required basic fields
        if (!value.productID && !value.sku) {
          errors.push({
            path: `${path}.productID`,
            message: "Product must have productID or sku",
            severity: "error",
          });
        }
      }
      break;

    case "ProductListingPage":
      // Validate basic structure
      if (typeof value !== "object" || value === null) {
        errors.push({
          path,
          message:
            `expected ProductListingPage (object), got ${typeof value}`,
          severity: "error",
        });
      } else {
        // Validate that it has products
        if (!Array.isArray(value.products)) {
          errors.push({
            path: `${path}.products`,
            message: "ProductListingPage must have products array",
            severity: "error",
          });
        }
      }
      break;

    case "ProductDetailsPage":
      // Validate basic structure
      if (typeof value !== "object" || value === null) {
        errors.push({
          path,
          message:
            `expected ProductDetailsPage (object), got ${typeof value}`,
          severity: "error",
        });
      } else {
        // Validate that it has product
        if (!value.product) {
          errors.push({
            path: `${path}.product`,
            message: "ProductDetailsPage must have product",
            severity: "error",
          });
        }
      }
      break;

    default:
      // Unknown special type, accept anything
      break;
  }

  return errors;
}
