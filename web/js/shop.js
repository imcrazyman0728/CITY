// 상점 화면 (확장팩 구매, 오늘의 핫딜 24시간 리롤, 검색/태그 필터)
import * as E from "./engine.js";
import { h, clear } from "./dom.js";
import { mount, modal, toast } from "./ui.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function openShop() {
  return new Promise((resolve) => {
    let currentTab = "common"; // "common" | "reward" | "hot_deal"
    let searchQuery = "";
    let selectedTag = "전체";
    let showTags = false;

    // 프로필 안전 필드 보장
    const p = E.game.profile;
    p.lunacy ??= 0;
    p.purchased_packs ??= [];
    p.enabled_packs ??= [];
    p.hot_deal_packs ??= [];

    // 24시간 핫딜 리롤 확인
    function ensure_hot_deals() {
      const allPacks = Object.values(E.game.data?.expansion_packs ?? {});
      const hotPool = allPacks.filter((pk) => pk.shop === "hot_deal");
      const now = Date.now();
      const lastReroll = p.hot_deal_last_reroll ?? 0;

      if (!p.hot_deal_packs || now - lastReroll >= ONE_DAY_MS || !p.hot_deal_packs.length) {
        const shuffled = hotPool.slice().sort(() => Math.random() - 0.5);
        p.hot_deal_packs = shuffled.slice(0, 4).map((pk) => pk.id);
        p.hot_deal_last_reroll = now;
        E.game.hooks.save_profile(p);
      }
    }

    ensure_hot_deals();

    const draw = () => {
      ensure_hot_deals();
      const allPacks = Object.values(E.game.data?.expansion_packs ?? {});

      // 모든 태그 수집
      const tagSet = new Set(["전체"]);
      for (const pk of allPacks) {
        for (const t of pk.tags ?? []) tagSet.add(t);
      }
      const allTags = Array.from(tagSet);

      // 탭별 대상 확장팩 목록 추출
      let filteredPacks = [];
      if (currentTab === "common") {
        filteredPacks = allPacks.filter((pk) => (pk.shop ?? "common") === "common");
      } else if (currentTab === "hot_deal") {
        const dealIds = new Set(p.hot_deal_packs ?? []);
        filteredPacks = allPacks.filter((pk) => dealIds.has(pk.id) && pk.shop === "hot_deal");
      } else if (currentTab === "reward") {
        const unlockedRewardIds = new Set(p.unlocked_reward_packs ?? []);
        filteredPacks = allPacks.filter((pk) => pk.shop === "reward" && unlockedRewardIds.has(pk.id));
      }

      // 검색어 필터
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filteredPacks = filteredPacks.filter((pk) =>
          (pk.name ?? "").toLowerCase().includes(q) || (pk.desc ?? "").toLowerCase().includes(q)
        );
      }

      // 태그 필터
      if (selectedTag !== "전체") {
        filteredPacks = filteredPacks.filter((pk) => (pk.tags ?? []).includes(selectedTag));
      }

      // 1. 좌측 영역 (Left Column)
      const leftCol = h("div", { class: "shop-left-col" },
        h("div", { class: "shop-brand-block" },
          h("h1", { class: "shop-title" }, "상점"),
          h("p", { class: "shop-sub" }, "도시의 시시콜콜한 이야기와 철학들")),
        h("div", { class: "shop-currency-block" },
          h("div", { class: "shop-currency-title" }, "현재 소지 광기"),
          h("div", { class: "shop-currency-value" },
            h("span", { class: "currency-num" }, String(p.lunacy ?? 0)),
            h("span", { class: "currency-unit" }, "광기"))),
        h("div", { class: "shop-back-block" },
          h("button", { class: "shop-back-btn", onclick: () => resolve() }, "뒤로가기")));

      // 2. 우측 탭 구성 (Right Tabs)
      const tabItems = [
        ["common", "통상 확장팩"],
        ["reward", "리워드 확장팩"],
        ["hot_deal", "오늘의 핫딜!"],
      ];

      const tabsRow = h("div", { class: "shop-tabs-row", role: "tablist" }, tabItems.map(([id, label]) =>
        h("button", {
          class: `shop-tab-btn ${id === currentTab ? "active" : ""}`,
          role: "tab",
          "aria-selected": String(id === currentTab),
          onclick: () => { currentTab = id; draw(); }
        }, label)));

      // 3. 검색 및 태그 바 구성 (Search & Tag)
      const searchInput = h("input", {
        type: "text",
        class: "shop-search-input",
        placeholder: "확장팩 검색...",
        value: searchQuery,
        oninput: (e) => { searchQuery = e.target.value; drawGridOnly(); }
      });

      const tagToggleBtn = h("button", {
        class: `shop-tag-btn ${showTags || selectedTag !== "전체" ? "active" : ""}`,
        onclick: () => { showTags = !showTags; draw(); }
      }, selectedTag === "전체" ? "태그" : `태그: ${selectedTag} ✕`);

      const searchRow = h("div", { class: "shop-search-row" }, searchInput, tagToggleBtn);

      // 태그 선택 영역
      let tagChipsWrap = null;
      if (showTags) {
        tagChipsWrap = h("div", { class: "shop-tags-container" }, allTags.map((t) =>
          h("button", {
            class: `shop-tag-pill ${t === selectedTag ? "active" : ""}`,
            onclick: () => {
              if (selectedTag === t && t !== "전체") selectedTag = "전체";
              else selectedTag = t;
              draw();
            }
          }, t)));
      }

      // 4. 확장팩 목록 그리드 구성 (Cards & Slide Bar Area)
      const contentArea = h("div", { class: "shop-content-area" });

      function renderGridContent() {
        clear(contentArea);

        // 리워드 탭 해금 안내
        if (currentTab === "reward") {
          const unlockedRewardIds = new Set(p.unlocked_reward_packs ?? []);
          if (filteredPacks.length === 0) {
            contentArea.append(h("div", { class: "shop-locked-notice" },
              h("div", { style: { fontSize: "40px", marginBottom: "12px" } }, "🔒"),
              h("h2", { style: { margin: "0 0 8px" } }, "해금된 리워드 확장팩이 없습니다"),
              h("p", { class: "muted", style: { margin: 0 } }, "서재에서 도전과제를 달성하고 보상을 수령하여 리워드 확장팩을 해금하세요!"),
              h("p", { class: "muted", style: { fontSize: "13px", marginTop: "6px" } }, `현재 해금된 리워드 확장팩: ${unlockedRewardIds.size}개`)));
            return;
          }
        }

        // 오늘의 핫딜 리롤 남은 시간 안내
        if (currentTab === "hot_deal") {
          const now = Date.now();
          const last = p.hot_deal_last_reroll ?? now;
          const remainMs = Math.max(0, ONE_DAY_MS - (now - last));
          const hours = Math.floor(remainMs / (60 * 60 * 1000));
          const mins = Math.floor((remainMs % (60 * 60 * 1000)) / (60 * 1000));
          contentArea.append(h("div", { class: "shop-hotdeal-banner" },
            h("span", {}, "🔥 오늘의 핫딜은 24시간마다 새로운 4개의 확장팩으로 갱신됩니다!"),
            h("span", { class: "muted", style: { fontSize: "12.5px" } }, `다음 리롤까지 약 ${hours}시간 ${mins}분 남음`)));
        }

        if (!filteredPacks.length) {
          contentArea.append(h("div", { class: "empty-note", style: { padding: "48px 16px", textAlign: "center" } },
            currentTab === "hot_deal" ? "현재 등록된 핫딜 확장팩이 없습니다." : "해당하는 확장팩을 찾을 수 없습니다."));
          return;
        }

        const grid = h("div", { class: "shop-cards-grid" }, filteredPacks.map((pack) => {
          const isOwned = (p.purchased_packs ?? []).includes(pack.id);

          // 이미지 영역 (없다면 빈 공간 표시)
          const imgArea = pack.image
            ? h("img", { src: pack.image, alt: pack.name, class: "shop-card-img" })
            : h("div", { class: "shop-card-noimg" });

          // 태그 영역
          const tagsRow = h("div", { class: "shop-card-tags" },
            (pack.tags ?? []).map((t) => h("span", { class: "shop-card-tag" }, t)));

          // 가격/보유 뱃지
          const priceBadge = isOwned
            ? h("span", { class: "shop-card-owned" }, "보유 중")
            : h("span", { class: "shop-card-price" }, `${pack.price} 광기`);

          return h("div", {
            class: "shop-card",
            tabindex: "0",
            role: "button",
            onclick: () => open_pack_modal(pack, () => draw()),
            onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") open_pack_modal(pack, () => draw()); }
          },
            h("div", { class: "shop-card-img-box" }, imgArea),
            tagsRow,
            h("div", { class: "shop-card-foot" },
              h("div", { class: "shop-card-name" }, pack.name),
              priceBadge));
        }));

        contentArea.append(grid);
      }

      function drawGridOnly() {
        const q = searchQuery.trim().toLowerCase();
        let list = [];
        if (currentTab === "common") list = allPacks.filter((pk) => (pk.shop ?? "common") === "common");
        else if (currentTab === "hot_deal") {
          const ids = new Set(p.hot_deal_packs ?? []);
          list = allPacks.filter((pk) => ids.has(pk.id) && pk.shop === "hot_deal");
        } else list = allPacks.filter((pk) => pk.shop === "reward");

        if (q) list = list.filter((pk) => (pk.name ?? "").toLowerCase().includes(q) || (pk.desc ?? "").toLowerCase().includes(q));
        if (selectedTag !== "전체") list = list.filter((pk) => (pk.tags ?? []).includes(selectedTag));
        filteredPacks = list;
        renderGridContent();
      }

      renderGridContent();

      // 메인 컨텐츠 영역 조립 (우측 열)
      const rightCol = h("div", { class: "shop-right-col" },
        tabsRow,
        searchRow,
        tagChipsWrap,
        contentArea);

      // 전체 컨테이너 조립 (좌측 열 + 우측 열)
      const root = h("div", { class: "screen shop-screen" },
        h("div", { class: "shop-container" }, leftCol, rightCol));
      mount(root, "shop");
    };

    draw();
  });
}

