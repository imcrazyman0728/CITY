// 브라우저 저장소 (localStorage). 막혀 있으면(시크릿 모드 등) 메모리에만 저장합니다.
const NS = "city:v1:";
const mem = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* 저장소 사용 불가 */ }
  return mem.has(key) ? JSON.parse(mem.get(key)) : fallback;
}
function write(key, value) {
  const raw = JSON.stringify(value);
  mem.set(key, raw);
  try { localStorage.setItem(NS + key, raw); } catch { /* 용량 초과/차단은 무시 */ }
}

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));

export const store = {
  loadProfile(defaults) {
    const saved = read("profile", null);
    return saved ?? clone(defaults);
  },
  saveProfile(profile) { write("profile", profile); },
  graves() { return read("graves", []); },
  addGrave(record) { const l = this.graves(); l.unshift(record); write("graves", l.slice(0, 200)); },
  clears() { return read("clears", []); },
  addClear(record) { const l = this.clears(); l.unshift(record); write("clears", l.slice(0, 200)); },
  settings() { return { bgm_volume: 0.5, sfx_volume: 0.8, muted: false, battle_speed: 1, ...read("settings", {}) }; },
  saveSettings(s) { write("settings", s); },
  resetAll() {
    for (const k of ["profile", "graves", "clears"]) { mem.delete(k); try { localStorage.removeItem(NS + k); } catch { /* */ } }
  },
};
