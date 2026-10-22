// 진입점: 데이터 불러오기 → 오디오 해제 화면 → 타이틀 메뉴 → 스토리/제압 모드
import * as E from "./engine.js";
import * as N from "./encounter.js";
import { h, clear } from "./dom.js";
import { ctx, mount, modal, toast, create_ui, openSettings, reset_node_state } from "./ui.js";
import { play_battle } from "./battle_view.js";
import { openLibrary, openProfile } from "./library.js";
import { openShop } from "./shop.js";
import { AudioManager } from "./audio.js";
import { store } from "./storage.js";

async function boot() {
  const root = document.getElementById("screen");
  root.append(h("div", { class: "screen gate" }, h("p", {}, "불러오는 중…")));
  let bundle;
  try {
    const res = await fetch("data/bundle.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`게임 데이터를 불러오지 못했습니다 (${res.status})`);
    bundle = await res.json();
  } catch (e) {
    clear(root).append(h("div", { class: "screen gate" }, h("p", {}, `${e.message}. 새로고침해 보세요.`)));
    return;
  }

  // 크레딧은 번들을 다시 만들지 않아도 credits.json만 고치면 바로 반영되도록 따로 읽는다.
  // (못 읽으면 번들에 들어 있는 사본을 그대로 쓴다)
  try {
    const cr = await fetch("../credits.json", { cache: "no-cache" });
    if (cr.ok) bundle.credits = await cr.json();
  } catch { /* 번들 사본 사용 */ }

  ctx.bundle = bundle;
  ctx.settings = store.settings();
  ctx.audio = new AudioManager(bundle.audio, ctx.settings);
  E.set_data(bundle);

  E.game.profile = store.loadProfile(bundle.profile_default);
  for (const k of ["achievements", "claimed_achievements", "unlocked_reward_packs", "unlocked_cards", "unlocked_enemies", "unlocked_gadgets", "purchased_packs", "enabled_packs"]) E.game.profile[k] ??= [];
  E.game.profile.char_uptie ??= {};
  E.game.profile.lunacy ??= 0;
  E.game.profile.enemy_kills ??= {};
  E.game.profile.flags ??= {};
  E.rebuild_active_data();

  E.game.hooks = {
    bgm: (name, opts) => ctx.audio.bgm(name, opts),
    stop_bgm: (ms) => ctx.audio.stop_bgm(typeof ms === "number" ? ms : 0),
    sfx: (name) => ctx.audio.sfx(name),
    save_profile: (p) => store.saveProfile(p),
    save_grave: (r) => store.addGrave(r),
    save_clear: (r) => store.addClear(r),
  };
  N.rt.ui = create_ui(play_battle);

  window.addEventListener("pointerdown", () => ctx.audio.unlock(), { once: false });
  window.addEventListener("keydown", () => ctx.audio.unlock(), { once: false });

  await gate();
  await title_loop();
}

function create_title_bg() {
  return h("div", { class: "title-bg-slides", "aria-hidden": "true" },
    h("div", { class: "title-slide slide-1" }),
    h("div", { class: "title-slide slide-2" }),
    h("div", { class: "title-slide slide-3" }),
    h("div", { class: "title-slide slide-4" }),
    h("div", { class: "title-bg-overlay" }),
  );
}

// 브라우저는 사용자 입력 전에는 소리를 낼 수 없으므로 첫 화면에서 한 번 눌러 달라고 합니다.
function gate() {
  return new Promise((resolve) => {
    const el = h("div", { class: "screen gate", tabindex: "0", role: "button", "aria-label": "시작하려면 누르세요" },
      create_title_bg(),
      h("div", { class: "gate-content" },
        h("h1", { class: "title-mark" }, "CITY"),
        h("p", {}, "화면을 누르면 시작합니다. 소리가 나옵니다."),
      ),
    );
    const go = () => { ctx.audio.unlock(); resolve(); };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(); });
    mount(el, "gate");
    el.focus();
  });
}

function pick_modal(title, sub, items) {
  const m = modal(h("div", {},
    h("h2", {}, title), sub ? h("p", { class: "sub" }, sub) : null,
    h("div", { class: "list" }, items.map((it) =>
      h("button", { class: "list-item", onclick: () => m.close(it.value) }, h("span", {}, it.label), h("span", { class: "muted" }, it.hint ?? "")))),
    h("div", { class: "modal-actions" }, h("button", { class: "btn", onclick: () => m.close(undefined) }, "취소"))));
  return m.promise;
}

