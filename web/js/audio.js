import { CONFIG } from "./config.js";

// 브라우저 오디오: BGM은 <audio> 하나, 효과음은 미리 불러온 원본을 복제해서 재생합니다.
// 브라우저 정책상 첫 클릭(unlock) 이후에만 소리가 납니다.
export class AudioManager {
  constructor(audio_index, settings) {
    this.index = audio_index ?? { mus: [], sfx: [] };
    this.settings = settings;
    this.bgm_el = null;
    this.bgm_name = null;
    this.unlocked = false;
    this.fade_timer = null;
    this.pending = null;
    this.sfx_cache = new Map();
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.pending) { const p = this.pending; this.pending = null; this.bgm(p.name, p.opts); }
  }

  _mus_file(name) {
    if (/\.(mp3|wav|ogg)$/i.test(name)) return name;
    return this.index.mus.includes(name + ".mp3") ? name + ".mp3" : name + ".wav";
  }

  bgm(name, opts = {}) {
    if (!CONFIG.bgm || !name) return;
    const file = this._mus_file(name);
    if (!this.index.mus.includes(file)) return;
    if (!this.unlocked) { this.pending = { name, opts }; return; }
    if (this.bgm_name === file && this.bgm_el && !this.bgm_el.paused) return;
    this._stop_now();
    this.pending = null;
    const el = new Audio(CONFIG.mus_dir + encodeURI(file));
    el.loop = opts.loop ?? true;
    el.volume = 0;
    this.bgm_el = el;
    this.bgm_name = file;
    this.pending = null;
    el.play().catch((err) => {
      // 우리가 곧바로 pause()/교체해서 생기는 AbortError는 정상 동작이므로 무시한다.
      // 브라우저가 자동재생을 막았을 때(NotAllowedError)만 다음 클릭에서 다시 시도한다.
      if (err?.name === "NotAllowedError" && this.bgm_el === el) { this.pending = { name, opts }; this.unlocked = false; }
    });
    this._fade_to(this._target_volume(), opts.fade_ms ?? 0);
  }

  _target_volume() { return this.settings.muted ? 0 : this.settings.bgm_volume; }

  _fade_to(target, ms, done) {
    clearInterval(this.fade_timer);
    const el = this.bgm_el;
    if (!el) return;
    if (!ms) { el.volume = target; done?.(); return; }
    const start = el.volume, t0 = performance.now();
    this.fade_timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, start + (target - start) * k));
      if (k >= 1) { clearInterval(this.fade_timer); done?.(); }
    }, 50);
  }

  _stop_now() {
    clearInterval(this.fade_timer);
    if (this.bgm_el) { this.bgm_el.pause(); this.bgm_el = null; }
    this.bgm_name = null;
  }

  stop_bgm(fade_ms = 0) {
    this.pending = null;
    if (!this.bgm_el) return;
    const el = this.bgm_el;
    this._fade_to(0, fade_ms, () => { if (this.bgm_el === el) this._stop_now(); });
  }

  sfx(name, delay = 0) {
    if (!CONFIG.sfx || !this.unlocked || this.settings.muted || !name) return;
    const file = /\.wav$/i.test(name) ? name : name + ".wav";
    if (!this.index.sfx.includes(file)) return;
    const play = () => {
      let base = this.sfx_cache.get(file);
      if (!base) { base = new Audio(CONFIG.sfx_dir + encodeURI(file)); base.preload = "auto"; this.sfx_cache.set(file, base); }
      const el = base.cloneNode();
      el.volume = this.settings.sfx_volume;
      el.play().catch(() => {});
    };
    delay > 0 ? setTimeout(play, delay) : play();
  }

  apply_settings() {
    if (this.bgm_el) this.bgm_el.volume = this._target_volume();
  }
}
