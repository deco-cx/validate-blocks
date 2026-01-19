import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import {
  clearImportMapCache,
  extractPropsInterface,
  loadImportMap,
  resolveImportPath,
  TypeSchema,
} from "../src/ts-parser.ts";
import { dirname, join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Diretório dos fixtures de teste
const TEST_DIR = dirname(new URL(import.meta.url).pathname);
const FIXTURES_DIR = join(TEST_DIR, "fixtures");

Deno.test("loadImportMap - loads import map from deno.json", () => {
  // Limpa cache antes do teste
  clearImportMapCache();

  const importMap = loadImportMap(FIXTURES_DIR);

  assertEquals(importMap["$store/"], "./");
  assertEquals(importMap["$home/"], "./");
  assertEquals(importMap["apps/"], "https://example.com/apps/");
});

Deno.test("loadImportMap - returns empty object for missing deno.json", () => {
  clearImportMapCache();

  const importMap = loadImportMap("/nonexistent/path");

  assertEquals(importMap, {});
});

Deno.test("loadImportMap - caches import map", () => {
  clearImportMapCache();

  // Primeira chamada carrega do disco
  const importMap1 = loadImportMap(FIXTURES_DIR);
  // Segunda chamada usa cache
  const importMap2 = loadImportMap(FIXTURES_DIR);

  // Deve ser o mesmo objeto (mesmo reference)
  assertEquals(importMap1, importMap2);
});

Deno.test("resolveImportPath - resolves relative paths", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/SomeSection.tsx");
  const resolved = resolveImportPath("./Helper.tsx", currentFilePath);

  // Deve resolver para o diretório sections/Helper.tsx
  assertEquals(resolved, join(FIXTURES_DIR, "sections/Helper.tsx"));
});

Deno.test("resolveImportPath - resolves parent relative paths", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/nested/Deep.tsx");
  const resolved = resolveImportPath("../Helper.tsx", currentFilePath);

  assertEquals(resolved, join(FIXTURES_DIR, "sections/Helper.tsx"));
});

Deno.test("resolveImportPath - resolves $store/ alias", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/LoginPage.tsx");
  const resolved = resolveImportPath(
    "$store/islands/LoginPage.tsx",
    currentFilePath,
    FIXTURES_DIR, // projectRoot
  );

  // $store/ -> ./ então deve resolver para fixtures/islands/LoginPage.tsx
  assertEquals(resolved, join(FIXTURES_DIR, "islands/LoginPage.tsx"));
});

Deno.test("resolveImportPath - resolves $home/ alias", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/SomeSection.tsx");
  const resolved = resolveImportPath(
    "$home/components/Footer.tsx",
    currentFilePath,
    FIXTURES_DIR,
  );

  assertEquals(resolved, join(FIXTURES_DIR, "components/Footer.tsx"));
});

Deno.test("resolveImportPath - ignores external URL aliases", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/SomeSection.tsx");
  const resolved = resolveImportPath(
    "apps/commerce/mod.ts",
    currentFilePath,
    FIXTURES_DIR,
  );

  // apps/ points to an external URL, so it doesn't resolve locally
  // Deve retornar um caminho relativo ao diretório atual (fallback)
  assertEquals(resolved.includes("apps/commerce/mod.ts"), true);
});

Deno.test("resolveImportPath - without projectRoot uses relative fallback", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/SomeSection.tsx");
  const resolved = resolveImportPath(
    "$store/islands/LoginPage.tsx",
    currentFilePath,
    // sem projectRoot
  );

  // Sem projectRoot, trata como caminho relativo (comportamento antigo)
  assertEquals(resolved.includes("$store"), true);
});

Deno.test("resolveImportPath - adds .tsx extension when missing", () => {
  clearImportMapCache();

  const currentFilePath = join(FIXTURES_DIR, "sections/SomeSection.tsx");
  const resolved = resolveImportPath(
    "$store/islands/LoginPage",
    currentFilePath,
    FIXTURES_DIR,
  );

  // Deve tentar adicionar extensão .tsx
  assertEquals(resolved, join(FIXTURES_DIR, "islands/LoginPage.tsx"));
});

