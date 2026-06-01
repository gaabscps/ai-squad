import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ProjectsProvider, useProjects } from "./projects";
import { useLiveProjects } from "./useLiveProjects";
import { makeProject } from "../test-utils";

// WebSocket fake e controlável: o teste dispara open/message/close na mão.
class FakeWS {
  static last: FakeWS | null = null;
  static instances = 0;
  static OPEN = 1;
  static CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.last = this;
    FakeWS.instances++;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
  _open() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
  _message(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function Probe() {
  useLiveProjects();
  const { projects, connected } = useProjects();
  return <div data-testid="probe">{connected ? "up" : "down"}:{projects.length}</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWS.last = null;
  FakeWS.instances = 0;
});

describe("useLiveProjects", () => {
  it("conecta e despacha o snapshot recebido", () => {
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    render(
      <ProjectsProvider>
        <Probe />
      </ProjectsProvider>,
    );
    act(() => FakeWS.last!._open());
    act(() =>
      FakeWS.last!._message({
        type: "snapshot",
        projects: [makeProject({ id: "p1" }), makeProject({ id: "p2" })],
      }),
    );
    expect(screen.getByTestId("probe").textContent).toBe("up:2");
  });

  it("reconecta após a conexão cair (backoff)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    render(
      <ProjectsProvider>
        <Probe />
      </ProjectsProvider>,
    );
    act(() => FakeWS.last!._open());
    expect(FakeWS.instances).toBe(1);

    act(() => FakeWS.last!.close()); // conexão cai
    expect(screen.getByTestId("probe").textContent).toBe("down:0");

    act(() => {
      vi.advanceTimersByTime(1000); // backoff de 1s → tenta de novo
    });
    expect(FakeWS.instances).toBe(2); // reconectou sozinho
  });
});
