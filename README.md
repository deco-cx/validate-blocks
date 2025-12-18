# Section Checker

Script para validar se todas as ocorrências de Sections e Loaders (em blocos e
páginas) estão com estrutura de dados compatível com suas tipagens TypeScript.

## Como usar

### Validar todas as sections e loaders:

```bash
deno task validate-blocks
```

### Validar uma section específica:

```bash
deno task validate-blocks sections/Footer/Footer.tsx
```

ou

```bash
deno task validate-blocks sections/Category/CategoryGrid.tsx
```

Você pode usar caminho relativo ou absoluto.

### Usar pasta de blocos customizada:

Por padrão, o script busca os JSONs em `.deco/blocks`. Você pode especificar outro caminho:

```bash
deno task validate-blocks --blocks-dir /caminho/completo/para/jsons
```

ou

```bash
deno task validate-blocks sections/Footer/Footer.tsx --blocks-dir /outro/projeto/.deco/blocks
```

Isso permite rodar o script em um projeto e validar os blocos de outro projeto.

### Flags disponíveis:

#### `--include-unused-vars`

**Por padrão**, o script **não** mostra warnings de propriedades não definidas na tipagem. Use esta flag para incluí-las:

```bash
deno task validate-blocks --include-unused-vars
```

ou

```bash
deno task validate-blocks sections/Footer/Footer.tsx --include-unused-vars
```

#### `--blocks-dir <caminho>`

Especifica um caminho customizado para a pasta contendo os blocos JSON. Por padrão usa `.deco/blocks`:

```bash
deno task validate-blocks --blocks-dir /caminho/completo/para/jsons
```

ou combinado com outras flags:

```bash
deno task validate-blocks sections/Footer/Footer.tsx --blocks-dir /outro/projeto/.deco/blocks --include-unused-vars
```

#### `--remove-unused-vars`

**⚠️ CUIDADO: Modifica arquivos JSON automaticamente!**

Remove todas as propriedades que não estão definidas na tipagem:

```bash
deno task validate-blocks --remove-unused-vars
```

ou para uma section específica:

```bash
deno task validate-blocks sections/Footer/Footer.tsx --remove-unused-vars
```

O script:

1. Identifica propriedades no JSON que não existem na interface `Props`
2. Remove essas propriedades automaticamente
3. Salva o arquivo JSON modificado

**Exemplo:**

Se o JSON tem:

```json
{
  "__resolveType": "site/sections/Footer/Footer.tsx",
  "title": "Footer",
  "teste": "valor não usado" // <- não está na interface Props
}
```

Após rodar `--remove-unused-vars`, o JSON fica:

```json
{
  "__resolveType": "site/sections/Footer/Footer.tsx",
  "title": "Footer"
}
```

#### `--remove-unused-sections`

**⚠️ CUIDADO: Deleta arquivos permanentemente!**

Remove todos os arquivos de sections/loaders que não estão sendo referenciados
em nenhum JSON:

```bash
deno task validate-blocks --remove-unused-sections
```

O script:

1. Identifica sections/loaders que não têm nenhuma ocorrência nos JSONs
2. Lista os arquivos que serão removidos
3. Pede confirmação (digite `sim` para confirmar)
4. Deleta os arquivos permanentemente

**Exemplo de output:**

```
🗑️  Removendo sections/loaders não utilizadas...

📋 15 arquivo(s) serão removidos:

  - sections/Category/CategoryGrid.tsx
  - sections/Institutional/NumbersWithImage.tsx
  - sections/Product/ProductShelf.tsx
  ...

⚠️  Esta ação é irreversível!
Digite 'sim' para confirmar a remoção:
```

**Nota:** Esta flag só funciona na validação completa (sem especificar arquivo),
não funciona ao validar uma section específica.

## O que faz

O script:

1. **Itera por todos os arquivos** em `sections/` e `loaders/`
2. **Gera o `__resolveType`** de cada section/loader
3. **Busca TODAS as ocorrências** desse `__resolveType` em `.deco/blocks`
   (incluindo dentro de páginas)
4. **Extrai a interface Props** do arquivo TypeScript
5. **Valida profundamente** cada ocorrência contra a tipagem
6. **Reporta erros e warnings** com caminho exato no JSON

## Funcionalidades

### Detecção Inteligente de Props

