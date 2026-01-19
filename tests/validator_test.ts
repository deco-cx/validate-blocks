import { assertEquals } from "@std/assert";
import { validateValue, ValidationError } from "../src/validator.ts";
import { TypeSchema } from "../src/ts-parser.ts";

// ============================================================================
// PRIMITIVE VALIDATION TESTS
// ============================================================================

Deno.test("validateValue - string primitive valid", () => {
  const schema: TypeSchema = { kind: "primitive", type: "string" };
  const errors = validateValue("hello", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - string primitive invalid (number)", () => {
  const schema: TypeSchema = { kind: "primitive", type: "string" };
  const errors = validateValue(123, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected string, got number");
});

Deno.test("validateValue - number primitive valid", () => {
  const schema: TypeSchema = { kind: "primitive", type: "number" };
  const errors = validateValue(42, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - number primitive invalid (string)", () => {
  const schema: TypeSchema = { kind: "primitive", type: "number" };
  const errors = validateValue("42", schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected number, got string");
});

Deno.test("validateValue - boolean primitive valid (true)", () => {
  const schema: TypeSchema = { kind: "primitive", type: "boolean" };
  const errors = validateValue(true, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - boolean primitive valid (false)", () => {
  const schema: TypeSchema = { kind: "primitive", type: "boolean" };
  const errors = validateValue(false, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - boolean primitive invalid", () => {
  const schema: TypeSchema = { kind: "primitive", type: "boolean" };
  const errors = validateValue("true", schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected boolean, got string");
});

Deno.test("validateValue - null primitive valid", () => {
  const schema: TypeSchema = { kind: "primitive", type: "null" };
  const errors = validateValue(null, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - null primitive invalid", () => {
  const schema: TypeSchema = { kind: "primitive", type: "null" };
  const errors = validateValue("null", schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected null, got string");
});

// ============================================================================
// ANY TYPE TESTS
// ============================================================================

Deno.test("validateValue - any accepts string", () => {
  const schema: TypeSchema = { kind: "any" };
  const errors = validateValue("anything", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - any accepts object", () => {
  const schema: TypeSchema = { kind: "any" };
  const errors = validateValue({ foo: "bar" }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - any accepts null", () => {
  const schema: TypeSchema = { kind: "any" };
  const errors = validateValue(null, schema, "root");
  assertEquals(errors.length, 0);
});

// ============================================================================
// OPTIONAL PROPERTY TESTS
// ============================================================================

Deno.test("validateValue - optional property missing is ok", () => {
  const schema: TypeSchema = { kind: "primitive", type: "string", optional: true };
  const errors = validateValue(undefined, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - required property missing is error", () => {
  const schema: TypeSchema = { kind: "primitive", type: "string", optional: false };
  const errors = validateValue(undefined, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "required property missing");
  assertEquals(errors[0].severity, "error");
});

// ============================================================================
// ARRAY VALIDATION TESTS
// ============================================================================

Deno.test("validateValue - array of strings valid", () => {
  const schema: TypeSchema = {
    kind: "array",
    elementType: { kind: "primitive", type: "string" },
  };
  const errors = validateValue(["a", "b", "c"], schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - array with invalid element", () => {
  const schema: TypeSchema = {
    kind: "array",
    elementType: { kind: "primitive", type: "string" },
  };
  const errors = validateValue(["a", 123, "c"], schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].path, "root[1]");
  assertEquals(errors[0].message, "expected string, got number");
});

Deno.test("validateValue - array expected but got object", () => {
  const schema: TypeSchema = {
    kind: "array",
    elementType: { kind: "primitive", type: "string" },
  };
  const errors = validateValue({ foo: "bar" }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected array, got object");
});

Deno.test("validateValue - array accepts __resolveType reference", () => {
  const schema: TypeSchema = {
    kind: "array",
    elementType: { kind: "primitive", type: "string" },
  };
  // A loader reference is valid - the loader will be validated separately
  const errors = validateValue(
    { __resolveType: "site/loaders/someLoader.ts" },
    schema,
    "root"
  );
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - empty array is valid", () => {
  const schema: TypeSchema = {
    kind: "array",
    elementType: { kind: "primitive", type: "string" },
  };
  const errors = validateValue([], schema, "root");
  assertEquals(errors.length, 0);
});

// ============================================================================
// OBJECT VALIDATION TESTS
// ============================================================================

Deno.test("validateValue - object with valid properties", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
      age: { kind: "primitive", type: "number" },
    },
  };
  const errors = validateValue({ name: "John", age: 30 }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - object with missing required property", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
      age: { kind: "primitive", type: "number" },
    },
  };
  const errors = validateValue({ name: "John" }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].path, "root.age");
  assertEquals(errors[0].message, "required property missing");
});

Deno.test("validateValue - object with wrong property type", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
    },
  };
  const errors = validateValue({ name: 123 }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].path, "root.name");
  assertEquals(errors[0].message, "expected string, got number");
});

Deno.test("validateValue - object with optional property missing", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
      nickname: { kind: "primitive", type: "string", optional: true },
    },
  };
  const errors = validateValue({ name: "John" }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - object with extra property (warning)", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
    },
  };
  const errors = validateValue(
    { name: "John", extra: "prop" },
    schema,
    "root",
    false // don't ignore unused props
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].path, "root.extra");
  assertEquals(errors[0].severity, "warning");
  assertEquals(errors[0].message, "property not defined in type (can be removed)");
});

