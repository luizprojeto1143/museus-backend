import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const backendRoot = process.cwd();
const workspaceRoot = path.dirname(backendRoot);
const frontendRoot = path.join(workspaceRoot, "museus-frontend");
const backendSrc = path.join(backendRoot, "src");
const frontendSrc = path.join(frontendRoot, "src");
const reportsDir = path.join(backendRoot, "reports");

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".css", ".scss", ".html"]);
const FRONTEND_CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const BACKEND_CODE_EXTENSIONS = new Set([".ts", ".js", ".mjs"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".git", ".vite", "reports"]);
const IGNORED_FILE_PATTERNS = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)lint[-_a-z0-9]*\.json$/i,
  /(^|\/)lint_report.*\.json$/i,
  /(^|\/)audit[-_a-z0-9]*\.json$/i,
  /(^|\/)audit-system-inventory\.mjs$/i
];
const REAL_PENDING_KEYS = ["todo", "mock", "placeholder", "tsNocheck", "alertConfirm"];
const PENDING_PATTERNS = [
  { key: "todo", regex: /\bTODO\b|A FAZER|FIXME|XXX/gi },
  { key: "mock", regex: /\bmock\b|\bmockado\b|\bfake\b|\bdummy\b|\bsimulado\b/gi },
  { key: "placeholder", regex: /placeholder|coming soon|em breve|manutencao|manutenção/gi },
  { key: "tsNocheck", regex: /@ts-nocheck/g },
  { key: "alertConfirm", regex: /window\.alert|window\.confirm|\balert\(|\bconfirm\(/g },
  { key: "consoleError", regex: /console\.error/g },
  { key: "anyUnknown", regex: /:\s*unknown\b|:\s*any\b|<unknown>|<any>/g }
];

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      output.push(...walk(fullPath, predicate));
    } else if (!IGNORED_FILE_PATTERNS.some(pattern => pattern.test(rel(fullPath))) && predicate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function rel(filePath) {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function countMatches(source, regex) {
  const matches = source.match(regex);
  return matches ? matches.length : 0;
}

function normalizeApiPath(apiPath) {
  return apiPath
    .replace(/`/g, "")
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/\/+/g, "/")
    .replace(/\?.*$/, "")
    .replace(/\/$/, "") || "/";
}

function normalizeBackendPath(routePath) {
  return routePath
    .replace(/\/+/g, "/")
    .replace(/\?.*$/, "")
    .replace(/\/$/, "") || "/";
}

function joinRoute(prefix, routePath) {
  const left = prefix === "/" ? "" : prefix;
  const right = routePath === "/" ? "" : routePath;
  return normalizeBackendPath(`/${left}/${right}`);
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ""));
  for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
    const candidate = path.join(base, `index${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseIndexMounts() {
  const indexPath = path.join(backendSrc, "index.ts");
  const source = read(indexPath);
  const imports = new Map();
  for (const line of source.split(/\r?\n/)) {
    const importMatch = line.match(/^\s*import\s+(.+?)\s+from\s+["'](.+?)["'];?\s*$/);
    if (!importMatch) continue;
    const resolved = resolveImport(indexPath, importMatch[2]);
    if (!resolved) continue;
    const clause = importMatch[1].trim();
    const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)(?:\s*,|\s*$)/);
    if (defaultMatch) imports.set(defaultMatch[1], resolved);
    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      for (const rawName of namedMatch[1].split(",")) {
        const [imported, alias] = rawName.trim().split(/\s+as\s+/);
        const localName = (alias || imported || "").trim();
        if (localName) imports.set(localName, resolved);
      }
    }
  }

  const mounts = [];
  for (const line of source.split(/\r?\n/)) {
    const mountMatch = line.match(/app\.use\(\s*(?:["'`]([^"'`]+)["'`]\s*,\s*)?([A-Za-z_$][\w$]*)/);
    if (!mountMatch) continue;
    const filePath = imports.get(mountMatch[2]);
    if (filePath) mounts.push({ prefix: normalizeBackendPath(mountMatch[1] || "/"), variableName: mountMatch[2], filePath });
  }
  return mounts;
}

function collectBackendRoutes() {
  const routes = [];
  for (const mount of parseIndexMounts()) {
    const source = read(mount.filePath);
    const routeRegex = /(?:router|app|[A-Za-z_$][\w$]*Router)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
    let match;
    while ((match = routeRegex.exec(source))) {
      routes.push({
        method: match[1].toUpperCase(),
        path: joinRoute(mount.prefix, normalizeBackendPath(match[3])),
        mount: mount.prefix,
        file: rel(mount.filePath),
        line: lineOf(source, match.index)
      });
    }
  }
  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function collectFrontendCalls(files) {
  const calls = [];
  const apiRegex = /\bapi\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
  for (const filePath of files) {
    const source = read(filePath);
    let match;
    while ((match = apiRegex.exec(source))) {
      if (!match[3].startsWith("/")) continue;
      calls.push({
        method: match[1].toUpperCase(),
        path: normalizeApiPath(match[3]),
        rawPath: match[3],
        file: rel(filePath),
        line: lineOf(source, match.index)
      });
    }
  }
  return calls;
}

function pathsCompatible(callPath, routePath) {
  const callSegments = callPath.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);
  if (callSegments.length !== routeSegments.length) return false;
  return callSegments.every((segment, index) => {
    const routeSegment = routeSegments[index];
    return segment === routeSegment || segment.startsWith(":") || routeSegment.startsWith(":") || routeSegment === "*";
  });
}

function routeUsed(route, calls) {
  return calls.some(call => call.method === route.method && pathsCompatible(call.path, route.path));
}

function collectFrontendScreens(files) {
  const routeFiles = files.filter(file => rel(file).startsWith("museus-frontend/src/routes/"));
  const screens = [];
  const routeRegex = /<Route\s+[^>]*path=["']([^"']+)["'][^>]*element=\{([^}]+)\}/g;
  for (const filePath of routeFiles) {
    const source = read(filePath);
    let match;
    while ((match = routeRegex.exec(source))) {
      screens.push({ path: match[1], element: match[2].slice(0, 180), file: rel(filePath), line: lineOf(source, match.index) });
    }
  }
  return screens.sort((a, b) => a.path.localeCompare(b.path));
}

function collectForms(files) {
  const forms = [];
  for (const filePath of files) {
    const source = read(filePath);
    const formCount = countMatches(source, /<form\b/gi);
    const submitHandlers = countMatches(source, /onSubmit\s*=|handleSubmit|handleSave|handleCreate|handleUpdate|handleDelete|handleSubscribe|handleApply/gi);
    const inputCount = countMatches(source, /<input\b|<textarea\b|<select\b/gi);
    const apiMutations = countMatches(source, /\bapi\.(post|put|patch|delete)\(/g);
    if (formCount || inputCount || submitHandlers || apiMutations) {
      forms.push({
        file: rel(filePath),
        formCount,
        inputCount,
        submitHandlers,
        apiMutations,
        hasZod: /zod|z\./.test(source),
        hasToast: /toast\.|useToast|Toast/.test(source),
        hasLoading: /loading|isLoading|setLoading|disabled=/.test(source),
        hasErrorState: /error|catch\(|toast\.error/.test(source)
      });
    }
  }
  return forms.sort((a, b) => b.apiMutations - a.apiMutations || b.inputCount - a.inputCount);
}

function collectScreenFiles(files) {
  return files
    .filter(filePath => {
      const normalized = rel(filePath);
      return (
        /museus-frontend\/src\/modules\/.+\/pages\/.+\.tsx$/.test(normalized) ||
        /museus-frontend\/src\/modules\/(auth|public)\/.+\.tsx$/.test(normalized)
      );
    })
    .map(filePath => {
      const source = read(filePath);
      return {
        file: rel(filePath),
        apiCalls: countMatches(source, /\bapi\.(get|post|put|patch|delete)\(/g),
        apiMutations: countMatches(source, /\bapi\.(post|put|patch|delete)\(/g),
        formCount: countMatches(source, /<form\b/gi),
        inputCount: countMatches(source, /<input\b|<textarea\b|<select\b/gi),
        submitHandlers: countMatches(source, /onSubmit\s*=|handleSubmit|handleSave|handleCreate|handleUpdate|handleDelete|handleSubscribe|handleApply/gi),
        tsNocheck: /@ts-nocheck/.test(source),
        hasZod: /zod|z\./.test(source)
      };
    })
    .sort((a, b) => b.apiMutations - a.apiMutations || b.inputCount - a.inputCount || a.file.localeCompare(b.file));
}

function collectPendingMarkers(files) {
  const markers = [];
  for (const filePath of files) {
    const ext = path.extname(filePath);
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const source = read(filePath);
    const counts = {};
    let total = 0;
    for (const pattern of PENDING_PATTERNS) {
      const count = countMatches(source, pattern.regex);
      if (count) {
        counts[pattern.key] = count;
        total += count;
      }
    }
    const realPendingTotal = REAL_PENDING_KEYS.reduce((sum, key) => sum + (counts[key] || 0), 0);
    const technicalDebtTotal = total - realPendingTotal;
    if (total) markers.push({ file: rel(filePath), total, realPendingTotal, technicalDebtTotal, ...counts });
  }
  return markers.sort((a, b) => b.realPendingTotal - a.realPendingTotal || b.total - a.total);
}

function moduleFromFile(file) {
  const normalized = file.replace(/\\/g, "/");
  const frontendMatch = normalized.match(/museus-frontend\/src\/modules\/([^/]+)(?:\/([^/]+))?/);
  if (frontendMatch) return `frontend:${frontendMatch[1]}${frontendMatch[2] ? `/${frontendMatch[2]}` : ""}`;
  const backendDomainMatch = normalized.match(/museus-backend\/src\/domains\/([^/]+)(?:\/([^/]+))?/);
  if (backendDomainMatch) return `backend:${backendDomainMatch[1]}${backendDomainMatch[2] ? `/${backendDomainMatch[2]}` : ""}`;
  const backendRouteMatch = normalized.match(/museus-backend\/src\/routes\/([^/]+)/);
  if (backendRouteMatch) return `backend:routes/${backendRouteMatch[1].replace(/\.(ts|js)$/, "")}`;
  return normalized.split("/").slice(0, 3).join("/");
}

function aggregateByModule({ routes, calls, screens, screenFiles, forms, markers }) {
  const modules = new Map();
  function ensure(name) {
    if (!modules.has(name)) modules.set(name, { module: name, routes: 0, calls: 0, routeDeclarations: 0, screenFiles: 0, forms: 0, pendingMarkers: 0, realPendingMarkers: 0, mutations: 0 });
    return modules.get(name);
  }
  for (const route of routes) ensure(moduleFromFile(route.file)).routes++;
  for (const call of calls) ensure(moduleFromFile(call.file)).calls++;
  for (const screen of screens) ensure(moduleFromFile(screen.file)).routeDeclarations++;
  for (const screenFile of screenFiles) ensure(moduleFromFile(screenFile.file)).screenFiles++;
  for (const form of forms) {
    const item = ensure(moduleFromFile(form.file));
    item.forms++;
    item.mutations += form.apiMutations;
  }
  for (const marker of markers) {
    const item = ensure(moduleFromFile(marker.file));
    item.pendingMarkers += marker.total;
    item.realPendingMarkers += marker.realPendingTotal || 0;
  }
  return Array.from(modules.values()).sort((a, b) => b.realPendingMarkers - a.realPendingMarkers || b.forms - a.forms);
}

function writeMarkdown(report) {
  const topMarkers = report.pendingMarkers.slice(0, 40);
  const topForms = report.forms.slice(0, 60);
  const topScreens = report.screenFiles.slice(0, 80);
  const modules = report.modules.slice(0, 80);
  const unusedRoutes = report.unusedBackendRoutes.slice(0, 80);
  const screensWithoutApi = report.screenFiles.filter(screen => screen.apiCalls === 0).slice(0, 80);

  const lines = [
    "# Auditoria Geral do Sistema",
    "",
    `Gerado em: ${report.generatedAt}`,
    "",
    "## Resumo",
    "",
    `- Arquivos backend analisados: ${report.summary.backendFiles}`,
    `- Arquivos frontend analisados: ${report.summary.frontendFiles}`,
    `- Rotas backend montadas: ${report.summary.backendRoutes}`,
    `- Chamadas API no frontend: ${report.summary.frontendCalls}`,
    `- Chamadas API sem rota backend: ${report.summary.unmatchedFrontendCalls}`,
    `- Rotas backend sem chamada frontend direta: ${report.summary.unusedBackendRoutes}`,
    `- Telas/rotas frontend detectadas: ${report.summary.frontendScreens}`,
    `- Arquivos de tela/pagina detectados: ${report.summary.frontendScreenFiles}`,
    `- Arquivos com formulario ou mutacao: ${report.summary.formFiles}`,
    `- Arquivos com marcadores pendentes: ${report.summary.pendingFiles}`,
    `- Marcadores funcionais reais: ${report.summary.realPendingMarkers}`,
    `- Marcadores de divida tecnica: ${report.summary.technicalDebtMarkers}`,
    "",
    "## Modulos Com Mais Sinais de Pendencia",
    "",
    "| Modulo | Rotas | Chamadas | Rotas front | Telas | Forms | Mutacoes | Pendencias reais | Total sinais |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...modules.map(item => `| ${item.module} | ${item.routes} | ${item.calls} | ${item.routeDeclarations} | ${item.screenFiles} | ${item.forms} | ${item.mutations} | ${item.realPendingMarkers} | ${item.pendingMarkers} |`),
    "",
    "## Chamadas Frontend Sem Backend",
    "",
    report.unmatchedFrontendCalls.length
      ? report.unmatchedFrontendCalls.map(call => `- ${call.method} ${call.rawPath} em ${call.file}:${call.line}`).join("\n")
      : "- Nenhuma chamada orfa detectada pelo auditor.",
    "",
    "## Rotas Backend Sem Chamada Frontend Direta",
    "",
    ...unusedRoutes.map(route => `- ${route.method} ${route.path} em ${route.file}:${route.line}`),
    "",
    "## Telas/Paginas Mais Sensíveis",
    "",
    "| Arquivo | APIs | Mutacoes | Forms | Inputs | Handlers | ts-nocheck | Zod |",
    "|---|---:|---:|---:|---:|---:|---|---|",
    ...topScreens.map(screen => `| ${screen.file} | ${screen.apiCalls} | ${screen.apiMutations} | ${screen.formCount} | ${screen.inputCount} | ${screen.submitHandlers} | ${screen.tsNocheck ? "sim" : "nao"} | ${screen.hasZod ? "sim" : "nao"} |`),
    "",
    "## Telas Sem Chamada API Direta no Proprio Arquivo",
    "",
    ...screensWithoutApi.map(screen => `- ${screen.file}`),
    "",
    "## Formularios e Mutacoes Para Revisao",
    "",
    "| Arquivo | Forms | Inputs | Handlers | Mutacoes | Loading | Erro | Toast | Zod |",
    "|---|---:|---:|---:|---:|---|---|---|---|",
    ...topForms.map(form => `| ${form.file} | ${form.formCount} | ${form.inputCount} | ${form.submitHandlers} | ${form.apiMutations} | ${form.hasLoading ? "sim" : "nao"} | ${form.hasErrorState ? "sim" : "nao"} | ${form.hasToast ? "sim" : "nao"} | ${form.hasZod ? "sim" : "nao"} |`),
    "",
    "## Marcadores Pendentes/Mocagem/Placeholder",
    "",
    "| Arquivo | Real | Tecnico | Total | TODO | Mock | Placeholder | ts-nocheck | alert/confirm | any/unknown |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...topMarkers.map(marker => `| ${marker.file} | ${marker.realPendingTotal} | ${marker.technicalDebtTotal} | ${marker.total} | ${marker.todo || 0} | ${marker.mock || 0} | ${marker.placeholder || 0} | ${marker.tsNocheck || 0} | ${marker.alertConfirm || 0} | ${marker.anyUnknown || 0} |`),
    ""
  ];
  return lines.join("\n");
}

function main() {
  fs.mkdirSync(reportsDir, { recursive: true });
  const backendFiles = walk(backendSrc, file => BACKEND_CODE_EXTENSIONS.has(path.extname(file)));
  const frontendFiles = walk(frontendSrc, file => FRONTEND_CODE_EXTENSIONS.has(path.extname(file)));
  const allTextFiles = [
    ...walk(backendRoot, file => TEXT_EXTENSIONS.has(path.extname(file))),
    ...walk(frontendRoot, file => TEXT_EXTENSIONS.has(path.extname(file)))
  ];

  const routes = collectBackendRoutes();
  const calls = collectFrontendCalls(frontendFiles);
  const unmatchedFrontendCalls = calls.filter(call => !routes.some(route => call.method === route.method && pathsCompatible(call.path, route.path)));
  const unusedBackendRoutes = routes.filter(route => !routeUsed(route, calls));
  const screens = collectFrontendScreens(frontendFiles);
  const screenFiles = collectScreenFiles(frontendFiles);
  const forms = collectForms(frontendFiles);
  const pendingMarkers = collectPendingMarkers(allTextFiles);
  const modules = aggregateByModule({ routes, calls, screens, screenFiles, forms, markers: pendingMarkers });
  const realPendingMarkers = pendingMarkers.reduce((sum, marker) => sum + marker.realPendingTotal, 0);
  const technicalDebtMarkers = pendingMarkers.reduce((sum, marker) => sum + marker.technicalDebtTotal, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      backendFiles: backendFiles.length,
      frontendFiles: frontendFiles.length,
      backendRoutes: routes.length,
      frontendCalls: calls.length,
      unmatchedFrontendCalls: unmatchedFrontendCalls.length,
      unusedBackendRoutes: unusedBackendRoutes.length,
      frontendScreens: screens.length,
      frontendScreenFiles: screenFiles.length,
      formFiles: forms.length,
      pendingFiles: pendingMarkers.length,
      realPendingMarkers,
      technicalDebtMarkers
    },
    routes,
    frontendCalls: calls,
    unmatchedFrontendCalls,
    unusedBackendRoutes,
    screens,
    screenFiles,
    forms,
    pendingMarkers,
    modules
  };

  const jsonPath = path.join(reportsDir, "system-inventory-audit.json");
  const mdPath = path.join(reportsDir, "SYSTEM_INVENTORY_AUDIT.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, writeMarkdown(report));

  console.log(`Backend files: ${report.summary.backendFiles}`);
  console.log(`Frontend files: ${report.summary.frontendFiles}`);
  console.log(`Backend routes: ${report.summary.backendRoutes}`);
  console.log(`Frontend API calls: ${report.summary.frontendCalls}`);
  console.log(`Unmatched frontend calls: ${report.summary.unmatchedFrontendCalls}`);
  console.log(`Unused backend routes: ${report.summary.unusedBackendRoutes}`);
  console.log(`Frontend screens: ${report.summary.frontendScreens}`);
  console.log(`Frontend screen files: ${report.summary.frontendScreenFiles}`);
  console.log(`Form/mutation files: ${report.summary.formFiles}`);
  console.log(`Pending marker files: ${report.summary.pendingFiles}`);
  console.log(`Real pending markers: ${report.summary.realPendingMarkers}`);
  console.log(`Technical debt markers: ${report.summary.technicalDebtMarkers}`);
  console.log(`JSON: ${path.relative(backendRoot, jsonPath).replace(/\\/g, "/")}`);
  console.log(`Markdown: ${path.relative(backendRoot, mdPath).replace(/\\/g, "/")}`);
}

main();
