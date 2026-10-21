import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// The production-only failure left links intercepting clicks, while their
// dynamically imported navigation namespace no longer exposed its functions.
// Inspect the built JS contract without executing browser code or using a DOM.
const directory = resolve(process.argv[2] || "dist/client/_next/static/chunks");
const required = ["navigateClientSide", "getPrefetchInterceptionContext", "prefetchRscResponse"];
let valid = false;
for (const file of readdirSync(directory).filter(name => name.endsWith(".js"))) {
  const source = ts.createSourceFile(file, readFileSync(resolve(directory, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Set();
  const exported = new Set();
  const candidates = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.add(node.name.text);
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const entry of node.exportClause.elements) exported.add((entry.propertyName || entry.name).text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const object = node.initializer.arguments[0];
      if (object && ts.isObjectLiteralExpression(object)) candidates.push({ name: node.name.text, object });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const candidate of candidates) {
    if (!exported.has(candidate.name)) continue;
    const members = new Map(candidate.object.properties.filter(ts.isPropertyAssignment).map(property => [property.name.getText(source).replace(/^["'`]|["'`]$/g, ""), property.initializer]));
    if (required.every(name => {
      const value = members.get(name);
      return value && ts.isArrowFunction(value) && ts.isIdentifier(value.body) && functions.has(value.body.text);
    })) valid = true;
  }
}
if (!valid) {
  console.error("Production navigation contract failed: the Link navigation namespace lost its callable exports.");
  process.exitCode = 1;
} else console.log("Production navigation contract passed: link navigation and prefetch functions are exported.");
