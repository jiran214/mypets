const STORAGE_KEY = 'wimipet-pet-scales-v1';
const DEFAULT_SCALE = 1;

function readScales(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scales: Record<string, number> = {};
    for (const [folder, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        scales[folder] = Math.round(value * 1000) / 1000;
      }
    }
    return scales;
  } catch {
    return {};
  }
}

export function loadPetScale(folder: string): number {
  return readScales()[folder] ?? DEFAULT_SCALE;
}

export function savePetScale(folder: string, scale: number): void {
  if (!folder) return;

  const scales = readScales();
  scales[folder] = Math.round(scale * 1000) / 1000;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scales));
}
