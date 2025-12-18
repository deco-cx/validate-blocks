import { join, relative } from "https://deno.land/std@0.208.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { filePathToResolveType } from "./type-mapper.ts";
import { extractPropsInterface, TypeSchema } from "./ts-parser.ts";
import { validateValue, ValidationError } from "./validator.ts";

interface SectionValidationResult {
  sectionFile: string; // Caminho relativo para exibição
  sectionFilePath: string; // Caminho absoluto para comparação
  resolveType: string;
  occurrences: OccurrenceValidation[];
  totalErrors: number;
  totalWarnings: number;
  unused?: boolean; // Flag para indicar que a section não está sendo usada
}

interface OccurrenceValidation {
  jsonFile: string;
  jsonFilePath: string; // Caminho completo do arquivo JSON
  jsonPath: string; // Caminho dentro do JSON (ex: "sections[0]")
  jsonContent?: string; // Conteúdo do JSON para buscar linhas
  resolveTypeLine?: number; // Linha onde o __resolveType está
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

interface ValidationOptions {
  includeUnusedVars: boolean;
  removeUnusedVars: boolean;
  removeUnusedSections: boolean;
  blocksDir?: string; // Caminho customizado para a pasta de blocos
}

/**
 * Função principal que orquestra a validação
 */
export default async function main() {
  const projectRoot = Deno.cwd();

  // Parse argumentos
  const args = Deno.args;
  // Extrai o valor de -blocks ou -b se existir
  let customBlocksDir: string | undefined;
  const blocksDirIndex = args.findIndex((arg, idx) =>
    (arg === "-blocks" || arg === "-b") && args[idx + 1]
  );
  if (blocksDirIndex !== -1 && args[blocksDirIndex + 1]) {
    customBlocksDir = args[blocksDirIndex + 1];
  }

  const removeUnusedVars = args.includes("-rm-vars");

  const options: ValidationOptions = {
    // Se vai remover, precisa incluir os warnings para detectá-los
    includeUnusedVars: args.includes("-unused") || removeUnusedVars,
    removeUnusedVars,
    removeUnusedSections: args.includes("-rm-sections"),
    blocksDir: customBlocksDir,
  };

  if (customBlocksDir) {
    console.log(`📂 Usando pasta de blocos customizada: ${customBlocksDir}\n`);
  }

  if (options.removeUnusedVars) {
    console.log("🧹 Modo: Remover propriedades não definidas na tipagem\n");
  }
  if (options.removeUnusedSections) {
    console.log("🗑️  Modo: Remover sections não utilizadas\n");
  }

  // Remove flags dos argumentos (incluindo -blocks/-b e seu valor)
  const fileArgs = args.filter((arg, idx) => {
    if (arg.startsWith("-")) return false;
    if (idx > 0 && (args[idx - 1] === "-blocks" || args[idx - 1] === "-b")) {
      return false;
    }
    return true;
  });
  const targetFile = fileArgs.length > 0 ? fileArgs[0] : null;

  if (targetFile) {
    // Valida apenas um arquivo específico
    console.log(`🔍 Validando ${targetFile}...\n`);
    const results = await validateSpecificFile(
      targetFile,
      projectRoot,
      options,
    );
    const hasErrors = reportResults(results);

    // Executar limpezas se solicitado
    if (options.removeUnusedVars) {
      await removeUnusedPropertiesFromJsons(results);
    }

    // Exit code
    Deno.exit(hasErrors ? 1 : 0);
  } else {
    // Valida todos os arquivos
    console.log("🔍 Validando sections e loaders...\n");
    const results = await validateAllSections(projectRoot, options);
    const allSectionFiles = await getAllSectionFiles(projectRoot);
    const usedSections = getUsedSections(results);

    const hasErrors = reportResults(results);

    // Executar limpezas se solicitado
    if (options.removeUnusedVars) {
      await removeUnusedPropertiesFromJsons(results);
    }
    if (options.removeUnusedSections) {
      await removeUnusedSectionFiles(allSectionFiles, usedSections);
    }

    // Exit code
    Deno.exit(hasErrors ? 1 : 0);
  }
}

/**
 * Valida um arquivo específico
 */
async function validateSpecificFile(
  targetFile: string,
  projectRoot: string,
  options: ValidationOptions,
): Promise<SectionValidationResult[]> {
  const results: SectionValidationResult[] = [];

  // Resolve caminho absoluto
  let absolutePath: string;
  if (targetFile.startsWith("/")) {
    absolutePath = targetFile;
  } else {
    absolutePath = join(projectRoot, targetFile);
  }

  // Verifica se o arquivo existe
  try {
    await Deno.stat(absolutePath);
  } catch {
    console.error(`❌ Arquivo não encontrado: ${targetFile}`);
    Deno.exit(1);
  }

  // Valida o arquivo
  const result = await validateSection(absolutePath, projectRoot, options);
  if (result) {
    results.push(result);
  }

  return results;
}

/**
 * Valida todas as sections e loaders do projeto
 */
async function validateAllSections(
  projectRoot: string,
  options: ValidationOptions,
): Promise<SectionValidationResult[]> {
  const results: SectionValidationResult[] = [];

  // Encontra todos os arquivos de sections e loaders
  const sectionFiles = await findAllSections(projectRoot);

  // Para cada section, busca ocorrências e valida
  for (const sectionFile of sectionFiles) {
    const result = await validateSection(sectionFile, projectRoot, options);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Encontra todos os arquivos de sections e loaders
 */
async function findAllSections(projectRoot: string): Promise<string[]> {
  const files: string[] = [];

  // Busca em sections/
  const sectionsDir = join(projectRoot, "sections");
  try {
    for await (
      const entry of walk(sectionsDir, {
        exts: [".tsx", ".ts"],
        includeDirs: false,
      })
    ) {
      files.push(entry.path);
    }
  } catch {
    // Diretório não existe
  }

  // Busca em loaders/
  const loadersDir = join(projectRoot, "loaders");
  try {
    for await (
      const entry of walk(loadersDir, {
        exts: [".ts"],
        includeDirs: false,
      })
    ) {
      files.push(entry.path);
    }
  } catch {
    // Diretório não existe
  }

  return files;
}

/**
 * Valida uma section/loader específica
 */
async function validateSection(
  sectionFile: string,
  projectRoot: string,
  options: ValidationOptions,
): Promise<SectionValidationResult | null> {
  try {
    // Gera o __resolveType a partir do caminho do arquivo
    const resolveType = filePathToResolveType(sectionFile, projectRoot);

    // Ignora Theme
    if (resolveType.includes("/Theme/Theme.tsx")) {
      return null;
    }

    // Ignora loaders de sistema
    const systemLoaders = [
      "loaders/user.ts",
      "loaders/icons.ts",
      "loaders/wishlist.ts",
      "loaders/minicart.ts",
      "loaders/availableIcons.ts",
    ];

    if (systemLoaders.some((loader) => sectionFile.endsWith(loader))) {
      return null;
    }

    // Extrai a interface Props
    const propsSchema = await extractPropsInterface(sectionFile);

    // Busca todas as ocorrências desse resolveType nos JSONs
    const blocksDir = options.blocksDir || join(projectRoot, ".deco", "blocks");
    const occurrences = await findOccurrencesInJsons(
      resolveType,
      blocksDir,
      propsSchema,
      options,
    );

    // Se não tem ocorrências, retorna com warning
    if (occurrences.length === 0) {
      return {
        sectionFile: relative(projectRoot, sectionFile),
        sectionFilePath: sectionFile,
        resolveType,
        occurrences: [],
        totalErrors: 0,
        totalWarnings: 1,
        unused: true, // Flag para indicar que não está sendo usada
      };
    }

    // Conta erros e warnings
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const occ of occurrences) {
      totalErrors += occ.errors.length;
      totalWarnings += occ.warnings.length;
    }

    return {
      sectionFile: relative(projectRoot, sectionFile),
      sectionFilePath: sectionFile,
      resolveType,
      occurrences,
      totalErrors,
      totalWarnings,
      unused: false,
    };
  } catch (error) {
    console.error(`Erro ao processar ${sectionFile}:`, error.message);
    return null;
  }
}

/**
 * Busca recursivamente por ocorrências de um __resolveType em todos os JSONs
 */
async function findOccurrencesInJsons(
  resolveType: string,
  blocksDir: string,
  propsSchema: TypeSchema | null,
  options: ValidationOptions,
): Promise<OccurrenceValidation[]> {
  const occurrences: OccurrenceValidation[] = [];

  try {
    for await (
      const entry of walk(blocksDir, {
        exts: [".json"],
        includeDirs: false,
      })
    ) {
      const jsonContent = await Deno.readTextFile(entry.path);
      const jsonData = JSON.parse(jsonContent);

      // Busca recursivamente no JSON
      const found = findInObject(
        jsonData,
        resolveType,
        "",
        propsSchema,
        options,
      );

      for (let i = 0; i < found.length; i++) {
        const occurrence = found[i];
        // Encontra a linha do __resolveType desta ocorrência específica
        const resolveTypeLine = findResolveTypeLine(
          jsonContent,
          resolveType,
          i,
        );

        occurrences.push({
          jsonFile: entry.path.split("/").pop() || "unknown",
          jsonFilePath: entry.path,
          jsonPath: occurrence.path,
          jsonContent, // Passa o conteúdo para buscar linhas depois
          resolveTypeLine,
          valid: occurrence.valid,
          errors: occurrence.errors,
          warnings: occurrence.warnings,
        });
      }
    }
  } catch {
    // Diretório não existe
  }

  return occurrences;
}

/**
 * Busca recursivamente em um objeto por __resolveType e valida
 */
function findInObject(
  obj: unknown,
  targetResolveType: string,
  currentPath: string,
  propsSchema: TypeSchema | null,
  options: ValidationOptions,
): Array<
  {
    path: string;
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
  }
> {
  const results: Array<
    {
      path: string;
      valid: boolean;
      errors: ValidationError[];
      warnings: ValidationError[];
    }
  > = [];

  if (typeof obj !== "object" || obj === null) {
    return results;
  }

  // Se encontrou o __resolveType, valida
  if (
    typeof obj === "object" &&
    obj !== null &&
    "__resolveType" in obj &&
    obj.__resolveType === targetResolveType
  ) {
    if (!propsSchema) {
      results.push({
        path: currentPath || "root",
        valid: true,
        errors: [],
        warnings: [{
          path: "Props",
          message: "interface Props não encontrada no arquivo",
          severity: "warning",
        }],
      });
    } else {
      const allIssues = validateValue(
        obj,
        propsSchema,
        "",
        !options.includeUnusedVars, // Inverte: se NÃO incluir, então ignora
      );
      const errors = allIssues.filter((issue) => issue.severity !== "warning");
      const warnings = allIssues.filter((issue) =>
        issue.severity === "warning"
      );

      results.push({
        path: currentPath || "root",
        valid: errors.length === 0,
        errors,
        warnings,
      });
    }
  }

  // Continua buscando recursivamente
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const newPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
      results.push(
        ...findInObject(item, targetResolveType, newPath, propsSchema, options),
      );
    });
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      results.push(
        ...findInObject(
          value,
          targetResolveType,
          newPath,
          propsSchema,
          options,
        ),
      );
    }
  }

  return results;
}