- ✅ Segue **re-exports** (`export { default } from "./outro-arquivo"`)
- ✅ Extrai tipo do **parâmetro do componente** exportado como default
- ✅ Fallback para interface/type chamada **"Props"**
- ✅ Suporta **type aliases** e **interfaces**
- ✅ Suporta **utility types** (Omit, Pick, Partial)

### Validação Profunda

- ✅ Tipos primitivos: `string`, `number`, `boolean`, `null`
- ✅ Arrays com validação de elementos
- ✅ Objetos nested recursivamente
- ✅ Propriedades opcionais (`?`)
- ✅ Union types (`string | number`)
- ✅ Tipos especiais: `ImageWidget`, `Product`, `RichText`, etc
- ✅ Respeita anotação `@ignore` em propriedades
- ⚠️ **Detecta propriedades extras** não definidas na tipagem (warnings)

### Proteções

- ✅ Ignora blocos de apps externos (vtex, commerce, shopify, etc)
- ✅ Ignora blocos de Theme
- ✅ Proteção contra recursão infinita em tipos circulares

### Sistema de Severidade

- **✅ Válido** - Bloco está correto
- **⚠️ Warning** - Props não encontrada OU propriedades extras não definidas na
  tipagem OU section não está sendo usada (não falha o build)
- **❌ Erro** - Propriedades obrigatórias ausentes ou tipos incorretos (falha o
  build)

## Estrutura dos Arquivos

```
validate-blocks/
├── main.ts              # Entrypoint principal
├── src/
│   ├── type-mapper.ts   # Mapeia __resolveType para caminhos
│   ├── ts-parser.ts     # Parser TypeScript (extrai Props)
│   ├── validator.ts     # Validador recursivo de tipos
│   └── validate-blocks.ts # Orquestrador e relatório
└── README.md            # Esta documentação
```

## Output Exemplo

```
🔍 Validando sections e loaders...

✅ sections/Header/Header.tsx - 15 ocorrência(s)
✅ sections/Footer/Footer.tsx - 1 ocorrência(s)

⚠️  sections/Footer/Footer.tsx - 1 ocorrência(s), 2 warning(s)

Footer.json

  - propriedade não definida na tipagem (pode ser removida) (.deco/blocks/Footer.json:265)
  - propriedade não definida na tipagem (pode ser removida) (.deco/blocks/Footer.json:273)

❌ sections/Category/CategoryGrid.tsx - 1 ocorrência(s), 1 erro(s)

Preview%20%2Fsections%2FCategory%2FCategoryGrid.tsx.json

  - "items": propriedade obrigatória ausente (.deco/blocks/Preview%20%2Fsections%2FCategory%2FCategoryGrid.tsx.json:2)

❌ sections/Sac/Stores.tsx - 2 ocorrência(s), 2 erro(s)

pages-Lojas-735837.json

  - esperado array, recebido object (.deco/blocks/pages-Lojas-735837.json:57)
  - esperado array, recebido object (.deco/blocks/pages-Lojas-735837.json:73)

═══════════════════════════════════════
📊 RESUMO
═══════════════════════════════════════
Total de sections/loaders: 95
Total de ocorrências: 284
✅ Sem problemas: 85
⚠️ Com warnings: 3
⚠️ Não usadas: 3
❌ Com erros: 4

⚠️  Sections não usadas:
  - sections/Example/Unused.tsx
  - sections/Test/OldComponent.tsx

❌ Sections com erros:
  - sections/Category/CategoryGrid.tsx (1 erro(s))
```

**Nota:** O script mostra o caminho e linha do arquivo JSON no formato clicável
(ex: `.deco/blocks/pages-Lojas-735837.json:61`). Na maioria dos terminais
modernos (VSCode, Cursor, iTerm2), você pode clicar diretamente no link para
abrir o arquivo na linha exata do problema.

## Exemplos de Uso

### Validar todas as sections

```bash
deno task validate-blocks
```

### Validar section específica durante desenvolvimento

```bash
deno task validate-blocks sections/Header/Header.tsx
```

### Validar loader específico

```bash
deno task validate-blocks loaders/Product/categoryTabs.ts
```

### Ignorar propriedades não usadas

```bash
# Todas as sections sem warnings de props extras
deno task validate-blocks --ignore-unused-props

# Section específica sem warnings de props extras
deno task validate-blocks sections/Footer/Footer.tsx --ignore-unused-props
```

## Portabilidade

Todo o código está organizado na pasta `src` para facilitar migração
para outro repositório.
