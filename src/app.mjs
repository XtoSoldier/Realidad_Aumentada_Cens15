// The controller does not own tracking visibility; MindAR still hides a lost target.
export function createPlaybackController({ videos, lossDelay = 750, onState = () => {}, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = -1;
  let visible = true;
  let muted = false;
  let lossTimer;
  let attempt = 0;
  let pending = false;
  const tracked = new Set();
  const requested = new Set();
  const cancelLoss = () => { clearTimer(lossTimer); lossTimer = undefined; };
  const pauseAll = () => { attempt++; pending = false; videos.forEach((video) => video.pause()); };
  function play() {
    if (active < 0 || !visible || !tracked.has(active) || pending) return;
    const index = active;
    const video = videos[index];
    const token = ++attempt;
    videos.forEach((other) => { if (other !== video) other.pause(); });
    video.muted = muted;
    video.volume = 1;
    if (!requested.has(index)) {
      requested.add(index);
      // Assign once, retain the element and its buffer across detections.
      log('videoRequest', { index });
      video.src = video.dataset.src;
    }
    onState('loading', index);
    pending = true;
    let result;
    try { result = video.play(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(() => {
      if (token !== attempt) {
        if (active !== index || !visible || !tracked.has(index)) video.pause();
        return;
      }
      pending = false;
      onState('playing', index);
    }).catch((error) => {
      log('playError', { index, name: error.name, message: error.message, muted });
      if (token !== attempt) return;
      pending = false;
      onState(error.name === 'NotAllowedError' ? 'blocked' : 'error', index, error);
    });
  }
  return {
    get active() { return active; },
    get muted() { return muted; },
    get isTracked() { return tracked.has(active); },
    found(index) {
      tracked.add(index);
      cancelLoss();
      if (active !== index) { pauseAll(); active = index; }
      if (!visible) return;
      if (videos[index].paused && !pending) play();
    },
    lost(index) {
      tracked.delete(index);
      if (active !== index) return;
      cancelLoss();
      lossTimer = setTimer(() => {
        pauseAll();
        onState('lost', index);
      }, lossDelay);
    },
    play,
    retryWithAudio() {
      muted = false;
      pauseAll();
      play();
    },
    setMuted(value) {
      muted = value;
      videos.forEach((video) => { video.muted = value; video.volume = 1; });
      log('sound', { muted });
      if (active >= 0 && tracked.has(active)) play();
    },
    setVisible(value) {
      visible = value;
      cancelLoss();
      if (!value) { pauseAll(); onState('background', active); }
      else play();
    },
  };
}

function initialize() {
  const scene = document.querySelector('a-scene');
  // MindAR uses the normal camera canvas, not an immersive WebXR session.
  scene.enterVR = () => Promise.resolve('Immersive mode disabled for this activity');
  const videos = [...document.querySelectorAll('video[data-src]')];
  const startButton = document.querySelector('#comenzar');
  const status = document.querySelector('#mensaje');
  const startStatus = document.querySelector('#estadoInicio');
  const replay = document.querySelector('#reproducir');
  const sound = document.querySelector('#sonido');
  const reload = document.querySelector('#recargar');
  const debugPanel = document.querySelector('#diagnostico');
  const query = new URLSearchParams(location.search);
  const debug = query.get('diagnostico') === '1';
  const delay = Number(query.get('tolerancia') ?? 750);
  const metrics = { appInitializedMs: Math.round(performance.now()), sceneLoadedMs: null, renderStartMs: null, userStartMs: null, cameraRequestMs: null, cameraGrantedMs: null, arReadyMs: null, firstTargetMs: null, videoRequestMs: {}, firstFrameMs: {} };
  const events = [];
  let started = false;
  let ready = false;
  let failed = false;
  let bootTimer;
  let videoTimer;
  let restoreCamera = () => {};
  let frameFallback = false;
  const now = () => Math.round(performance.now());
  const buffer = (video) => Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]);
  function snapshot() {
    return videos.map((video, index) => ({ index, active: playback.active === index, currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState, paused: video.paused, muted: video.muted, buffered: buffer(video) }));
  }
  function report() {
    const libraries = performance.getEntriesByType('resource').filter((entry) => /\/vendor\/.*\.js/.test(entry.name));
    const librariesReadyMs = libraries.length ? Math.max(...libraries.map((entry) => entry.responseEnd)) : null;
    return {
      metrics,
      durations: {
        sceneAfterLibraryTransferMs: metrics.renderStartMs === null || librariesReadyMs === null ? null : Math.round(metrics.renderStartMs - librariesReadyMs),
        mindarStartToReadyMs: ready ? metrics.arReadyMs - metrics.userStartMs : null,
        permissionAndCameraAcquisitionMs: metrics.cameraGrantedMs === null ? null : metrics.cameraGrantedMs - metrics.cameraRequestMs,
        postCameraInitializationMs: ready && metrics.cameraGrantedMs !== null ? metrics.arReadyMs - metrics.cameraGrantedMs : null,
        readyToFirstTargetMs: metrics.firstTargetMs === null || !ready ? null : metrics.firstTargetMs - metrics.arReadyMs,
      },
      resources: performance.getEntriesByType('resource').filter((entry) => /aframe|mindar|\.mind(?:\?|$)/.test(entry.name)).map((entry) => ({ url: entry.name, startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration), transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize })),
      firstFrameMethod: frameFallback ? 'playing fallback (approximate)' : 'requestVideoFrameCallback',
      videos: snapshot(), events,
    };
  }
  function log(event, detail = {}) {
    if (event === 'videoRequest') metrics.videoRequestMs[detail.index] = now();
    if (!debug) return;
    const row = { ms: now(), event, ...detail };
    events.push(row);
    if (events.length > 300) events.shift();
    console.debug('[El Peaton]', row);
    debugPanel.textContent = JSON.stringify(report(), null, 2);
  }
  window.elPeatonDiagnostics = { report };
  debugPanel.hidden = !debug;
  function message(text) { status.textContent = text; startStatus.textContent = text; }
  function fail(text, error) {
    if (failed) return;
    failed = true;
    clearTimeout(bootTimer);
    restoreCamera();
    playback.setVisible(false);
    const arSystem = scene.systems?.['mindar-image-system'];
    arSystem?.video?.srcObject?.getTracks().forEach((track) => track.stop());
    arSystem?.controller?.stopProcessVideo();
    message(text);
    startButton.hidden = true;
    document.querySelector('#controles').hidden = false;
    reload.hidden = false;
    log('startupError', { name: error?.name, message: error?.message });
  }
  const playback = createPlaybackController({
    videos,
    lossDelay: Number.isFinite(delay) ? Math.min(1000, Math.max(500, delay)) : 750,
    log,
    onState(state, index, error) {
      clearTimeout(videoTimer);
      replay.hidden = true;
      if (state === 'loading') {
        message(`Cargando escena ${index + 1} con ${playback.muted ? 'sonido silenciado' : 'audio'}...`);
        videoTimer = setTimeout(() => {
          if (playback.active !== index || !playback.isTracked) return;
          message('El video tarda en cargar. Revisá la conexión o tocá para reintentar.');
          replay.hidden = false;
        }, 20000);
      } else if (state === 'playing') message(`Escena ${index + 1}. ${playback.muted ? 'Sonido silenciado.' : 'Audio activado.'}`);
      else if (state === 'blocked') {
        message('El navegador necesita otro toque para reproducir esta escena con audio.');
        replay.hidden = false;
      } else if (state === 'error') {
        message(`No se pudo reproducir la escena ${index + 1}. Revisá la conexión y el archivo de video.`);
        replay.hidden = false;
        reload.hidden = false;
        log('sceneError', { index, name: error?.name });
      } else if (state === 'lost') message('Apuntá a una de las tres láminas para continuar.');
      else if (state === 'background') message('Experiencia pausada mientras está en segundo plano.');
    },
  });
  videos.forEach((video, index) => {
    video.muted = false;
    video.volume = 1;
    const plane = document.querySelector(`a-video[src="#${video.id}"]`);
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth) plane.setAttribute('height', Number(plane.getAttribute('width')) * video.videoHeight / video.videoWidth);
    });
    for (const event of ['waiting', 'stalled', 'playing', 'pause', 'error']) {
      video.addEventListener(event, () => {
        log(event, { index, currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState, muted: video.muted, buffered: buffer(video), error: video.error?.message, errorCode: video.error?.code });
        // Guard even a library-initiated play against overlapping audio.
        if (event === 'playing' && (playback.active !== index || document.hidden)) video.pause();
        if (event === 'error' && playback.active === index) {
          clearTimeout(videoTimer);
          message(`Error al cargar el video de la escena ${index + 1}. Revisá la conexión y el formato.`);
          replay.hidden = false;
          reload.hidden = false;
        }
        if ((event === 'waiting' || event === 'stalled') && playback.active === index && playback.isTracked) message(`Cargando datos de la escena ${index + 1}...`);
        if ((event === 'waiting' || event === 'stalled') && playback.active === index && playback.isTracked) {
          clearTimeout(videoTimer);
          videoTimer = setTimeout(() => {
            if (playback.active !== index || !playback.isTracked) return;
            message('La transferencia del video se interrumpió. Revisá la conexión y tocá para reintentar.');
            replay.hidden = false;
          }, 20000);
        }
        if (event === 'playing' && playback.active === index) {
          clearTimeout(videoTimer);
          replay.hidden = true;
          message(`Escena ${index + 1}. ${playback.muted ? 'Sonido silenciado.' : 'Audio activado.'}`);
        }
      });
    }
    const firstFrame = () => {
      if (metrics.firstFrameMs[index] !== undefined) return;
      metrics.firstFrameMs[index] = now();
      log('firstFrame', { index, requestToFrameMs: metrics.firstFrameMs[index] - metrics.videoRequestMs[index] });
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(firstFrame);
    else { frameFallback = true; video.addEventListener('playing', firstFrame, { once: true }); }
  });
  document.querySelectorAll('a-image').forEach((plane) => {
    const image = document.querySelector(plane.getAttribute('src'));
    const resize = () => {
      if (image.naturalWidth) plane.setAttribute('height', Number(plane.getAttribute('width')) * image.naturalHeight / image.naturalWidth);
    };
    image.addEventListener('load', resize);
    resize();
  });
  document.querySelectorAll('[mindar-image-target]').forEach((target, index) => {
    target.addEventListener('targetFound', () => {
      log('targetFound', { index });
      if (!ready || failed) return;
      metrics.firstTargetMs ??= now();
      playback.found(index);
    });
    target.addEventListener('targetLost', () => { log('targetLost', { index }); playback.lost(index); });
  });
  replay.addEventListener('click', () => { playback.retryWithAudio(); sound.textContent = 'Silenciar sonido'; sound.setAttribute('aria-pressed', 'false'); });
  sound.addEventListener('click', () => {
    playback.setMuted(!playback.muted);
    sound.textContent = playback.muted ? 'Activar sonido' : 'Silenciar sonido';
    sound.setAttribute('aria-pressed', String(playback.muted));
  });
  reload.addEventListener('click', () => location.reload());
  document.addEventListener('visibilitychange', () => playback.setVisible(!document.hidden && !failed));
  window.addEventListener('pagehide', () => playback.setVisible(false));
  window.addEventListener('pageshow', () => playback.setVisible(!document.hidden && !failed));
  if (debug) {
    const interval = setInterval(() => { debugPanel.textContent = JSON.stringify(report(), null, 2); }, 2000);
    window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  }
  scene.addEventListener('arReady', () => {
    metrics.arReadyMs = now();
    log('arReady');
    if (failed) {
      scene.systems['mindar-image-system'].stop();
      return;
    }
    ready = true;
    clearTimeout(bootTimer);
    message('Apuntá a una de las tres láminas.');
    log('startupMeasurements', report().durations);
  });
  scene.addEventListener('arError', (event) => {
    log('arError', { detail: event.detail });
    fail('No se pudo iniciar la cámara. Revisá los permisos, el certificado HTTPS y que otra aplicación no esté usando la cámara.');
  });
  startButton.disabled = true;
  function sceneReady() {
    scene.renderer.xr.enabled = false;
    metrics.renderStartMs ??= now();
    log('renderstart');
    if (started || failed) return;
    clearTimeout(bootTimer);
    startButton.disabled = false;
    message('Lista para comenzar. La cámara se solicita al tocar el botón.');
  }
  scene.addEventListener('loaded', () => { metrics.sceneLoadedMs = now(); log('sceneLoaded'); });
  scene.addEventListener('renderstart', sceneReady, { once: true });
  bootTimer = setTimeout(() => fail('La preparación está tardando demasiado. Revisá la conexión a Internet y volvé a cargar.'), 30000);
  if (scene.renderStarted) sceneReady();
  startButton.addEventListener('click', () => {
    if (started || failed) return;
    started = true;
    metrics.userStartMs = now();
    clearTimeout(bootTimer);
    document.querySelector('#inicio').hidden = true;
    document.querySelector('#controles').hidden = false;
    playback.setMuted(false);
    message('Autorizá la cámara cuando el navegador lo solicite. No se utiliza el micrófono.');
    const system = scene.systems['mindar-image-system'];
    // Observe the actual MindAR request: permission/device acquisition is not AR initialization.
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) return fail('La cámara requiere un navegador compatible y un certificado HTTPS de confianza.');
    const original = media.getUserMedia;
    const wrapped = function (constraints) {
      metrics.cameraRequestMs = now();
      log('cameraRequested', { audio: constraints.audio });
      return original.call(media, constraints).then((stream) => {
        metrics.cameraGrantedMs = now();
        restoreCamera();
        if (failed) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Startup cancelled'); }
        message('Cámara autorizada. Preparando los marcadores y el reconocimiento...');
        clearTimeout(bootTimer);
        bootTimer = setTimeout(() => fail('El reconocimiento tarda demasiado. Volvé a cargar y consultá el diagnóstico.'), 45000);
        log('cameraGranted');
        return stream;
      }).catch((error) => {
        restoreCamera();
        fail('No se pudo acceder a la cámara. Revisá el permiso y el certificado HTTPS.', error);
        throw error;
      });
    };
    try {
      media.getUserMedia = wrapped;
      restoreCamera = () => { if (media.getUserMedia === wrapped) media.getUserMedia = original; };
      const originalStartAR = system._startAR.bind(system);
      system._startAR = async function () {
        try { await originalStartAR(); }
        catch (error) { fail('No se pudieron preparar los marcadores o el reconocimiento. Volvé a cargar.', error); }
      };
      bootTimer = setTimeout(() => {
        message('Todavía esperamos la autorización o disponibilidad de la cámara. Podés volver a cargar.');
        reload.hidden = false;
      }, 30000);
      log('mindarStart');
      system.start();
    } catch (error) { fail('No se pudo iniciar la experiencia.', error); }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