/**
 * Encontra o número da linha onde o __resolveType aparece
 * occurrenceIndex permite encontrar a N-ésima ocorrência
 */
function findResolveTypeLine(
  content: string,
  resolveType: string,
  occurrenceIndex: number,
): number {
  const searchPattern = `"__resolveType": "${resolveType}"`;
  const lines = content.split("\n");
  let foundCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      if (foundCount === occurrenceIndex) {
        return i + 1;
      }
      foundCount++;
    }
  }

  return 0;
}

/**
 * Encontra o número da linha onde uma propriedade específica aparece no JSON
 * Para propriedades ausentes em arrays, tenta encontrar a linha do array pai
 */
function findPropertyLine(
  content: string,
  propertyPath: string,
  occurrenceIndex: number,
): number | null {
  // Se for uma propriedade dentro de um array (ex: "awards[0].title")
  // e a propriedade está ausente, busca pelo array pai
  if (propertyPath.includes("[")) {
    const parts = propertyPath.split(".");

    // Tenta primeiro buscar a propriedade específica
    const lastPart = parts[parts.length - 1];
    const cleanProperty = lastPart.replace(/\[\d+\]/, "");

    if (cleanProperty) {
      const searchPattern = `"${cleanProperty}"`;
      const lines = content.split("\n");
      let foundCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchPattern)) {
          if (foundCount === occurrenceIndex) {
            return i + 1;
          }
          foundCount++;
        }
      }
    }

    // Se não encontrou, busca pelo array pai (ex: "awards" de "awards[0].title")
    const arrayPart = parts.find((p) => p.includes("["));
    if (arrayPart) {
      const arrayName = arrayPart.split("[")[0];
      const searchPattern = `"${arrayName}"`;
      const lines = content.split("\n");
      let foundCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchPattern)) {
          if (foundCount === occurrenceIndex) {
            return i + 1;
          }
          foundCount++;
        }
      }
    }

    return null;
  }

  // Para propriedades simples
  const parts = propertyPath.split(".");
  const lastPart = parts[parts.length - 1];
  const cleanProperty = lastPart.replace(/\[\d+\]/, "");

  if (!cleanProperty) return null;

  const searchPattern = `"${cleanProperty}"`;
  const lines = content.split("\n");
  let foundCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      if (foundCount === occurrenceIndex) {
        return i + 1;
      }
      foundCount++;
    }
  }

  return null;
}

