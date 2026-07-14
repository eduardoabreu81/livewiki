/** Combine the versioned mechanical analysis with v11-only run gates. */
import fs from "node:fs";
import path from "node:path";

const artifactRoot = path.resolve(process.argv[2]);
const proxyDiedMidBatch = process.argv[3] === "true";
const metrics = path.join(artifactRoot, "metrics");
const read = (name) => JSON.parse(fs.readFileSync(path.join(metrics, name), "utf8"));

const mechanical = read("acceptance-analysis.json");
const qualitative = read("qualitative-audit.json");
const status = read("batch-status.json");
const proxy = read("token-proxy-livewiki-clean-v11.json");
const stage2 = status?.byStage?.["2"] ?? status?.run?.summary?.byStage?.["2"];
const stage4 = status?.byStage?.["4"] ?? status?.run?.summary?.byStage?.["4"];
const failedStage4Tasks = (status?.tasks ?? []).filter(
  (task) => Number(task?.stage) === 4 && task?.status === "failed",
);
const failedTaskDiagnostics = failedStage4Tasks.map((task) => {
  const history = Array.isArray(task?.diagnosticHistory) ? task.diagnosticHistory : [];
  const attempts = history.map((entry) => Number(entry?.attempt));
  const ordered = attempts.every((attempt, index) => index === 0 || attempt > attempts[index - 1]);
  return {
    target: task?.target,
    reportedAttempts: Number(task?.attempts ?? 0),
    diagnosticAttempts: attempts,
    present: Array.isArray(task?.diagnosticHistory),
    complete: history.length === Number(task?.attempts ?? 0),
    ordered,
  };
});

const gates = {
  mechanical: mechanical.overallGate === "PASS",
  qualitative: qualitative.overallGate === "PASS",
  stage2Zero:
    Number(stage2?.inputTokens ?? -1) === 0 &&
    Number(stage2?.outputTokens ?? -1) === 0,
  reasoningZero: Number(proxy?.reasoningTokens ?? -1) === 0,
  proxyHadTraffic: Number(proxy?.calls ?? 0) > 0,
  proxyZeroErrors: Number(proxy?.callsWithError ?? -1) === 0,
  proxyAliveThroughout: !proxyDiedMidBatch,
  accountingReconciled:
    Number(stage4?.inputTokens ?? -1) === Number(proxy?.promptTokens ?? -2) &&
    Number(stage4?.outputTokens ?? -1) === Number(proxy?.completionTokens ?? -2),
  failedDiagnosticsComplete: failedTaskDiagnostics.every(
    (task) => task.present && task.complete && task.ordered,
  ),
};

const output = {
  overallGate: Object.values(gates).every(Boolean) ? "PASS" : "FAIL",
  gates,
  batch: {
    status: status?.run?.status,
    tasksDone: status?.run?.summary?.tasksDone,
    tasksFailed: status?.run?.summary?.tasksFailed,
    stage2,
    stage4,
  },
  proxy: {
    calls: proxy?.calls,
    promptTokens: proxy?.promptTokens,
    completionTokens: proxy?.completionTokens,
    reasoningTokens: proxy?.reasoningTokens,
    callsWithError: proxy?.callsWithError,
    diedMidBatch: proxyDiedMidBatch,
  },
  mechanicalGate: mechanical.overallGate,
  qualitativeGate: qualitative.overallGate,
  failedTaskDiagnostics,
};

fs.writeFileSync(
  path.join(metrics, "final-gate.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output, null, 2));
