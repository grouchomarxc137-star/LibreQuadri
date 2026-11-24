/** Internal testing milestone only; not a production release channel. */
export const ALPHA_VERSION = "0.1.0-alpha.0";
export const ALPHA_NAME = "LibreQuadri Alpha 0";
export const ALPHA_SEED_DIRECTORY = "alpha-seed";
export const ALPHA1_VERSION = "0.1.0-alpha.1";
export const ALPHA1_NAME = "LibreQuadri Alpha 1";
export const ALPHA11_VERSION = "0.1.0-alpha.1.1";
export const ALPHA11_NAME = "LibreQuadri Alpha 1.1";
export const BETA1_VERSION = "1.0.0-beta.1";
export const BETA1_NAME = "LibreQuadri Beta 1.0";
export const BETA1_SEED_DIRECTORY = "beta-seed";

export function isBeta1Build(isPackaged: boolean, version: string): boolean {
  return isPackaged && version === BETA1_VERSION;
}

export function isAlpha11Build(isPackaged: boolean, version: string): boolean {
  return isPackaged && version === ALPHA11_VERSION;
}

export function isAlpha1Build(isPackaged: boolean, version: string): boolean {
  return isPackaged && version === ALPHA1_VERSION;
}

export function isAlpha0Build(isPackaged: boolean, version: string): boolean {
  return isPackaged && version === ALPHA_VERSION;
}