async function title_loop() {
  for (;;) {
    ctx.audio.bgm("title_theme.mp3", { fade_ms: 1000 });
    reset_node_state();
    const choice = await title_screen();
    try {
      if (choice === "story") await start_story();
      // 제압 모드는 리워크 전까지 잠금 (다시 열려면 아래 줄 주석 해제 + 타이틀 메뉴의 disabled 제거)
      // else if (choice === "suppress") await suppression_mode();
      else if (choice === "library") await openLibrary();
      else if (choice === "shop") await openShop();
      else if (choice === "profile") await openProfile();
      else if (choice === "settings") await openSettings();
    } catch (err) {
      console.error(err);
      ctx.audio.stop_bgm(300);
      await new Promise((resolve) => {
        const m = modal(h("div", {},
          h("h2", {}, "문제가 생겼습니다"),
          h("p", { class: "sub" }, "게임을 계속할 수 없어 타이틀로 돌아갑니다."),
          h("pre", { style: { whiteSpace: "pre-wrap", color: "var(--dim)", fontSize: "12.5px" } }, String(err?.message ?? err)),
          h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "타이틀로"))), { dismissible: false });
        m.promise.then(resolve);
      });
    }
  }
}

function title_screen() {
  return new Promise((resolve) => {
    const item = (id, label, { disabled = false } = {}) =>
      h("button", { class: `btn ${id === "story" ? "btn-primary" : ""}`, disabled, onclick: () => resolve(id) }, label);
    const el = h("div", { class: "screen title-screen" },
      create_title_bg(),
      h("div", { class: "title-content" },
        h("h1", { class: "title-mark" }, "CITY"),
        h("p", { class: "title-sub" }, "카드를 겨누고, 주사위를 굴려, 도시의 이야기를 따라갑니다."),
        h("nav", { class: "menu", "aria-label": "메인 메뉴" },
          item("story", "게임 시작"),
          item("suppress", "제압 모드 (리워크 예정)", { disabled: true }),
          item("library", "서재"),
          item("shop", "상점"),
          item("profile", "내 정보"),
          item("settings", "설정")),
        h("p", { class: "title-foot" }, ctx.bundle.credits?.notice ?? ""),
      ),
    );
    mount(el, "title");
    el.querySelector("button")?.focus();
  });
}

// ---------- 스토리 모드 ----------
async function start_story() {
  const stories = Object.keys(ctx.bundle.stories);
  let story = stories[0];
  if (stories.length > 1) {
    story = await pick_modal("스토리 선택", "", stories.map((s) => ({ label: s, value: s })));
    if (!story) return;
  }
  N.reset_game();
  N.init_story(story);
  ctx.audio.stop_bgm(500);
  await N.game_loop();
  ctx.audio.stop_bgm(500);
  N.reset_game();
}

// ---------- 제압 모드 ----------
async function suppression_mode() {
  const source = await pick_modal("캐릭터 선택", "어떤 기록에서 불러올까요?", [
    { label: "기본 캐릭터", value: "base" },
    { label: "클리어 기록", value: "clears", hint: `${store.clears().length}건` },
  ]);
  if (!source) return;

  let data = null;
  if (source === "clears" && store.clears().length) {
    data = await pick_modal("클리어 기록", "", store.clears().map((r, i) => ({ label: `${r.name} (LV.${r.level ?? 1})`, hint: r.date, value: r })));
  } else {
    if (source === "clears") toast("클리어 기록이 없어 기본 캐릭터를 불러옵니다.");
    const chars = Object.entries(ctx.bundle.players);
    data = await pick_modal("기본 캐릭터", "", chars.map(([id, d]) => ({ label: d.name ?? d.status?.name ?? id, value: d })));
  }
  if (!data) return;

  const enemies = Object.entries(ctx.bundle.enemies).filter(([, e]) => !e._dir);
  const enemy_id = await pick_modal("적 선택", "", enemies.map(([id, e]) => ({ label: e.status?.name ?? id, value: id })));
  if (!enemy_id) return;

  N.reset_game();
  E.game.player_char = new E.PlayerChar(data);
  E.game.allies = [];
  ctx.audio.stop_bgm(500);
  await N.run_battle(enemy_id);
  if (E.game.ended) {
    await N.show_ending();
  }
  ctx.audio.stop_bgm(500);
  N.reset_game();
}

boot();
