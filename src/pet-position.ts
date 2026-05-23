const STORAGE_KEY = 'mypets-pet-positions-v1';

export interface PetPosition {
  x: number;
  y: number;
}

function readPositions(): Record<string, PetPosition> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, Partial<PetPosition> | undefined>;
    const positions: Record<string, PetPosition> = {};
    for (const [folder, position] of Object.entries(parsed)) {
      const x = position?.x;
      const y = position?.y;
      if (
        typeof x === 'number'
        && typeof y === 'number'
        && Number.isFinite(x)
        && Number.isFinite(y)
      ) {
        positions[folder] = {
          x: Math.round(x),
          y: Math.round(y),
        };
      }
    }
    return positions;
  } catch {
    return {};
  }
}

export function loadPetPosition(folder: string): PetPosition | null {
  return readPositions()[folder] ?? null;
}

export function readAllPositions(): Record<string, PetPosition> {
  return readPositions();
}

export function savePetPosition(folder: string, position: PetPosition): void {
  if (!folder) return;

  const positions = readPositions();
  positions[folder] = {
    x: Math.round(position.x),
    y: Math.round(position.y),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}
