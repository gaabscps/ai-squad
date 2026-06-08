import type { DeliveryReport } from "../../../src/store/types";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel, acClassificationSummary } from "../lib/deliveryLabels";
import { Markdown } from "./Markdown";

export function DeliveryReportBlock({
  report,
  onOpenFile,
}: {
  report: DeliveryReport | null | undefined;
  onOpenFile?: (path: string, title: string) => void;
}) {
  if (!report) {
    return <p className="delivery-empty">sem parecer de entrega ainda</p>;
  }

  const v = report.verdict ? verdictLabel(report.verdict.value) : null;

  return (
    <section className="delivery" data-testid="delivery-report">
      {report.verdict && v && (
        <div className={`delivery-verdict verdict-${v.cls}`}>
          <span className="delivery-verdict-label">{v.label}</span>
          {report.verdict.rationale && (
            <Markdown className="delivery-verdict-rationale">{report.verdict.rationale}</Markdown>
          )}
        </div>
      )}

      <div className="delivery-answers">
        {report.answers.map((a, idx) => {
          const c = confidenceLabel(a.confidence);
          return (
            <details key={a.key} className="delivery-answer" open={idx === 0}>
              <summary className="delivery-answer-summary">
                <span className="delivery-answer-title">{answerTitle(a.key)}</span>
                <span className={`delivery-conf conf-${c.cls}`}>{c.label}</span>
              </summary>
              <Markdown className="delivery-answer-text">{a.answer}</Markdown>
              {a.evidenceRefs.length > 0 && (
                <ul className="delivery-evidence">
                  {a.evidenceRefs.map((ref) => (
                    <li key={ref} className="delivery-evidence-ref mono">{ref}</li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
      </div>

      {report.acceptanceCriteria.length > 0 && (
        <details className="delivery-acs-wrap">
          <summary className="delivery-acs-summary">
            Critérios de aceite — {acClassificationSummary(report.acceptanceCriteria)}
          </summary>
          <table className="delivery-acs">
            <tbody>
              {report.acceptanceCriteria.map((ac) => {
                const cl = classificationLabel(ac.classification);
                return (
                  <tr key={ac.id} className="delivery-ac">
                    <td className="delivery-ac-id mono">{ac.id}</td>
                    <td className="delivery-ac-desc"><Markdown>{ac.description}</Markdown></td>
                    <td className={`delivery-ac-class class-${cl.cls}`}>{cl.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}

      {report.mdPath && onOpenFile && (
        <button
          type="button"
          className="delivery-md-link"
          onClick={() => onOpenFile(report.mdPath!, "delivery-report.md")}
        >
          ver narrativa completa →
        </button>
      )}
    </section>
  );
}
