export const BRANDED_LOADING_MIN_MS = 2000;
export const BRANDED_LOADING_MAX_MS = 3000;

export function showBrandedLoading(initialized: boolean, minimumElapsed: boolean, maximumElapsed: boolean): boolean {
  return !maximumElapsed && (!minimumElapsed || !initialized);
}

/** A newer project action makes an older current() answer irrelevant. */
export class ProjectRequestCoordinator<T> {
  private generation = 0;

  invalidate(): void { this.generation++; }

  async load(request: () => Promise<T | null>, onProject: (project: T | null) => void,
    onError: (error: unknown) => void): Promise<T | null | undefined> {
    const generation = ++this.generation;
    try {
      const project = await request();
      if (generation !== this.generation) return undefined;
      onProject(project);
      return project;
    } catch (error) {
      if (generation === this.generation) onError(error);
      return undefined;
    }
  }
}

/** Bounds only the branded view. The pending request may still complete safely. */
export function startInitialProjectLoad<T>(coordinator: ProjectRequestCoordinator<T>,
  request: () => Promise<T | null>, onProject: (project: T | null) => void,
  onError: (error: unknown) => void, onMinimum: () => void, onTimeout: () => void): () => void {
  const minimum = setTimeout(onMinimum, BRANDED_LOADING_MIN_MS);
  const timeout = setTimeout(onTimeout, BRANDED_LOADING_MAX_MS);
  void coordinator.load(request,
    project => { clearTimeout(timeout); onProject(project); },
    error => { clearTimeout(timeout); onError(error); });
  return () => { clearTimeout(minimum); clearTimeout(timeout); coordinator.invalidate(); };
}
