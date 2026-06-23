import { useState, useEffect, type ReactNode } from "react";
import { ProjectsProvider } from "./state/projects";
import { useLiveProjects } from "./state/useLiveProjects";
import { ExportPage } from "./components/ExportPage";
import { parseExportTarget } from "./lib/exportUrl";
import { Board, type SelectedSpec } from "./components/Board";
import { FolderManager } from "./components/FolderManager";
import {
  DiagnosisJobsProvider,
  useDiagnosisJobs,
} from "./state/diagnosisJobs";
import type { AttentionClient } from "./state/attentionClient";
import type { Project } from "../../src/store/types";

// Renderiza o Board com os dados ao vivo; recebe onHide por prop (o WS já está no AppInner).
function BoardLive({
  selected,
  onSelect,
  onClose,
  onHide,
  onOpenFolderManager,
}: {
  selected: SelectedSpec | null;
  onSelect: (spec: SelectedSpec) => void;
  onClose: () => void;
  onHide: (id: string, hidden: boolean) => void;
  onOpenFolderManager?: () => void;
}) {
  return (
    <Board
      onHide={onHide}
      selected={selected}
      onSelect={onSelect}
      onClose={onClose}
      onOpenFolderManager={onOpenFolderManager}
    />
  );
}

export interface AppProvidersProps {
  children: ReactNode;
  diagnosisClient?: AttentionClient;
  initial?: Project[];
}

export function AppProviders({ children, diagnosisClient, initial }: AppProvidersProps) {
  return (
    <ProjectsProvider initial={initial}>
      <DiagnosisJobsProvider client={diagnosisClient}>
        {children}
      </DiagnosisJobsProvider>
    </ProjectsProvider>
  );
}

interface AppProps {
  diagnosisClient?: AttentionClient;
}

export function App({ diagnosisClient }: AppProps = {}) {
  return (
    <AppProviders diagnosisClient={diagnosisClient}>
      <AppInner />
    </AppProviders>
  );
}

function AppInner() {
  const [selected, setSelected] = useState<SelectedSpec | null>(null);
  const [folderManagerOpen, setFolderManagerOpen] = useState(false);
  const { markSeen, getJob } = useDiagnosisJobs();
  const { toggleHide } = useLiveProjects(); // conecta o WS — vale pro board E pra ExportPage

  useEffect(() => {
    if (selected) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, markSeen]);

  const job = selected ? getJob(selected.projectId, selected.specId) : undefined;

  // Quando um job conclui com o drawer já aberto, `selected` não muda —
  // então o efeito acima não dispara. Este segundo efeito observa o estado
  // do job diretamente e marca seen assim que ele atinge um estado terminal.
  useEffect(() => {
    if (
      selected &&
      job &&
      (job.state === "ready" || job.state === "error") &&
      !job.seen
    ) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, job, markSeen]);

  // Ramifica para a ExportPage quando a URL contém export=1&projectId=…&specId=…
  const exportTarget = parseExportTarget(window.location.search);
  if (exportTarget) {
    return <ExportPage projectId={exportTarget.projectId} specId={exportTarget.specId} />;
  }

  return (
    <>
      <BoardLive
        selected={selected}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
        onHide={toggleHide}
        onOpenFolderManager={() => setFolderManagerOpen(true)}
      />
      <FolderManager
        open={folderManagerOpen}
        onClose={() => setFolderManagerOpen(false)}
      />
    </>
  );
}
