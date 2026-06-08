import type { DeliveryReport } from "../../../src/store/types";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel } from "../lib/deliveryLabels";

export function DeliveryReportBlock({ report }: { report: DeliveryReport | null | undefined }) {
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
            <p className="delivery-verdict-rationale">{report.verdict.rationale}</p>
          )}
        </div>
      )}

      <div className="delivery-answers">
        {report.answers.map((a) => {
          const c = confidenceLabel(a.confidence);
          return (
            <div key={a.key} className="delivery-answer">
              <h5 className="delivery-answer-title">
                {answerTitle(a.key)}
                <span className={`delivery-conf conf-${c.cls}`}>{c.label}</span>
              </h5>
              <p className="delivery-answer-text">{a.answer}</p>
              {a.evidenceRefs.length > 0 && (
                <ul className="delivery-evidence">
                  {a.evidenceRefs.map((ref, i) => (
                    <li key={i} className="delivery-evidence-ref mono">{ref}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {report.acceptanceCriteria.length > 0 && (
        <table className="delivery-acs">
          <tbody>
            {report.acceptanceCriteria.map((ac) => {
              const cl = classificationLabel(ac.classification);
              return (
                <tr key={ac.id} className={`delivery-ac ac-${cl.cls}`}>
                  <td className="delivery-ac-id mono">{ac.id}</td>
                  <td className="delivery-ac-desc">{ac.description}</td>
                  <td className={`delivery-ac-class class-${cl.cls}`}>{cl.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {report.mdPath && (
        <a
          className="delivery-md-link"
          href={`/file?path=${encodeURIComponent(report.mdPath)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          ver narrativa completa →
        </a>
      )}
    </section>
  );
}
