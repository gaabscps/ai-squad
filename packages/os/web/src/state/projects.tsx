import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Project } from "../../../src/store/types";

export interface ProjectsState {
  projects: Project[];
  connected: boolean;
  archiveAfterDays: number;
  include: string[];
}

export type ProjectsAction =
  | { type: "snapshot"; projects: Project[]; archiveAfterDays?: number; include?: string[] }
  | { type: "connected"; connected: boolean };

/**
 * O WS empurra o Project[] INTEIRO a cada mudança; por isso 'snapshot' só troca
 * o array (sem merge). 'connected' reflete o estado da conexão (pra UI mostrar
 * "ao vivo" / "reconectando").
 */
export function projectsReducer(
  state: ProjectsState,
  action: ProjectsAction,
): ProjectsState {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        projects: action.projects,
        archiveAfterDays: action.archiveAfterDays ?? state.archiveAfterDays,
        include: action.include ?? state.include,
      };
    case "connected":
      return { ...state, connected: action.connected };
    default:
      return state;
  }
}

const INITIAL: ProjectsState = { projects: [], connected: false, archiveAfterDays: 7, include: [] };

const StateCtx = createContext<ProjectsState>(INITIAL);
const DispatchCtx = createContext<Dispatch<ProjectsAction>>(() => {});

export function ProjectsProvider({
  children,
  initial,
  initialArchiveAfterDays = 7,
  initialInclude = [],
}: {
  children: ReactNode;
  initial?: Project[];
  initialArchiveAfterDays?: number;
  initialInclude?: string[];
}) {
  const [state, dispatch] = useReducer(projectsReducer, {
    projects: initial ?? [],
    connected: false,
    archiveAfterDays: initialArchiveAfterDays,
    include: initialInclude,
  });
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useProjects = (): ProjectsState => useContext(StateCtx);
export const useProjectsDispatch = (): Dispatch<ProjectsAction> => useContext(DispatchCtx);
