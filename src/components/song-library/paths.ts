/**
 * Where Song Library links point. The same screens live at /song-library
 * (the Hub Service) and under a department's Songwriting > Library tab, so
 * the pages pass the right set down.
 */
export interface LibraryPaths {
  home: string;
  upload: (sourceTrainingId?: string | null) => string;
  song: (id: string) => string;
  writer: (userId: string) => string;
  helpers: string;
  board: string;
  dmPreview: string;
}

function build(base: string): LibraryPaths {
  const enc = encodeURIComponent;
  return {
    home: base,
    upload: (source) => (source ? `${base}/upload?source_training_id=${enc(source)}` : `${base}/upload`),
    song: (id) => `${base}/songs/${enc(id)}`,
    writer: (userId) => `${base}/writers/${enc(userId)}`,
    helpers: `${base}/helpers`,
    board: `${base}/board`,
    dmPreview: `${base}/dm-preview`,
  };
}

export const SERVICE_LIBRARY_PATHS: LibraryPaths = build("/song-library");

export function departmentLibraryPaths(slug: string): LibraryPaths {
  return build(`/departments/${encodeURIComponent(slug)}/songwriting/library`);
}

/** Path builders can't cross the server/client boundary, so pages pass this. */
export type LibraryScope = { kind: "service" } | { kind: "department"; slug: string };

export function libraryPaths(scope: LibraryScope): LibraryPaths {
  return scope.kind === "service" ? SERVICE_LIBRARY_PATHS : departmentLibraryPaths(scope.slug);
}
