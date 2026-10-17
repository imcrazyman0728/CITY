// 사용법: node web/tests/flow.test.mjs   (저장소 루트에서)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = await import("../js/engine.js");
const N = await import("../js/encounter.js");
const bundle = JSON.parse(fs.readFileSync(path.join(here, "../data/bundle.json"), "utf8"));

function make_rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function run_game({ seed, skip_prologue, always_fight }) {
  E.set_data(bundle);
  E.set_rng(make_rng(seed));
  N.reset_game();
  E.game.profile = JSON.parse(JSON.stringify(bundle.profile_default));
  if (!skip_prologue) E.game.profile.flags.camelia_prologue = 0;
  const saved = { grave: [], clear: [], profile: 0 };
  E.game.hooks = {
    bgm() {}, stop_bgm() {}, sfx() {},
    save_profile() { saved.profile++; },
    save_grave(r) { saved.grave.push(r); },
    save_clear(r) { saved.clear.push(r); },
  };
  const log = { nodes: 0, battles: 0, notes: [], rolls: 0, levelups: 0 };
  const rng = make_rng(seed + 99);

  N.rt.ui = {
    async node({ text, choices }) {
      log.nodes++;
      if (log.nodes > 600) throw new Error("노드가 너무 많음: 무한 루프 의심");
      const met = choices.map((c, i) => (c.met ? i : -1)).filter((i) => i >= 0);
      // 스킵 선택지를 우선, 아니면 전투(무기를 든다 등)를 우선, 그 외 무작위
      let pick = met.find((i) => /넘어가자고/.test(choices[i].text));
      if (pick === undefined && always_fight) pick = met.find((i) => /무기를 든다|바라던 바다/.test(choices[i].text));
      if (pick === undefined) pick = met[Math.floor(rng() * met.length)];
      return pick;
    },
    notes(lines) { log.notes.push(...lines); },
    async roll() { log.rolls++; },
    async pickCard({ items }) { return items.length ? items[0].id : null; },
    async pickGadget({ items }) { return items.length ? items[0].id : null; },
    async levelUp({ options }) { log.levelups++; return 0; },
    async battle(battle) {
      log.battles++;
      let outcome = "continue", turns = 0;
      while (outcome === "continue") {
        if (++turns > 60) throw new Error("전투가 끝나지 않음");
        battle.start_turn();
        const p = battle.player;
        for (let slot = 0; slot < p.card_slot; slot++) {
          const idx = p.hand.findIndex((c) => c.type !== "on_play" && c.cost <= p.current_cost + (p.equipped[slot]?.cost ?? 0));
          if (idx >= 0) battle.equip(p, idx, slot, battle.enemies[0], 0);
        }
        outcome = battle.resolve();
        E.drain_events();
      }
      return outcome;
    },
    async ending({ name, dead }) { log.ending = { name, dead }; return "테스트 유언"; },
  };

  return N.init_story, { saved, log, run: async () => {
    N.init_story("메인스토리 - 선홍빛 참회록");
    // 스토리의 첫 노드들이 load_player_char를 호출하므로 플레이어는 인카운터가 만든다.
    await N.game_loop();
    return { saved, log };
  } };
}

let failures = 0;
const results = [];
for (const skip_prologue of [true, false]) {
  for (let seed = 1; seed <= 12; seed++) {
    try {
      const g = run_game({ seed, skip_prologue, always_fight: seed % 2 === 0 });
      const { saved, log } = await g.run();
      if (!log.ending) throw new Error("엔딩에 도달하지 못함");
      if (log.ending.dead && saved.grave.length !== 1) throw new Error("사망인데 묘비 저장이 안 됨");
      if (!log.ending.dead && saved.clear.length !== 1) throw new Error("클리어인데 기록 저장이 안 됨");
      results.push(`${skip_prologue ? "스킵" : "정주행"} seed=${seed}: ${log.ending.dead ? "사망" : "클리어"} (${log.ending.name}) 노드 ${log.nodes} 전투 ${log.battles} 판정 ${log.rolls} 레벨업 ${log.levelups}`);
    } catch (e) {
      failures++;
      results.push(`FAIL ${skip_prologue ? "스킵" : "정주행"} seed=${seed}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`);
    }
  }
}
console.log(results.join("\n"));
console.log(failures ? `\n실패 ${failures}건` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