Deno.test("validateValue - object ignores __resolveType property", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
    },
  };
  const errors = validateValue(
    { name: "John", __resolveType: "site/sections/Test.tsx" },
    schema,
    "root",
    false
  );
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - object with ignoreUnusedProps=true", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
    },
  };
  const errors = validateValue(
    { name: "John", extra: "prop" },
    schema,
    "root",
    true // ignore unused props
  );
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - object expected but got array", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
    },
  };
  const errors = validateValue(["not", "an", "object"], schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected object, got array");
});

Deno.test("validateValue - object expected but got null", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      name: { kind: "primitive", type: "string" },
    },
  };
  const errors = validateValue(null, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected object, got object");
});

// ============================================================================
// NESTED OBJECT TESTS
// ============================================================================

Deno.test("validateValue - nested object valid", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      user: {
        kind: "object",
        properties: {
          name: { kind: "primitive", type: "string" },
          email: { kind: "primitive", type: "string" },
        },
      },
    },
  };
  const errors = validateValue(
    { user: { name: "John", email: "john@example.com" } },
    schema,
    "root"
  );
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - nested object with error", () => {
  const schema: TypeSchema = {
    kind: "object",
    properties: {
      user: {
        kind: "object",
        properties: {
          name: { kind: "primitive", type: "string" },
        },
      },
    },
  };
  const errors = validateValue(
    { user: { name: 123 } },
    schema,
    "root"
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].path, "root.user.name");
});

// ============================================================================
// UNION TYPE TESTS
// ============================================================================

Deno.test("validateValue - union type matches first type", () => {
  const schema: TypeSchema = {
    kind: "union",
    unionTypes: [
      { kind: "primitive", type: "string" },
      { kind: "primitive", type: "number" },
    ],
  };
  const errors = validateValue("hello", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - union type matches second type", () => {
  const schema: TypeSchema = {
    kind: "union",
    unionTypes: [
      { kind: "primitive", type: "string" },
      { kind: "primitive", type: "number" },
    ],
  };
  const errors = validateValue(42, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - union type matches none", () => {
  const schema: TypeSchema = {
    kind: "union",
    unionTypes: [
      { kind: "primitive", type: "string" },
      { kind: "primitive", type: "number" },
    ],
  };
  const errors = validateValue(true, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("string | number"), true);
});

Deno.test("validateValue - union with null", () => {
  const schema: TypeSchema = {
    kind: "union",
    unionTypes: [
      { kind: "primitive", type: "string" },
      { kind: "primitive", type: "null" },
    ],
  };
  const errors1 = validateValue("hello", schema, "root");
  const errors2 = validateValue(null, schema, "root");
  assertEquals(errors1.length, 0);
  assertEquals(errors2.length, 0);
});

Deno.test("validateValue - empty union accepts anything", () => {
  const schema: TypeSchema = {
    kind: "union",
    unionTypes: [],
  };
  const errors = validateValue("anything", schema, "root");
  assertEquals(errors.length, 0);
});

// ============================================================================
// SPECIAL TYPE TESTS
// ============================================================================

Deno.test("validateValue - ImageWidget valid (string)", () => {
  const schema: TypeSchema = { kind: "special", specialType: "ImageWidget" };
  const errors = validateValue("https://example.com/image.png", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - ImageWidget invalid (not string)", () => {
  const schema: TypeSchema = { kind: "special", specialType: "ImageWidget" };
  const errors = validateValue({ url: "test" }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected ImageWidget (string), got object");
});

Deno.test("validateValue - RichText valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "RichText" };
  const errors = validateValue("<p>Hello</p>", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - Color valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "Color" };
  const errors = validateValue("#FF0000", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - DateWidget valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "DateWidget" };
  const errors = validateValue("2024-01-15", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - DateTimeWidget valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "DateTimeWidget" };
  const errors = validateValue("2024-01-15T10:30:00", schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - Product valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "Product" };
  const errors = validateValue({ productID: "123", name: "Test" }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - Product valid with sku", () => {
  const schema: TypeSchema = { kind: "special", specialType: "Product" };
  const errors = validateValue({ sku: "SKU123", name: "Test" }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - Product invalid (no productID or sku)", () => {
  const schema: TypeSchema = { kind: "special", specialType: "Product" };
  const errors = validateValue({ name: "Test" }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Product must have productID or sku");
});

Deno.test("validateValue - Product invalid (not object)", () => {
  const schema: TypeSchema = { kind: "special", specialType: "Product" };
  const errors = validateValue("not an object", schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "expected Product (object), got string");
});

Deno.test("validateValue - ProductListingPage valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "ProductListingPage" };
  const errors = validateValue({ products: [] }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - ProductListingPage invalid (no products array)", () => {
  const schema: TypeSchema = { kind: "special", specialType: "ProductListingPage" };
  const errors = validateValue({ items: [] }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "ProductListingPage must have products array");
});

Deno.test("validateValue - ProductDetailsPage valid", () => {
  const schema: TypeSchema = { kind: "special", specialType: "ProductDetailsPage" };
  const errors = validateValue({ product: { productID: "123" } }, schema, "root");
  assertEquals(errors.length, 0);
});

Deno.test("validateValue - ProductDetailsPage invalid (no product)", () => {
  const schema: TypeSchema = { kind: "special", specialType: "ProductDetailsPage" };
  const errors = validateValue({ item: {} }, schema, "root");
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "ProductDetailsPage must have product");
});

Deno.test("validateValue - unknown special type accepts anything", () => {
  const schema: TypeSchema = { kind: "special", specialType: "UnknownWidget" };
  const errors = validateValue({ anything: "works" }, schema, "root");
  assertEquals(errors.length, 0);
});
