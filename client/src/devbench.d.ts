interface DevbenchAPI {
  isElectron: true;

  toggleBrowser(): void;
  sessionChanged(sessionId: number, projectId: number, browserUrl: string | null, defaultViewMode?: string, browserOpen?: boolean, viewMode?: string | null): void;
  sessionDestroyed(sessionId: number): void;
  navigateTo(sessionId: number, url: string, mrUrls: string[]): void;
  updateMrUrls(sessionId: number, mrUrls: string[]): void;

  resizeStart(): void;
  resizeEnd(clientX: number): void;

  onBrowserToggled(cb: (open: boolean) => void): () => void;
  onViewModeChanged(cb: (mode: string) => void): () => void;
  onShortcut(cb: (action: string) => void): () => void;
  onProjectsChanged(cb: () => void): () => void;
}

interface Window {
  devbench?: DevbenchAPI;
}
