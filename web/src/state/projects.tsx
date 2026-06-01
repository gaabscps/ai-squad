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
}

export type ProjectsAction =
  | { type: "snapshot"; projects: Project[] }
  | { type: "connected"; connected: boolean };

/**
 * O WS empurra o Project[] INTEIRO a cada mudança; por isso 'snapshot' só troca
 * o array (sem merge). 'connected' reflete o estado da conexão (pra UI mostrar
 * "ao vivo" / "reconectando"). Reducer puro — fácil de testar isolado.
 */
export function projectsReducer(
  state: ProjectsState,
  action: ProjectsAction,
): ProjectsState {
  switch (action.type) {
    case "snapshot":
      return { ...state, projects: action.projects };
    case "connected":
      return { ...state, connected: action.connected };
    default:
      return state;
  }
}

const INITIAL: ProjectsState = { projects: [], connected: false };

const StateCtx = createContext<ProjectsState>(INITIAL);
const DispatchCtx = createContext<Dispatch<ProjectsAction>>(() => {});

export function ProjectsProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Project[];
}) {
  const [state, dispatch] = useReducer(projectsReducer, {
    projects: initial ?? [],
    connected: false,
  });
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useProjects = (): ProjectsState => useContext(StateCtx);
export const useProjectsDispatch = (): Dispatch<ProjectsAction> => useContext(DispatchCtx);
