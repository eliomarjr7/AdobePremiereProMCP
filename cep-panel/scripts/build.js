#!/usr/bin/env node

/**
 * Assemble the static CEP extension into dist/ without requiring a bundler.
 * CEP loads the manifest, HTML, JavaScript, and ExtendScript files directly.
 */

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var output = path.join(root, "dist");
var packageMode = process.argv.indexOf("--package") !== -1;
var developmentMode = process.argv.indexOf("--dev") !== -1;

var requiredPaths = [
    "CSXS/manifest.xml",
    "src/index.html",
    "src/panel.js",
    "src/CSInterface.js",
    "src/host/core.jsx",
    "src/host/premiere.jsx",
    "package.json",
    "package-lock.json",
    "node_modules/ws",
];

if (developmentMode) {
    requiredPaths.push(".debug");
}

requiredPaths.forEach(function (relativePath) {
    var source = path.join(root, relativePath);
    if (!fs.existsSync(source)) {
        throw new Error("Missing required CEP asset: " + relativePath);
    }
});

// Catch ordinary JavaScript syntax errors without attempting to parse
// ExtendScript-only syntax in the host .jsx files.
childProcess.execFileSync(process.execPath, ["--check", path.join(root, "src", "panel.js")], {
    stdio: "inherit",
});

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

["CSXS", "src", "node_modules/ws"].forEach(function (relativePath) {
    fs.cpSync(path.join(root, relativePath), path.join(output, relativePath), {
        recursive: true,
    });
});

["package.json", "package-lock.json"].forEach(function (relativePath) {
    fs.copyFileSync(path.join(root, relativePath), path.join(output, relativePath));
});

// Premiere 26.5+ fails $.evalFile on the 1.4 MB premiere.jsx as a single file.
// Split it at top-level function boundaries into ~120 KB parts; panel.js loads
// them in order (src/host/premiere_parts/pNN.jsx) and reports any load error.
(function splitPremiereJsx() {
    var hostDir = path.join(output, "src", "host");
    var source = fs.readFileSync(path.join(hostDir, "premiere.jsx"), "utf8");
    var lines = source.split("\n");
    var partsDir = path.join(hostDir, "premiere_parts");
    fs.mkdirSync(partsDir, { recursive: true });
    var parts = [], current = [], size = 0, LIMIT = 120 * 1024;
    lines.forEach(function (line) {
        if (size >= LIMIT && /^function [A-Za-z_$]/.test(line)) {
            parts.push(current.join("\n")); current = []; size = 0;
        }
        current.push(line); size += line.length + 1;
    });
    if (current.length) parts.push(current.join("\n"));
    parts.forEach(function (text, i) {
        fs.writeFileSync(path.join(partsDir, "p" + (i < 10 ? "0" : "") + i + ".jsx"), text);
    });
    // premiere.jsx itself becomes a tiny loader for the parts, so even an already-running
    // (older) panel that evalFile()s premiere.jsx picks up every function. Top-level code
    // (not wrapped in a function) so the parts are evaluated into the global scope.
    var loader = [
        "// Gerado por scripts/build.js — carrega premiere_parts/pNN.jsx (o arquivo inteiro de 1.4 MB",
        "// falha no $.evalFile do Premiere 26.5+). Erros por parte ficam em $.global.__mcpLoadErr.",
        "var __mcpBase = (new File($.fileName)).parent.fsName + '/premiere_parts/';",
        "var __mcpLoadErr = '';",
    ];
    parts.forEach(function (_, i) {
        var n = "p" + (i < 10 ? "0" : "") + i + ".jsx";
        loader.push("try { $.evalFile(__mcpBase + '" + n + "'); } catch (e) { __mcpLoadErr += '" + n + ": ' + e + ' (linha ' + e.line + '); '; }");
    });
    // Diagnóstico: grava o resultado do carregamento em ~/.premierpro-mcp/jsx-load.log
    loader.push("try { var __f = new File(Folder('~').fsName + '/.premierpro-mcp/jsx-load.log'); __f.open('w'); __f.write((new Date()).toString() + ' | mcpDispatch=' + (typeof mcpDispatch) + ' | erros: ' + (__mcpLoadErr || 'nenhum')); __f.close(); } catch (e2) {}");
    fs.writeFileSync(path.join(hostDir, "premiere.jsx"), loader.join("\n") + "\n");
    console.log("Split premiere.jsx into " + parts.length + " parts (premiere.jsx = loader)");
})();

// CEP's .debug file opens a local Chrome DevTools endpoint. Keep it out of
// production builds and packages; developers must opt in with --dev.
if (developmentMode) {
    fs.copyFileSync(path.join(root, ".debug"), path.join(output, ".debug"));
}

console.log(
    (developmentMode ? "Built development" : packageMode ? "Packaged" : "Built") +
        " static CEP extension at " +
        path.relative(process.cwd(), output),
);