/**
 * Reporta os resultados da validação
 * @returns true se houver erros
 */
function reportResults(results: SectionValidationResult[]): boolean {
  let totalOccurrences = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  const sectionsWithErrors: SectionValidationResult[] = [];
  const sectionsWithWarnings: SectionValidationResult[] = [];
  const unusedSections: SectionValidationResult[] = [];

  for (const result of results) {
    totalOccurrences += result.occurrences.length;
    totalErrors += result.totalErrors;

    // Conta warnings apenas se não for unused
    if (!result.unused) {
      totalWarnings += result.totalWarnings;
    }

    // Ignora loaders, Theme e sections especiais (Component, Session)
    const isSpecialSection = result.sectionFile.includes("loaders/") ||
      result.sectionFile.includes("sections/Theme/") ||
      result.sectionFile.endsWith("sections/Component.tsx") ||
      result.sectionFile.endsWith("sections/Session.tsx") ||
      result.sectionFile.endsWith("sections/Component.tsx");

    if (result.unused && !isSpecialSection) {
      unusedSections.push(result);
      console.log(
        `⚠️  ${result.sectionFile} - não está sendo usada em nenhum JSON`,
      );
    } else if (result.totalErrors > 0) {
      sectionsWithErrors.push(result);
      console.log(
        `\n❌ ${result.sectionFile} - ${result.occurrences.length} ocorrência(s), ${result.totalErrors} erro(s)\n`,
      );

      // Agrupa por arquivo JSON
      const groupedByFile = new Map<string, typeof result.occurrences>();
      for (const occ of result.occurrences) {
        if (occ.errors.length > 0) {
          if (!groupedByFile.has(occ.jsonFile)) {
            groupedByFile.set(occ.jsonFile, []);
          }
          groupedByFile.get(occ.jsonFile)!.push(occ);
        }
      }

      // Mostra agrupado por arquivo
      for (const [jsonFile, occs] of groupedByFile) {
        console.log(`     📄 \x1b[1m${jsonFile}\x1b[0m\n`);

        // Itera pelas ocorrências e seus erros
        for (let occIndex = 0; occIndex < occs.length; occIndex++) {
          const occ = occs[occIndex];

          for (const error of occ.errors) {
            // Para propriedades ausentes, sempre usa a linha do __resolveType
            // Para outros erros (tipo errado, etc), tenta encontrar a linha específica
            const lineNum = occ.resolveTypeLine ?? null;

            const lineInfo = lineNum ? ` (${occ.jsonFilePath}:${lineNum})` : "";

            // Sempre mostra qual propriedade tem o problema
            const propertyName = error.path.replace(/^root\./, "");
            let message = error.message;

            if (error.message.includes("propriedade obrigatória ausente")) {
              message = `"${propertyName}": ${error.message}`;
            } else if (propertyName) {
              // Para outros erros (tipo errado, etc), mostra: "prop": mensagem
              message = `"${propertyName}": ${error.message}`;
            }

            console.log(`       - ${message}${lineInfo}`);
          }
        }
      }
    } else if (result.totalWarnings > 0) {
      sectionsWithWarnings.push(result);
      console.log(
        `\n⚠️  ${result.sectionFile} - ${result.occurrences.length} ocorrência(s), ${result.totalWarnings} warning(s)\n`,
      );

      // Agrupa por arquivo JSON
      const groupedByFile = new Map<string, typeof result.occurrences>();
      for (const occ of result.occurrences) {
        if (occ.warnings.length > 0) {
          if (!groupedByFile.has(occ.jsonFile)) {
            groupedByFile.set(occ.jsonFile, []);
          }
          groupedByFile.get(occ.jsonFile)!.push(occ);
        }
      }

      // Mostra agrupado por arquivo
      for (const [jsonFile, occs] of groupedByFile) {
        console.log(`     📄 \x1b[1m${jsonFile}\x1b[0m\n`);

        // Conta ocorrências da mesma propriedade para encontrar a linha correta
        const propertyOccurrences = new Map<string, number>();

        for (const occ of occs) {
          for (const warning of occ.warnings) {
            const occIndex = propertyOccurrences.get(warning.path) || 0;
            const lineNum = occ.jsonContent
              ? findPropertyLine(occ.jsonContent, warning.path, occIndex)
              : null;
            const lineInfo = lineNum ? ` (${occ.jsonFilePath}:${lineNum})` : "";

            // Sempre mostra qual propriedade tem o problema
            const propertyName = warning.path.replace(/^root\./, "");
            const message = propertyName
              ? `"${propertyName}": ${warning.message}`
              : warning.message;

            console.log(`       - ${message}${lineInfo}`);

            // Incrementa o contador para a próxima ocorrência dessa propriedade
            propertyOccurrences.set(warning.path, occIndex + 1);
          }
        }
        console.log();
      }
    }
  }

  // Resumo
  console.log("\n═══════════════════════════════════════");
  console.log("📊 RESUMO");
  console.log("═══════════════════════════════════════");
  console.log(`Total de sections/loaders: ${results.length}`);
  console.log(`Total de ocorrências: ${totalOccurrences}`);
  console.log(
    `✅ Sem problemas: ${
      results.length - sectionsWithErrors.length - sectionsWithWarnings.length -
      unusedSections.length
    }`,
  );
  console.log(`⚠️  Com warnings: ${sectionsWithWarnings.length}`);
  console.log(`⚠️  Não usadas: ${unusedSections.length}`);
  console.log(`❌ Com erros: ${sectionsWithErrors.length}`);

  if (unusedSections.length > 0) {
    console.log("\n⚠️  Sections não usadas:");
    for (const section of unusedSections) {
      console.log(`  - ${section.sectionFile}`);
    }
  }

  if (sectionsWithErrors.length > 0) {
    console.log("\n❌ Sections com erros:");
    for (const section of sectionsWithErrors) {
      console.log(
        `  - ${section.sectionFile} (${section.totalErrors} erro(s))`,
      );
    }
  }

  return sectionsWithErrors.length > 0;
}

