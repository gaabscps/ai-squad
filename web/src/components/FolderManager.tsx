import { useEffect, useRef, useState } from "react";
import { browseDirs, addInclude, removeInclude } from "../state/foldersClient";
import { useProjects } from "../state/projects";
import type { DirEntry } from "../state/foldersClient";

export interface FolderManagerProps {
  open: boolean;
  onClose: () => void;
}

function parentPath(p: string): string {
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

function displayPath(path: string, homePath: string | null): string {
  if (!path) return "~";
  if (homePath && path === homePath) return "~";
  if (homePath && path.startsWith(homePath + "/")) return "~" + path.slice(homePath.length);
  return path;
}

export function FolderManager({ open, onClose }: FolderManagerProps) {
  const { include } = useProjects();

  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [homePath, setHomePath] = useState<string | null>(null);
  const [currentHasSDD, setCurrentHasSDD] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const [removingPaths, setRemovingPaths] = useState<Set<string>>(new Set());

  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      navigate("", true);
    }
    prevOpenRef.current = open;
  }, [open]);

  async function navigate(path: string, isInitial = false) {
    setLoading(true);
    setError(null);
    setAddFeedback(null);
    try {
      const result = await browseDirs(path);
      setDirs(result.dirs);
      setCurrentPath(result.resolvedPath);
      if (isInitial) {
        setHomePath(result.resolvedPath);
        setCurrentHasSDD(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDirClick(entry: DirEntry) {
    setCurrentHasSDD(entry.hasAgentSession);
    navigate(entry.path);
  }

  function handleUp() {
    setCurrentHasSDD(false);
    navigate(parentPath(currentPath));
  }

  async function handleAdd() {
    setError(null);
    setAddFeedback(null);
    try {
      await addInclude(currentPath);
      setAddFeedback("Repositório adicionado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(path: string) {
    setError(null);
    setRemovingPaths((prev) => new Set(prev).add(path));
    try {
      await removeInclude(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }

  const isAtHome = homePath !== null && currentPath === homePath;

  if (!open) return null;

  return (
    <div className="fm-overlay" onClick={onClose}>
      <div className="fm-modal" role="dialog" aria-label="Gerenciar Repositórios" onClick={(e) => e.stopPropagation()}>
        <header className="fm-header">
          <h2 className="fm-title">Gerenciar Repositórios</h2>
          <button type="button" className="fm-close" aria-label="fechar" onClick={onClose}>
            ✕
          </button>
        </header>

        <section className="fm-section">
          <h3 className="fm-section-title">Repos adicionados</h3>
          {include.length === 0 ? (
            <p className="fm-empty-repos">nenhum repo adicionado ainda</p>
          ) : (
            <ul className="fm-include-list">
              {include.map((path) => (
                <li key={path} className="fm-include-item">
                  <span className="fm-include-path">{displayPath(path, homePath)}</span>
                  <button
                    type="button"
                    className="fm-btn-remove"
                    aria-label={`remover ${path}`}
                    disabled={removingPaths.has(path)}
                    onClick={() => handleRemove(path)}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fm-section fm-section-nav">
          <h3 className="fm-section-title">Adicionar novo</h3>

          <div className="fm-breadcrumb">
            <span className="fm-path">{displayPath(currentPath, homePath)}</span>
          </div>

          <div className="fm-controls">
            <button
              type="button"
              className="fm-btn"
              aria-label="subir"
              disabled={isAtHome}
              onClick={handleUp}
            >
              ↑ Subir
            </button>
            <button
              type="button"
              className="fm-btn fm-btn-add"
              disabled={!currentHasSDD}
              onClick={handleAdd}
            >
              Adicionar este repo
            </button>
          </div>

          {error && <p className="fm-error">{error}</p>}
          {addFeedback && <p className="fm-feedback">{addFeedback}</p>}

          <ul className="fm-dir-list">
            {loading && <li className="fm-loading">carregando…</li>}
            {!loading && dirs.length === 0 && !error && (
              <li className="fm-empty">nenhuma subpasta aqui</li>
            )}
            {!loading &&
              dirs.map((entry) => (
                <li key={entry.path} className="fm-dir-item">
                  <button
                    type="button"
                    className="fm-dir-btn"
                    onClick={() => handleDirClick(entry)}
                  >
                    {entry.name}
                    {entry.hasAgentSession && (
                      <span className="fm-sdd-badge">✓ tem SDD</span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
