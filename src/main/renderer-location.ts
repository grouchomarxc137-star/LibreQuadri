import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RendererLocation {
  readonly indexPath: string;
  readonly indexUrl: string;
  readonly preloadPath: string;
}

/** Where the built renderer and its preload script live, relative to the app root. */
export function rendererLocation(appPath: string): RendererLocation {
  const indexPath = path.join(appPath, "dist", "renderer", "index.html");
  return {
    indexPath,
    indexUrl: pathToFileURL(indexPath).href,
    preloadPath: path.join(appPath, "dist", "src", "preload", "index.cjs"),
  };
}

export interface FrameLike {
  readonly url: string;
  readonly parent: unknown;
}

function withoutQueryAndHash(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * IPC is only served to the top-level frame that shows our own built renderer.
 * Anything else (a navigated page, a subframe, a destroyed frame) is refused.
 */
export function isTrustedRendererFrame(
  frame: FrameLike | null,
  rendererIndexUrl: string,
): boolean {
  if (frame === null || frame.parent !== null) {
    return false;
  }
  return withoutQueryAndHash(frame.url) === rendererIndexUrl;
}