/**
 * Retorna todos os arquivos de sections/loaders do projeto
 */
async function getAllSectionFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  const sectionsDir = join(projectRoot, "sections");
  const loadersDir = join(projectRoot, "loaders");

  for await (const entry of walk(sectionsDir, { exts: [".tsx", ".ts"] })) {
    if (entry.isFile) files.push(entry.path);
  }
  for await (const entry of walk(loadersDir, { exts: [".tsx", ".ts"] })) {
    if (entry.isFile) files.push(entry.path);
  }

  return files;
}

/**
 * Retorna o conjunto de sections que estão sendo usadas
 */
function getUsedSections(results: SectionValidationResult[]): Set<string> {
  const used = new Set<string>();
  for (const result of results) {
    if (result.occurrences.length > 0) {
      used.add(result.sectionFilePath); // Usa o caminho absoluto
    }
  }
  return used;
}

/**
 * Remove propriedades não definidas na tipagem dos arquivos JSON
 */
async function removeUnusedPropertiesFromJsons(
  validationResults: SectionValidationResult[],
): Promise<void> {
  console.log("\n🧹 Removendo propriedades não definidas...\n");

  let totalRemoved = 0;
  const modifiedFiles = new Map<string, Record<string, unknown>>();

  for (const result of validationResults) {
    for (const occ of result.occurrences) {
      const unusedWarnings = occ.warnings.filter((w) =>
        w.message.includes("propriedade não definida na tipagem")
      );

      if (unusedWarnings.length === 0) continue;

      const jsonPath = occ.jsonFilePath;

      // Lê o JSON se ainda não foi lido
      if (!modifiedFiles.has(jsonPath)) {
        const content = await Deno.readTextFile(jsonPath);
        modifiedFiles.set(jsonPath, JSON.parse(content));
      }

      const jsonData = modifiedFiles.get(jsonPath);
      if (!jsonData) continue;

      // Remove cada propriedade não utilizada
      for (const warning of unusedWarnings) {
        const propertyPath = warning.path.replace(/^root\./, "");
        if (
          removePropertyFromJson(jsonData, result.resolveType, propertyPath)
        ) {
          totalRemoved++;
        }
      }
    }
  }

  // Salva todos os JSONs modificados
  for (const [jsonPath, jsonData] of modifiedFiles) {
    await Deno.writeTextFile(
      jsonPath,
      JSON.stringify(jsonData, null, 2) + "\n",
    );
  }

  console.log(
    `\n✅ ${totalRemoved} propriedade(s) removida(s) de ${modifiedFiles.size} arquivo(s)\n`,
  );
}

