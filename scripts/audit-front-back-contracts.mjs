import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const backendRoot = process.cwd();
const workspaceRoot = path.dirname(backendRoot);
const frontendRoot = path.join(workspaceRoot, "museus-frontend");
const backendSrc = path.join(backendRoot, "src");
const frontendSrc = path.join(frontendRoot, "src");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const BACKEND_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];

  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", "coverage", ".git"].includes(entry.name)) continue;
      output.push(...walk(fullPath, predicate));
    } else if (predicate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
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
  for (const extension of BACKEND_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const extension of BACKEND_EXTENSIONS) {
    const candidate = path.join(base, `index${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function parseIndexMounts(indexPath) {
  const source = read(indexPath);
  const imports = new Map();
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    const importMatch = line.match(/^\s*import\s+(.+?)\s+from\s+["'](.+?)["'];?\s*$/);
    if (!importMatch) continue;

    const clause = importMatch[1].trim();
    const specifier = importMatch[2];
    const resolved = resolveImport(indexPath, specifier);
    if (!resolved) continue;

    const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)(?:\s*,|\s*$)/);
    if (defaultMatch) {
      imports.set(defaultMatch[1], resolved);
    }

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
  const mountedVariables = new Set();

  for (const line of lines) {
    const mountMatch = line.match(/app\.use\(\s*(?:["'`]([^"'`]+)["'`]\s*,\s*)?([A-Za-z_$][\w$]*)/);
    if (!mountMatch) continue;

    const prefix = normalizeBackendPath(mountMatch[1] || "/");
    const variableName = mountMatch[2];
    const filePath = imports.get(variableName);
    if (!filePath) continue;

    mountedVariables.add(variableName);
    mounts.push({ prefix, variableName, filePath });
  }

  return { mounts, mountedVariables };
}

function parseRouterRoutes(filePath, prefix) {
  const source = read(filePath);
  const routes = [];
  const routeRegex = /(?:router|app|[A-Za-z_$][\w$]*Router)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
  let match;

  while ((match = routeRegex.exec(source))) {
    const method = match[1].toUpperCase();
    const routePath = normalizeBackendPath(match[3]);
    routes.push({
      method,
      path: joinRoute(prefix, routePath),
      file: path.relative(workspaceRoot, filePath).replace(/\\/g, "/"),
    });
  }

  return routes;
}

function collectBackendRoutes() {
  const indexPath = path.join(backendSrc, "index.ts");
  const { mounts } = parseIndexMounts(indexPath);
  const routes = [];

  for (const mount of mounts) {
    routes.push(...parseRouterRoutes(mount.filePath, mount.prefix));
  }

  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function collectFrontendCalls() {
  const files = walk(frontendSrc, (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath));
  const calls = [];
  const apiRegex = /\bapi\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;

  for (const filePath of files) {
    const source = read(filePath);
    let match;
    while ((match = apiRegex.exec(source))) {
      const method = match[1].toUpperCase();
      const rawPath = match[3];

      if (!rawPath.startsWith("/")) continue;

      const before = source.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      calls.push({
        method,
        path: normalizeApiPath(rawPath),
        rawPath,
        file: path.relative(workspaceRoot, filePath).replace(/\\/g, "/"),
        line,
      });
    }
  }

  return calls.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));
}

function matchRoute(call, routes) {
  return routes.find((route) => route.method === call.method && pathsCompatible(call.path, route.path));
}

function pathsCompatible(callPath, routePath) {
  const callSegments = callPath.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);

  if (callSegments.length !== routeSegments.length) return false;

  return callSegments.every((callSegment, index) => {
    const routeSegment = routeSegments[index];
    return callSegment === routeSegment || callSegment.startsWith(":") || routeSegment.startsWith(":") || routeSegment === "*";
  });
}

function main() {
  const backendRoutes = collectBackendRoutes();
  const frontendCalls = collectFrontendCalls();
  const unmatched = frontendCalls.filter((call) => !matchRoute(call, backendRoutes));

  const report = {
    generatedAt: new Date().toISOString(),
    backendRoutes: backendRoutes.length,
    frontendCalls: frontendCalls.length,
    unmatchedCalls: unmatched.length,
    routes: backendRoutes,
    unmatched,
  };

  const reportDir = path.join(backendRoot, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "front-back-contract-audit.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Backend routes: ${backendRoutes.length}`);
  console.log(`Frontend API calls: ${frontendCalls.length}`);
  console.log(`Unmatched calls: ${unmatched.length}`);
  console.log(`Report: ${path.relative(backendRoot, reportPath).replace(/\\/g, "/")}`);

  if (unmatched.length) {
    console.log("\nTop unmatched calls:");
    for (const call of unmatched.slice(0, 40)) {
      console.log(`- ${call.method} ${call.path} :: ${call.file}:${call.line}`);
    }
  }
}

main();
