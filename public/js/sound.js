/**
 * Kick AutoMod - Sound Engine (Web Audio API)
 * Tok hover sesleri + ince bildirim sesleri
 */

const SoundEngine = (() => {
  let ctx = null;
  let _enabled = true;
  let _volume = 0.5; // 0-1

  // localStorage'dan ayarları yükle
  const savedEnabled = localStorage.getItem('soundEnabled');
  const savedVolume = localStorage.getItem('soundVolume');
  if (savedEnabled !== null) _enabled = savedEnabled === 'true';
  if (savedVolume !== null) _volume = parseFloat(savedVolume);

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * Tok, katı hover sesi - kısa mekanik "tık"
   */
  function playHover() {
    if (!_enabled || _volume <= 0) return;
    try {
      const c = getCtx();
      const t = c.currentTime;

      // Ana ton - kısa, tok
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1800, t);
      osc.frequency.exponentialRampToValueAtTime(600, t + 0.03);
      gain.gain.setValueAtTime(0.08 * _volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.05);

      // İkinci katman - darbe hissi
      const osc2 = c.createOscillator();
      const gain2 = c.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(3200, t);
      osc2.frequency.exponentialRampToValueAtTime(800, t + 0.015);
      gain2.gain.setValueAtTime(0.04 * _volume, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      osc2.connect(gain2);
      gain2.connect(c.destination);
      osc2.start(t);
      osc2.stop(t + 0.03);
    } catch(e) {}
  }

  /**
   * Tıklama sesi - biraz daha belirgin tok ses
   */
  function playClick() {
    if (!_enabled || _volume <= 0) return;
    try {
      const c = getCtx();
      const t = c.currentTime;

      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(2400, t);
      osc.frequency.exponentialRampToValueAtTime(400, t + 0.04);
      gain.gain.setValueAtTime(0.12 * _volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    } catch(e) {}
  }

  /**
   * Bildirim sesi - ince, yumuşak çift nota (rahatsız etmeyen)
   */
  function playNotification() {
    if (!_enabled || _volume <= 0) return;
    try {
      const c = getCtx();
      const t = c.currentTime;

      // Birinci nota - yüksek, ince
      const osc1 = c.createOscillator();
      const gain1 = c.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, t);
      gain1.gain.setValueAtTime(0, t);
      gain1.gain.linearRampToValueAtTime(0.1 * _volume, t + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc1.connect(gain1);
      gain1.connect(c.destination);
      osc1.start(t);
      osc1.stop(t + 0.25);

      // İkinci nota - yarım ton yukarı, daha ince
      const osc2 = c.createOscillator();
      const gain2 = c.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1175, t + 0.12);
      gain2.gain.setValueAtTime(0, t);
      gain2.gain.linearRampToValueAtTime(0.08 * _volume, t + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc2.connect(gain2);
      gain2.connect(c.destination);
      osc2.start(t + 0.12);
      osc2.stop(t + 0.4);
    } catch(e) {}
  }

  // Getter/Setter
  function setEnabled(v) {
    _enabled = !!v;
    localStorage.setItem('soundEnabled', _enabled);
  }
  function isEnabled() { return _enabled; }
  function setVolume(v) {
    _volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('soundVolume', _volume);
  }
  function getVolume() { return _volume; }

  return {
    playHover,
    playClick,
    playNotification,
    setEnabled,
    isEnabled,
    setVolume,
    getVolume
  };
})();
