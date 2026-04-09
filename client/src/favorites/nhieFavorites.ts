const STORAGE_KEY = 'tod_fav_nhie';
const MAX_FAV = 60;

export function loadNhieFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_FAV);
  } catch {
    return [];
  }
}

export function saveNhieFavorites(lines: string[]) {
  const next = [...new Set(lines.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_FAV);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function toggleNhieFavorite(line: string): string[] {
  const t = line.trim();
  if (!t) return loadNhieFavorites();
  const cur = loadNhieFavorites();
  const n = normalizeKey(t);
  const has = cur.some((c) => normalizeKey(c) === n);
  const next = has ? cur.filter((c) => normalizeKey(c) !== n) : [t, ...cur];
  return saveNhieFavorites(next);
}

function normalizeKey(s: string) {
  return s.trim().toLowerCase();
}
