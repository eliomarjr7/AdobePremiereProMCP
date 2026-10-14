/**
 * Recuperação da ponte CEP quando a porta 9801 não responde (macOS).
 *
 * Arquitetura (desde 13/10/2026): o servidor roda na extensão INVISÍVEL "com.premierpro.mcp.bridge.service"
 * (StartOn ApplicationActivate, sem janela). O painel visível "com.premierpro.mcp.bridge" é só monitor/vigia
 * e reinicia o serviço sozinho. Esta função é o último recurso, do lado de fora:
 *  - NUNCA encerra um processo que ainda está subindo (< 90 s de vida) — em 13/10 a versão antiga matava o
 *    painel durante a abertura do Premiere e piorava tudo;
 *  - se o serviço existe há > 90 s e a porta segue fechada → encerra só o processo do serviço;
 *  - em seguida reativa o Premiere: como o serviço não tem janela, o evento ApplicationActivate o sobe de novo.
 */
import { execFileSync } from "node:child_process";

const SERVICE_ID = "com.premierpro.mcp.bridge.service";
const PANEL_ID = "com.premierpro.mcp.bridge";
const MIN_INTERVAL_MS = 60_000;
const MIN_AGE_S = 90;
let lastAttempt = 0;

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
  } catch {
    return "";
  }
}

/** Caminho do .app do Premiere em execução (ou "" se não estiver aberto). */
function premiereAppPath(): string {
  const out = sh("pgrep", ["-fl", "Adobe Premiere Pro"]);
  for (const line of out.split("\n")) {
    const m = line.match(/(\/Applications\/.+?\.app)\/Contents\/MacOS\/Adobe Premiere Pro[^/]*$/);
    if (m) return m[1];
  }
  return "";
}

/** PIDs do CEPHtmlEngine principal de uma extensão (não os helpers). */
function enginePids(extId: string): number[] {
  return sh("pgrep", ["-fl", "CEPHtmlEngine"])
    .split("\n")
    .filter((l) => l.includes(` ${extId} `) && !l.includes("Helper"))
    .map((l) => parseInt(l.trim().split(/\s+/)[0], 10))
    .filter((n) => Number.isFinite(n));
}

/** Segundos de vida de um processo. */
function ageSeconds(pid: number): number {
  const v = parseInt(sh("ps", ["-o", "etimes=", "-p", String(pid)]).trim(), 10);
  return Number.isFinite(v) ? v : 0;
}

function portOpen(port: number): boolean {
  return sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).trim().length > 0;
}

export interface RecoveryResult {
  attempted: boolean;
  reason: string;
}

export async function recoverCepPanel(port = 9801, waitMs = 30_000): Promise<RecoveryResult> {
  if (process.platform !== "darwin") return { attempted: false, reason: "só macOS" };
  if (portOpen(port)) return { attempted: false, reason: "porta já aberta" };
  const app = premiereAppPath();
  if (!app) return { attempted: false, reason: "Premiere não está aberto" };
  const now = Date.now();
  if (now - lastAttempt < MIN_INTERVAL_MS) return { attempted: false, reason: "tentativa recente" };

  const svc = enginePids(SERVICE_ID);
  const novos = [...svc, ...enginePids(PANEL_ID)].filter((p) => ageSeconds(p) < MIN_AGE_S);
  if (novos.length) return { attempted: false, reason: `ponte ainda subindo (${novos.length} processo(s) com menos de ${MIN_AGE_S} s) — aguarde` };
  lastAttempt = now;

  const mortos: number[] = [];
  for (const pid of svc) {
    try {
      process.kill(pid, "SIGTERM");
      mortos.push(pid);
    } catch {
      /* já morreu */
    }
  }
  await new Promise((r) => setTimeout(r, 2500));
  // Serviço sem janela: reativar o Premiere dispara ApplicationActivate e o serviço sobe de novo.
  sh("osascript", ["-e", 'tell application "Finder" to activate']);
  await new Promise((r) => setTimeout(r, 800));
  sh("open", ["-a", app]);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (portOpen(port)) return { attempted: true, reason: `serviço reiniciado (encerrados: ${mortos.join(",") || "nenhum"})` };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { attempted: true, reason: "serviço reiniciado, mas a porta não abriu a tempo — abra Janela > Extensões > PremierPro MCP Bridge" };
}
