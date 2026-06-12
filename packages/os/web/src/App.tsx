import { useState, useEffect, type ReactNode } from "react";
import { ProjectsProvider } from "./state/projects";
import { useLiveProjects } from "./state/useLiveProjects";
import { Board, type SelectedSpec } from "./components/Board";
import { FolderManager } from "./components/FolderManager";
import {
  DiagnosisJobsProvider,
  useDiagnosisJobs,
} from "./state/diagnosisJobs";
import type { AttentionClient } from "./state/attentionClient";
import type { Project } from "../../src/store/types";

function BoardLive({
  selected,
  onSelect,
  onClose,
  onOpenFolderManager,
}: {
  selected: SelectedSpec | null;
  onSelect: (spec: SelectedSpec) => void;
  onClose: () => void;
  onOpenFolderManager?: () => void;
}) {
  const { toggleHide } = useLiveProjects();
  return (
    <Board
      onHide={toggleHide}
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

  useEffect(() => {
    if (selected) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, markSeen]);

  const job = selected ? getJob(selected.projectId, selected.specId) : undefined;

  // When a job completes while the drawer is already open, `selected` doesn't
  // change — so the effect above won't fire. This second effect watches the
  // job state directly and marks it seen the moment it reaches a terminal state.
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

  return (
    <>
      <BoardLive
        selected={selected}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
        onOpenFolderManager={() => setFolderManagerOpen(true)}
      />
      <FolderManager
        open={folderManagerOpen}
        onClose={() => setFolderManagerOpen(false)}
      />
    </>
  );
}