// 확장팩 구매 확인 모달 팝업
function open_pack_modal(pack, onPurchased) {
  const p = E.game.profile;
  const isOwned = (p.purchased_packs ?? []).includes(pack.id);
  const canAfford = (p.lunacy ?? 0) >= pack.price;

  let m;
  const buyBtn = h("button", {
    class: "btn btn-primary",
    disabled: isOwned || !canAfford,
    onclick: () => {
      if (isOwned || !canAfford) return;
      p.lunacy -= pack.price;
      p.purchased_packs.push(pack.id);
      if (!p.enabled_packs.includes(pack.id)) {
        p.enabled_packs.push(pack.id);
      }
      E.rebuild_active_data();
      E.game.hooks.save_profile(p);
      toast(`[${pack.name}] 확장팩을 구매했습니다! 서재에서 활성화 상태를 관리할 수 있습니다.`);
      m.close();
      if (onPurchased) onPurchased();
    }
  }, isOwned ? "보유 중" : `${pack.price} 광기로 구매하기`);

  const backBtn = h("button", { class: "btn btn-ghost", onclick: () => m.close() }, "돌아가기");

  const modalBody = h("div", { class: "shop-modal-content" },
    h("h2", { style: { margin: "0 0 6px" } }, pack.name),
    h("div", { style: { display: "flex", gap: "6px", marginBottom: "14px" } },
      (pack.tags ?? []).map((t) => h("span", { class: "shop-card-tag" }, t))),
    pack.image ? h("div", { class: "shop-modal-img-wrap" }, h("img", { src: pack.image, alt: pack.name, class: "shop-modal-img" })) : null,
    h("div", { class: "shop-modal-price-row" },
      h("span", { class: "muted" }, "가격:"),
      h("span", { style: { color: "var(--brass)", fontWeight: "700", fontSize: "18px" } }, `${pack.price} 광기`),
      h("span", { class: "muted", style: { fontSize: "13px", marginLeft: "auto" } }, `현재 소지: ${p.lunacy ?? 0} 광기`)),
    h("p", { class: "shop-modal-desc" }, pack.desc || "상세 설명이 없습니다."),
    isOwned
      ? h("div", { class: "shop-modal-note note-owned" }, "✓ 이미 구매한 확장팩입니다. 서재의 '확장팩' 탭에서 언제든 켜고 끌 수 있습니다.")
      : (!canAfford ? h("div", { class: "shop-modal-note note-warn" }, `광기가 부족합니다. (필요: ${pack.price}, 보유: ${p.lunacy ?? 0})`) : null),
    h("div", { class: "modal-actions" }, backBtn, buyBtn));

  m = modal(modalBody);
  return m.promise;
}

