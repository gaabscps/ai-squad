import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { attentionClient as defaultClient, type AttentionClient } from "./attentionClient";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type JobState = "queued" | "generating" | "streaming" | "ready" | "error" | "cancelled";

export interface Job {
  projectId: string;
  specId: string;
  state: JobState;
  text: string;
  handoff: string | null;
  error: string | null;
  generatedAt: string | null;
  costUsd: number | null;
  seen: boolean;
}

export interface JobsState {
  /** Chaveado por `${projectId}|${specId}` */
  jobs: Record<string, Job>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type JobsAction =
  | { type: "register"; projectId: string; specId: string }
  | { type: "queued"; projectId: string; specId: string }
  | { type: "chunk"; projectId: string; specId: string; delta: string | undefined }
  | { type: "done"; projectId: string; specId: string; text: string | undefined; costUsd: number | null | undefined; generatedAt: string | undefined }
  | { type: "handoff"; projectId: string; specId: string; text: string | undefined }
  | { type: "error"; projectId: string; specId: string; message: string | undefined }
  | { type: "cancelled"; projectId: string; specId: string }
  | { type: "markSeen"; projectId: string; specId: string };

const TERMINAL_STATES = new Set<JobState>(["cancelled", "ready", "error"]);

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

export function jobsReducer(state: JobsState, action: JobsAction): JobsState {
  const key = `${action.projectId}|${action.specId}`;

  switch (action.type) {
    case "register":
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [key]: {
            projectId: action.projectId,
            specId: action.specId,
            state: "generating",
            text: "",
            handoff: null,
            error: null,
            generatedAt: null,
            costUsd: null,
            seen: false,
          },
        },
      };

    case "queued": {
      const job = state.jobs[key];
      if (!job) return state;
      if (TERMINAL_STATES.has(job.state)) return state;
      return { ...state, jobs: { ...state.jobs, [key]: { ...job, state: "queued" } } };
    }

    case "chunk": {
      const job = state.jobs[key];
      if (!job) return state;
      if (TERMINAL_STATES.has(job.state)) return state;
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [key]: { ...job, state: "streaming", text: job.text + (action.delta ?? "") },
        },
      };
    }

    case "done": {
      const job = state.jobs[key];
      if (!job) return state;
      if (TERMINAL_STATES.has(job.state)) return state;
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [key]: {
            ...job,
            state: "ready",
            text: action.text ?? job.text,
            costUsd: action.costUsd ?? null,
            generatedAt: action.generatedAt ?? null,
          },
        },
      };
    }

    case "handoff": {
      const job = state.jobs[key];
      if (!job) return state;
      if (TERMINAL_STATES.has(job.state)) return state;
      return {
        ...state,
        jobs: { ...state.jobs, [key]: { ...job, handoff: action.text ?? null } },
      };
    }

    case "error": {
      const job = state.jobs[key];
      if (!job) return state;
      if (TERMINAL_STATES.has(job.state)) return state;
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [key]: { ...job, state: "error", error: action.message ?? null },
        },
      };
    }

    case "cancelled": {
      const job = state.jobs[key];
      if (!job) return state;
      return { ...state, jobs: { ...state.jobs, [key]: { ...job, state: "cancelled" } } };
    }

    case "markSeen": {
      const job = state.jobs[key];
      if (!job) return state;
      if (job.seen) return state;
      return { ...state, jobs: { ...state.jobs, [key]: { ...job, seen: true } } };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const INITIAL: JobsState = { jobs: {} };

export interface DiagnosisJobsAPI {
  getJob: (projectId: string, specId: string) => Job | undefined;
  generate: (projectId: string, specId: string) => void;
  cancel: (projectId: string, specId: string) => void;
  markSeen: (projectId: string, specId: string) => void;
  state: JobsState;
}

const APICtx = createContext<DiagnosisJobsAPI>({
  getJob: () => undefined,
  generate: () => {},
  cancel: () => {},
  markSeen: () => {},
  state: INITIAL,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ProviderProps {
  children: ReactNode;
  /** Injetável em testes; usa o singleton real por padrão. */
  client?: AttentionClient;
}

export function DiagnosisJobsProvider({ children, client = defaultClient }: ProviderProps) {
  const [state, dispatch] = useReducer(jobsReducer, INITIAL);

  // Subscrições ativas por chave — gerenciadas por generate() e limpas no unmount.
  const subsRef = useRef<Map<string, () => void>>(new Map());

  const makeHandler = useCallback(
    (projectId: string, specId: string) => {
      return (msg: AttentionServerMsg) => {
        switch (msg.type) {
          case "attention:queued":
            dispatch({ type: "queued", projectId, specId });
            break;
          case "attention:chunk":
            dispatch({ type: "chunk", projectId, specId, delta: msg.delta });
            break;
          case "attention:done":
            dispatch({ type: "done", projectId, specId, text: msg.text, costUsd: msg.costUsd, generatedAt: msg.generatedAt });
            break;
          case "attention:handoff":
            dispatch({ type: "handoff", projectId, specId, text: msg.text });
            break;
          case "attention:error":
            dispatch({ type: "error", projectId, specId, message: msg.message });
            break;
        }
      };
    },
    [],
  );

  const generate = useCallback(
    (projectId: string, specId: string) => {
      const key = `${projectId}|${specId}`;

      subsRef.current.get(key)?.();

      // Subscreve ANTES de chamar client.generate() para não perder mensagens
      // emitidas pelo servidor no mesmo tick (race window entre dispatch+generate e useEffect).
      const unsub = client.subscribe(key, makeHandler(projectId, specId));
      subsRef.current.set(key, unsub);

      dispatch({ type: "register", projectId, specId });
      client.generate(projectId, specId);
    },
    [client, makeHandler],
  );

  const cancel = useCallback(
    (projectId: string, specId: string) => {
      dispatch({ type: "cancelled", projectId, specId });
      client.cancel(projectId, specId);
    },
    [client],
  );

  const markSeen = useCallback(
    (projectId: string, specId: string) => {
      dispatch({ type: "markSeen", projectId, specId });
    },
    [],
  );

  const getJob = useCallback(
    (projectId: string, specId: string): Job | undefined =>
      state.jobs[`${projectId}|${specId}`],
    [state.jobs],
  );

  useEffect(() => {
    return () => {
      for (const unsub of subsRef.current.values()) unsub();
      subsRef.current.clear();
    };
  }, []);

  const api: DiagnosisJobsAPI = { getJob, generate, cancel, markSeen, state };

  return <APICtx.Provider value={api}>{children}</APICtx.Provider>;
}

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

export const useDiagnosisJobs = (): DiagnosisJobsAPI => useContext(APICtx);
