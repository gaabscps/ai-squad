import { useDiagnosisJobs } from "../state/diagnosisJobs";

const STEP_LABELS: Record<string, string> = {
  queued: "na fila",
  generating: "gerando",
  streaming: "streamando",
};

const ACTIVE_STATES = new Set(["queued", "generating", "streaming"]);

interface Props {
  projectId: string;
  specId: string;
}

export function SpecJobIndicator({ projectId, specId }: Props) {
  const { getJob } = useDiagnosisJobs();
  const job = getJob(projectId, specId);

  if (!job) return null;

  if (ACTIVE_STATES.has(job.state)) {
    return (
      <div className="spec-job-indicator" aria-label="Diagnóstico em andamento">
        <div className="spec-job-bar" role="progressbar" aria-valuetext={STEP_LABELS[job.state] ?? job.state}>
          <div className="spec-job-bar-fill" />
        </div>
        <span className="spec-job-label">{STEP_LABELS[job.state] ?? job.state}</span>
      </div>
    );
  }

  if (job.state === "ready" && !job.seen) {
    return (
      <div className="spec-job-indicator">
        <span className="spec-job-badge spec-job-badge--success" aria-label="Diagnóstico concluído">
          ✓ pronto
        </span>
      </div>
    );
  }

  if (job.state === "error" && !job.seen) {
    return (
      <div className="spec-job-indicator">
        <span className="spec-job-badge spec-job-badge--error" aria-label="Erro no diagnóstico">
          ! erro
        </span>
      </div>
    );
  }

  return null;
}