/**
 * Remove uma propriedade específica de um JSON, procurando pelo __resolveType
 */
function removePropertyFromJson(
  obj: Record<string, unknown>,
  targetResolveType: string,
  propertyPath: string,
): boolean {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  // Se encontrou o __resolveType correto, remove a propriedade navegando pelo path
  if (obj.__resolveType === targetResolveType) {
    return removePropertyByPath(obj, propertyPath);
  }

  // Busca recursivamente
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "object" && item !== null) {
        if (
          removePropertyFromJson(
            item as Record<string, unknown>,
            targetResolveType,
            propertyPath,
          )
        ) {
          return true;
        }
      }
    }
  } else {
    for (const value of Object.values(obj)) {
      if (typeof value === "object" && value !== null) {
        if (
          removePropertyFromJson(
            value as Record<string, unknown>,
            targetResolveType,
            propertyPath,
          )
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Remove uma propriedade navegando pelo path (ex: "images[0].desktop")
 */
function removePropertyByPath(
  obj: Record<string, unknown>,
  path: string,
): boolean {
  // Parse o path para navegar corretamente
  // Ex: "images[0].desktop" -> ["images", "0", "desktop"]
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");

  let current: unknown = obj;

  // Navega até o penúltimo nível
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (typeof current !== "object" || current === null) {
      return false;
    }

    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || index >= current.length) {
        return false;
      }
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  // Remove a propriedade final
  const lastPart = parts[parts.length - 1];

  if (typeof current !== "object" || current === null) {
    return false;
  }

  if (Array.isArray(current)) {
    const index = parseInt(lastPart, 10);
    if (!isNaN(index) && index < current.length) {
      current.splice(index, 1);
      return true;
    }
  } else {
    const obj = current as Record<string, unknown>;
    if (lastPart in obj) {
      delete obj[lastPart];
      return true;
    }
  }

  return false;
}

/**
 * Remove arquivos de sections que não estão sendo usadas
 * (Loaders são ignorados pois podem ser importados em sections)
 */
async function removeUnusedSectionFiles(
  allSectionFiles: string[],
  usedSections: Set<string>,
): Promise<void> {
  console.log("\n🗑️  Removendo sections não utilizadas...\n");

  // Filtra apenas sections (não loaders, Theme, Component ou Session) não usadas
  const toRemove = allSectionFiles.filter((file) => {
    const isSpecialSection = file.includes("/sections/Theme/") ||
      file.endsWith("/sections/Component.tsx") ||
      file.endsWith("/sections/Session.tsx");

    return !usedSections.has(file) &&
      file.includes("/sections/") &&
      !isSpecialSection;
  });

  if (toRemove.length === 0) {
    console.log("✅ Nenhuma section não utilizada encontrada\n");
    return;
  }

  const projectRoot = Deno.cwd();

  console.log(`📋 ${toRemove.length} arquivo(s) serão removidos:\n`);
  for (const file of toRemove) {
    const relativePath = relative(projectRoot, file);
    console.log(`  - ${relativePath}`);
  }

  // Confirma remoção
  console.log("\n⚠️  Esta ação é irreversível!");
  console.log("Digite 'sim' para confirmar a remoção:");

  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  const confirmation = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim();

  if (confirmation.toLowerCase() === "sim") {
    let removed = 0;
    for (const file of toRemove) {
      try {
        await Deno.remove(file);
        removed++;
      } catch (error) {
        console.error(`❌ Erro ao remover ${file}: ${error.message}`);
      }
    }
    console.log(`\n✅ ${removed} arquivo(s) removido(s)\n`);
  } else {
    console.log("\n❌ Remoção cancelada\n");
  }
}
