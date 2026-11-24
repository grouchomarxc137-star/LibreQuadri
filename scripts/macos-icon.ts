import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

/** Uses only macOS-native AppKit and iconutil; no image generation dependency. */
export function generateMacApplicationIcon(applicationRoot: string, outputDirectory = path.join(applicationRoot,"build","alpha","icon")): string {
  if (process.platform !== "darwin") throw new Error("macOS icon generation requires macOS");
  const iconset = path.join(outputDirectory,"LibreQuadri.iconset");
  const icon = path.join(outputDirectory,"LibreQuadri.icns");
  mkdirSync(outputDirectory,{recursive:true});
  rmSync(iconset,{recursive:true,force:true});
  execFileSync("/usr/bin/swift",["-module-cache-path",path.join(outputDirectory,"module-cache"),
    path.join(applicationRoot,"scripts","macos-icon.swift"),iconset],{stdio:"inherit"});
  execFileSync("/usr/bin/iconutil",["--convert","icns","--output",icon,iconset],{stdio:"inherit"});
  if (readFileSync(icon).subarray(0,4).toString() !== "icns") throw new Error("Invalid generated macOS icon");
  return icon;
}
