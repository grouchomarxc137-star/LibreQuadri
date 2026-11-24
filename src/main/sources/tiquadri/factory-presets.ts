import type { FactoryPresetBlock } from "../../../shared/configuration.js";

/** Geometry, artwork and commercial review of the archived TiQuadri v32 master. */
export const REVIEWED_FACTORY_PRESETS = {
  masterSha256: "6d691676879d267549c0733a85302ba687e4f31d103c2650cc1f8c3b9a803320",
  marinaDin: {
    13470: 3524, 13471: 3525, 13472: 3525, 13473: 3526, 13474: 3527, 13477: 3527,
  },
  marinaAvanquadro: [13613, 13614, 13616, 13617],
  marinaAvanquadroWindows: [3624, 3625],
  marinaOverlappingWindows: {
    13610: [3618, 3619], 13611: [3620, 3621], 13612: [3622, 3623], 13615: [3622, 3623],
  },
  p17Ranges: [[34575, 34577], [34611, 34642], [34665, 34696]],
  p17SocketAnchorCorrection: [34621, 34624],
  p17Din: [4601, 4602, 4603],
  p17Sockets: [4604, 4605, 4606, 4607, 4697, 4698],
  p17SocketFamilies: [1014, 1015, 1016, 1017, 1018, 1019],
  qdsa: [8050, 8051, 8052, 8053, 8054, 8055, 8056, 8057],
  plexoPv: {5385: 2901, 5386: 2901, 5388: 2902, 5389: 2902, 5390: 2902, 5391: 2902},
} as const;

export function factoryPresetBlock(parent: number): FactoryPresetBlock | null {
  if ((REVIEWED_FACTORY_PRESETS.qdsa as readonly number[]).includes(parent)) return "blocked_device_compatibility";
  return null;
}

const overlappingWindows: Readonly<Record<number, readonly number[]>> = REVIEWED_FACTORY_PRESETS.marinaOverlappingWindows;

export function isMarinaAvanquadroWindow(packId: number): boolean {
  return (REVIEWED_FACTORY_PRESETS.marinaAvanquadroWindows as readonly number[]).includes(packId) ||
    Object.values(overlappingWindows).some(windows => windows.includes(packId));
}

export function marinaOverlappingWindowSlot(cabinetCode: string, panelCode: string): number | undefined {
  if (!cabinetCode.startsWith("tq.pack.") || !panelCode.startsWith("tq.pack.factory.")) return;
  const windows = overlappingWindows[Number(cabinetCode.slice("tq.pack.".length))];
  const index = windows?.findIndex(packId => panelCode === `tq.pack.factory.${packId}`) ?? -1;
  return index < 0 ? undefined : index + 1;
}

/** Plexo PV uses the matching DIN profile with class 28004 and the same source device set. */
export function factoryPanelProfileSource(packId: number): number {
  return packId === 2901 ? 2193 : packId === 2902 ? 2194 : packId;
}

/** Factory-only models preserve the original packs' availability and commercial rules. */
export function reviewedFactoryChild(parent: number, child: number): boolean {
  const policy = REVIEWED_FACTORY_PRESETS;
  return (policy.marinaDin as Readonly<Record<number, number>>)[parent] === child ||
    overlappingWindows[parent]?.includes(child) === true ||
    ((policy.marinaAvanquadro as readonly number[]).includes(parent) &&
      (policy.marinaAvanquadroWindows as readonly number[]).includes(child)) ||
    (policy.plexoPv as Readonly<Record<number, number>>)[parent] === child ||
    (policy.p17Ranges.some(([first, last]) => parent >= first && parent <= last) && !factoryPresetBlock(parent) &&
      ([...policy.p17Din, ...policy.p17Sockets] as readonly number[]).includes(child));
}
