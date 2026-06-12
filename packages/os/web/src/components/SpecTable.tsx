import { useState } from "react";
import type { SpecWithProject } from "../lib/kanbanObserved";
import { fmtTokens, fmtUsd, fmtRelativeTime } from "../format";
import { SpecJobIndicator } from "./SpecJobIndicator";
import { STATUS_LABEL } from "./StatusBadge";

type SortKey = "project" | "id" | "status" | "phase" | "cost" | "activity";

function valueFor(item: SpecWithProject, key: SortKey): string | number {
  const s = item.spec;
  switch (key) {
    case "project":
      return item.projectName;
    case "id":
      return s.id;
    case "status":
      return s.status;
    case "phase":
      return s.phase;
    case "cost":
      return s.cost.totalCostUsd ?? -1; // sem dado vai pro fim no asc
    case "activity":
      return s.lastActivityAt ?? "";
  }
}

export function SpecTable({
  items,
  onSelect,
}: {
  items: SpecWithProject[];
  onSelect: (item: SpecWithProject) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [asc, setAsc] = useState(false);

  const sorted = [...items].sort((a, b) => {
    const va = valueFor(a, sortKey);
    const vb = valueFor(b, sortKey);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return asc ? cmp : -cmp;
  });

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  };

  const cols: { key: SortKey; label: string }[] = [
    { key: "project", label: "projeto" },
    { key: "id", label: "id" },
    { key: "status", label: "status" },
    { key: "phase", label: "modo" },
    { key: "cost", label: "custo" },
    { key: "activity", label: "atividade" },
  ];

  return (
    <table className="spec-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>
              <button type="button" onClick={() => toggle(c.key)}>
                {c.label}
                {sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
              </button>
            </th>
          ))}
          <th>título</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((it) => (
          <tr
            key={`${it.projectId}/${it.spec.id}`}
            onClick={() => onSelect(it)}
            data-status={it.spec.status}
          >
            <td>{it.projectName}</td>
            <td className="mono">{it.spec.id}</td>
            <td>
              <span className={`status status-${it.spec.status}`}>
                {STATUS_LABEL[it.spec.status]}
              </span>
            </td>
            <td>{it.spec.observed ? "observado" : it.spec.phase}</td>
            <td className="mono">
              {fmtUsd(it.spec.cost.totalCostUsd)} · {fmtTokens(it.spec.cost.totalTokens)}
              {it.spec.cost.source === "partial" && (
                <span className="cost-preliminary"> · prelim.</span>
              )}
            </td>
            <td>{fmtRelativeTime(it.spec.lastActivityAt)}</td>
            <td>
              {it.spec.title}
              <SpecJobIndicator projectId={it.projectId} specId={it.spec.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
