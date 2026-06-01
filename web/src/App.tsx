import { ProjectsProvider } from "./state/projects";
import { useLiveProjects } from "./state/useLiveProjects";
import { Board } from "./components/Board";

// Componente interno: vive DENTRO do Provider, então o hook acha o dispatch do
// Context. O toggleHide do hook (envia hide/unhide pelo WS) desce pro Board.
function BoardLive() {
  const { toggleHide } = useLiveProjects();
  return <Board onHide={toggleHide} />;
}

export function App() {
  return (
    <ProjectsProvider>
      <BoardLive />
    </ProjectsProvider>
  );
}