Deno.test("extractPropsInterface - follows re-export with alias", async () => {
  clearImportMapCache();

  // sections/LoginPage.tsx re-exporta de $store/islands/LoginPage.tsx
  const filePath = join(FIXTURES_DIR, "sections/LoginPage.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);
  // O arquivo de destino deve ter uma prop "email" e "password"
  assertExists(schema.properties["email"]);
  assertExists(schema.properties["password"]);
});

Deno.test("extractPropsInterface - extracts direct Props interface", async () => {
  clearImportMapCache();

  // islands/LoginPage.tsx tem Props diretamente
  const filePath = join(FIXTURES_DIR, "islands/LoginPage.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);
  assertExists(schema.properties["email"]);
  assertEquals(schema.properties["email"].kind, "primitive");
  assertEquals(schema.properties["email"].type, "string");
});

// ============================================================================
// PRIMITIVE TYPE EXTRACTION TESTS
// ============================================================================

Deno.test("extractPropsInterface - extracts primitive types", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithPrimitives.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // Required string
  assertExists(schema.properties["title"]);
  assertEquals(schema.properties["title"].kind, "primitive");
  assertEquals(schema.properties["title"].type, "string");
  assertEquals(schema.properties["title"].optional, false);

  // Required number
  assertExists(schema.properties["count"]);
  assertEquals(schema.properties["count"].kind, "primitive");
  assertEquals(schema.properties["count"].type, "number");

  // Required boolean
  assertExists(schema.properties["isActive"]);
  assertEquals(schema.properties["isActive"].kind, "primitive");
  assertEquals(schema.properties["isActive"].type, "boolean");

  // Optional string
  assertExists(schema.properties["description"]);
  assertEquals(schema.properties["description"].kind, "primitive");
  assertEquals(schema.properties["description"].type, "string");
  assertEquals(schema.properties["description"].optional, true);
});

// ============================================================================
// ARRAY TYPE EXTRACTION TESTS
// ============================================================================

Deno.test("extractPropsInterface - extracts array types", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithArrays.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // string[]
  assertExists(schema.properties["tags"]);
  assertEquals(schema.properties["tags"].kind, "array");
  assertExists(schema.properties["tags"].elementType);
  assertEquals(schema.properties["tags"].elementType!.kind, "primitive");
  assertEquals(schema.properties["tags"].elementType!.type, "string");

  // number[]
  assertExists(schema.properties["numbers"]);
  assertEquals(schema.properties["numbers"].kind, "array");
  assertExists(schema.properties["numbers"].elementType);
  assertEquals(schema.properties["numbers"].elementType!.kind, "primitive");
  assertEquals(schema.properties["numbers"].elementType!.type, "number");

  // { name: string; value: number }[]
  assertExists(schema.properties["items"]);
  assertEquals(schema.properties["items"].kind, "array");
  assertExists(schema.properties["items"].elementType);
  assertEquals(schema.properties["items"].elementType!.kind, "object");
});

// ============================================================================
// UNION TYPE EXTRACTION TESTS
// ============================================================================

Deno.test("extractPropsInterface - extracts union types", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithUnion.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // string | number
  assertExists(schema.properties["value"]);
  assertEquals(schema.properties["value"].kind, "union");
  assertExists(schema.properties["value"].unionTypes);
  assertEquals(schema.properties["value"].unionTypes!.length >= 2, true);

  // string | null
  assertExists(schema.properties["maybeNull"]);
  assertEquals(schema.properties["maybeNull"].kind, "union");
});

// ============================================================================
// SPECIAL TYPE EXTRACTION TESTS
// ============================================================================

Deno.test("extractPropsInterface - extracts special types (ImageWidget, RichText)", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithSpecialTypes.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // ImageWidget
  assertExists(schema.properties["image"]);
  assertEquals(schema.properties["image"].kind, "special");
  assertEquals(schema.properties["image"].specialType, "ImageWidget");

  // RichText
  assertExists(schema.properties["content"]);
  assertEquals(schema.properties["content"].kind, "special");
  assertEquals(schema.properties["content"].specialType, "RichText");
});

// ============================================================================
// INTERFACE INHERITANCE TESTS
// ============================================================================

Deno.test("extractPropsInterface - handles interface inheritance (extends)", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithInheritance.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // From BaseProps
  assertExists(schema.properties["id"]);
  assertEquals(schema.properties["id"].kind, "primitive");
  assertEquals(schema.properties["id"].type, "string");

  assertExists(schema.properties["className"]);
  assertEquals(schema.properties["className"].optional, true);

  // From ExtendedProps
  assertExists(schema.properties["title"]);
  assertExists(schema.properties["subtitle"]);

  // From Props itself
  assertExists(schema.properties["isHighlighted"]);
  assertEquals(schema.properties["isHighlighted"].kind, "primitive");
  assertEquals(schema.properties["isHighlighted"].type, "boolean");
});

