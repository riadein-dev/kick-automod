/**
 * Kick AutoMod - Sound Engine (Web Audio API)
 * Tok, kalın hover sesleri + ince bildirim sesleri
 */

const SoundEngine = (() => {
  let ctx = null;
  let _enabled = true;
  let _hoverEnabled = true;
  let _notificationEnabled = true;
  let _volume = 0.5;

  const savedEnabled = localStorage.getItem('soundEnabled');
  const savedHover = localStorage.getItem('soundHoverEnabled');
  const savedNotification = localStorage.getItem('soundNotificationEnabled');
  const savedVolume = localStorage.getItem('soundVolume');
  if (savedEnabled !== null) _enabled = savedEnabled === 'true';
  if (savedHover !== null) _hoverEnabled = savedHover === 'true';
  if (savedNotification !== null) _notificationEnabled = savedNotification === 'true';
  if (savedVolume !== null) _volume = parseFloat(savedVolume);

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * Tok, kalın hover sesi - mekanik klavye "thock" hissi
   */
  function playHover() {
    if (!_enabled || !_hoverEnabled || _volume <= 0) return;
    try {
      const c = getCtx();
      const t = c.currentTime;

      // Düşük frekanslı darbe - tok bas
      const osc = c.createOscillator();
      const gain = c.createGain();
      const filter = c.createBiquadFilter();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.06);
      
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, t);
      
      gain.gain.setValueAtTime(0.25 * _volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.08);

      // Noise layer - katılık hissi
      const bufferSize = c.sampleRate * 0.04;
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
      }
      const noise = c.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = c.createGain();
      const noiseFilter = c.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(400, t);
      noiseGain.gain.setValueAtTime(0.06 * _volume, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(c.destination);
      noise.start(t);
    } catch(e) {}
  }

  /**
   * Tıklama sesi - daha belirgin tok darbe
   */
  function playClick() {
    if (!_enabled || !_hoverEnabled || _volume <= 0) return;
    try {
      const c = getCtx();
      const t = c.currentTime;

      // Kalın bas darbe
      const osc = c.createOscillator();
      const gain = c.createGain();
      const filter = c.createBiquadFilter();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.08);
      
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, t);
      
      gain.gain.setValueAtTime(0.35 * _volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.1);

      // Sert darbe katmanı
      const bufferSize = c.sampleRate * 0.05;
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
      }
      const noise = c.createBufferSource();
      noise.buffer = buffer;
      const nGain = c.createGain();
      const nFilter = c.createBiquadFilter();
      nFilter.type = 'lowpass';
      nFilter.frequency.setValueAtTime(500, t);
      nGain.gain.setValueAtTime(0.1 * _volume, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(c.destination);
      noise.start(t);
    } catch(e) {}
  }

  /**
   * Bildirim sesi - ince, yumuşak çift nota (rahatsız etmeyen)
   */
  function playNotification() {
    if (!_enabled || !_notificationEnabled || _volume <= 0) return;
    try {
      const c = getCtx();
      const t = c.currentTime;

      // Birinci nota
      const osc1 = c.createOscillator();
      const gain1 = c.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523, t); // C5
      gain1.gain.setValueAtTime(0, t);
      gain1.gain.linearRampToValueAtTime(0.08 * _volume, t + 0.03);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc1.connect(gain1);
      gain1.connect(c.destination);
      osc1.start(t);
      osc1.stop(t + 0.2);

      // İkinci nota - tam beşli yukarı
      const osc2 = c.createOscillator();
      const gain2 = c.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(784, t + 0.1); // G5
      gain2.gain.setValueAtTime(0, t);
      gain2.gain.linearRampToValueAtTime(0.06 * _volume, t + 0.13);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc2.connect(gain2);
      gain2.connect(c.destination);
      osc2.start(t + 0.1);
      osc2.stop(t + 0.35);
    } catch(e) {}
  }

  function setEnabled(v) { _enabled = !!v; localStorage.setItem('soundEnabled', _enabled); }
  function isEnabled() { return _enabled; }
  
  function setHoverEnabled(v) { _hoverEnabled = !!v; localStorage.setItem('soundHoverEnabled', _hoverEnabled); }
  function isHoverEnabled() { return _hoverEnabled; }
  
  function setNotificationEnabled(v) { _notificationEnabled = !!v; localStorage.setItem('soundNotificationEnabled', _notificationEnabled); }
  function isNotificationEnabled() { return _notificationEnabled; }

  function setVolume(v) { _volume = Math.max(0, Math.min(1, v)); localStorage.setItem('soundVolume', _volume); }
  function getVolume() { return _volume; }

  return { 
    playHover, playClick, playNotification, 
    setEnabled, isEnabled, 
    setHoverEnabled, isHoverEnabled,
    setNotificationEnabled, isNotificationEnabled,
    setVolume, getVolume 
  };
})();
