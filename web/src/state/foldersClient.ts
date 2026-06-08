export interface DirEntry {
  name: string;
  path: string;
  hasAgentSession: boolean;
}

export async function browseDirs(path: string): Promise<{ dirs: DirEntry[]; resolvedPath: string }> {
  const url = `/api/browse?path=${encodeURIComponent(path)}`;
  const response = await fetch(url);

  if (response.status >= 400) {
    const body = await response.json();
    throw new Error(body.error ?? `${response.status}`);
  }

  const body = await response.json();
  return { dirs: body.dirs ?? [], resolvedPath: body.resolvedPath ?? path };
}

export async function addInclude(
  path: string
): Promise<{ persisted: boolean; alreadyExisted: boolean }> {
  const response = await fetch("/api/include", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

  if (response.status >= 400) {
    const body = await response.json();
    throw new Error(body.error ?? `${response.status}`);
  }

  const body = await response.json();
  return {
    persisted: body.persisted ?? false,
    alreadyExisted: body.alreadyExisted ?? false,
  };
}

export async function removeInclude(
  path: string
): Promise<{ persisted: boolean }> {
  const response = await fetch("/api/include", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

  if (response.status >= 400) {
    const body = await response.json();
    throw new Error(body.error ?? `${response.status}`);
  }

  const body = await response.json();
  return {
    persisted: body.persisted ?? false,
  };
}
