import type { DeliveryReport } from "../../../src/store/types";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel, acClassificationSummary } from "../lib/deliveryLabels";
import { firstSentence } from "../lib/markdownText";
import { Markdown } from "./Markdown";

// Keys que encabeçam a pirâmide — aparecem primeiro, abertas, com teaser.
const VITAL_KEYS = ["what_was_done", "why_this_way", "risks_and_pending"];

export function DeliveryReportBlock({
  report,
  onOpenFile,
}: {
  report: DeliveryReport | null | undefined;
  /** Se ausente, o botão "ver narrativa completa" é suprimido (sem fallback). */
  onOpenFile?: (path: string, title: string) => void;
}) {
  if (!report) {
    return <p className="delivery-empty">sem parecer de entrega ainda</p>;
  }

  const v = report.verdict ? verdictLabel(report.verdict.value) : null;

  // Separa as respostas em vitais (topo da pirâmide) e resto (colapsado).
  const vitals = VITAL_KEYS
    .map((k) => report.answers.find((a) => a.key === k))
    .filter((a): a is NonNullable<typeof a> => a != null);
  const rest = report.answers.filter((a) => !VITAL_KEYS.includes(a.key));

  // Renderiza um accordion de resposta — vital fica com teaser no summary.
  const renderAnswer = (a: (typeof report.answers)[number], open: boolean, vital: boolean) => {
    const c = confidenceLabel(a.confidence);
    return (
      <details key={a.key} className="delivery-answer" open={open}
               data-testid={vital ? "delivery-vital" : undefined}>
        <summary className="delivery-answer-summary">
          <span className="delivery-answer-title">{answerTitle(a.key)}</span>
          {vital && <span className="delivery-answer-teaser">{firstSentence(a.answer)}</span>}
          <span className={`delivery-conf conf-${c.cls}`}>{c.label}</span>
        </summary>
        <Markdown className="delivery-answer-text">{a.answer}</Markdown>
        {a.evidenceRefs.length > 0 && (
          <ul className="delivery-evidence">
            {a.evidenceRefs.map((ref) =>
              ref.endsWith(".md") && ref.startsWith("/") && onOpenFile ? (
                <li key={ref} className="delivery-evidence-ref">
                  <button type="button" className="delivery-ref-btn mono"
                          onClick={() => onOpenFile(ref, ref.split("/").pop()!)}>
                    {ref} →
                  </button>
                </li>
              ) : (
                <li key={ref} className="delivery-evidence-ref mono">{ref}</li>
              ),
            )}
          </ul>
        )}
      </details>
    );
  };

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
        {vitals.map((a, i) => renderAnswer(a, i === 0, true))}
        {rest.length > 0 && (
          <details className="delivery-more">
            <summary>ler parecer completo ({rest.length} respostas)</summary>
            {rest.map((a) => renderAnswer(a, false, false))}
          </details>
        )}
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