// ============================================================================
// UTILITY TYPE TESTS (Omit, Pick, Partial)
// ============================================================================

Deno.test("extractPropsInterface - handles Omit utility type", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithOmit.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // Should have id, name, email
  assertExists(schema.properties["id"]);
  assertExists(schema.properties["name"]);
  assertExists(schema.properties["email"]);

  // Should NOT have password (omitted)
  assertEquals(schema.properties["password"], undefined);
});

Deno.test("extractPropsInterface - handles Pick utility type", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithPick.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // Should have only id and name (picked)
  assertExists(schema.properties["id"]);
  assertExists(schema.properties["name"]);

  // Should NOT have email, password, createdAt
  assertEquals(schema.properties["email"], undefined);
  assertEquals(schema.properties["password"], undefined);
  assertEquals(schema.properties["createdAt"], undefined);
});

Deno.test("extractPropsInterface - handles Partial utility type", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithPartial.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // All properties should be optional
  assertExists(schema.properties["name"]);
  assertEquals(schema.properties["name"].optional, true);

  assertExists(schema.properties["age"]);
  assertEquals(schema.properties["age"].optional, true);

  assertExists(schema.properties["email"]);
  assertEquals(schema.properties["email"].optional, true);
});

// ============================================================================
// @ignore JSDOC TAG TESTS
// ============================================================================

Deno.test("extractPropsInterface - respects @ignore JSDoc tag", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithIgnore.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // Should have title and description
  assertExists(schema.properties["title"]);
  assertExists(schema.properties["description"]);

  // Should NOT have internalId and debugInfo (marked with @ignore)
  assertEquals(schema.properties["internalId"], undefined);
  assertEquals(schema.properties["debugInfo"], undefined);
});

// ============================================================================
// TYPE LITERAL (INLINE OBJECT) TESTS
// ============================================================================

Deno.test("extractPropsInterface - handles inline type literals", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithTypeLiteral.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  // user: { name: string; email: string; address?: { ... } }
  assertExists(schema.properties["user"]);
  assertEquals(schema.properties["user"].kind, "object");
  assertExists(schema.properties["user"].properties);
  assertExists(schema.properties["user"].properties!["name"]);
  assertExists(schema.properties["user"].properties!["email"]);
  assertExists(schema.properties["user"].properties!["address"]);
  assertEquals(schema.properties["user"].properties!["address"]!.optional, true);

  // settings: { theme: string; notifications: boolean }
  assertExists(schema.properties["settings"]);
  assertEquals(schema.properties["settings"].kind, "object");
});

// ============================================================================
// ARROW FUNCTION COMPONENT TESTS
// ============================================================================

Deno.test("extractPropsInterface - extracts Props from arrow function component", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithArrowFunction.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  assertExists(schema.properties["message"]);
  assertEquals(schema.properties["message"].kind, "primitive");
  assertEquals(schema.properties["message"].type, "string");

  assertExists(schema.properties["count"]);
  assertEquals(schema.properties["count"].kind, "primitive");
  assertEquals(schema.properties["count"].type, "number");
});

// ============================================================================
// TYPE ALIAS TESTS
// ============================================================================

Deno.test("extractPropsInterface - extracts type alias Props", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/WithTypeAlias.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertExists(schema);
  assertEquals(schema.kind, "object");
  assertExists(schema.properties);

  assertExists(schema.properties["heading"]);
  assertEquals(schema.properties["heading"].kind, "primitive");
  assertEquals(schema.properties["heading"].type, "string");

  assertExists(schema.properties["subheading"]);
  assertEquals(schema.properties["subheading"].optional, true);

  assertExists(schema.properties["items"]);
  assertEquals(schema.properties["items"].kind, "array");
});

// ============================================================================
// NO PROPS TESTS
// ============================================================================

Deno.test("extractPropsInterface - returns null for component without Props", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/NoProps.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertEquals(schema, null);
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

Deno.test("extractPropsInterface - handles non-existent file gracefully", async () => {
  clearImportMapCache();

  const filePath = join(FIXTURES_DIR, "sections/NonExistent.tsx");
  const schema = await extractPropsInterface(filePath, FIXTURES_DIR);

  assertEquals(schema, null);
});
