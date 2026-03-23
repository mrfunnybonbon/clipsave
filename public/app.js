// ===== DOM Elements =====
const urlInput = document.getElementById('url-input');
const clearBtn = document.getElementById('clear-btn');
const fetchBtn = document.getElementById('fetch-btn');
const loading = document.getElementById('loading');
const errorToast = document.getElementById('error-toast');
const errorMessage = document.getElementById('error-message');
const videoCard = document.getElementById('video-card');
const videoThumb = document.getElementById('video-thumb');
const videoDuration = document.getElementById('video-duration');
const videoTitle = document.getElementById('video-title');
const videoUploader = document.getElementById('video-uploader');
const videoViews = document.getElementById('video-views');
const optionsPanel = document.getElementById('options-panel');
const audioOnlyToggle = document.getElementById('audio-only-toggle');
const videoOptions = document.getElementById('video-options');
const audioOptions = document.getElementById('audio-options');
const videoFormat = document.getElementById('video-format');
const videoQuality = document.getElementById('video-quality');
const audioFormat = document.getElementById('audio-format');
const audioQuality = document.getElementById('audio-quality');
const downloadBtn = document.getElementById('download-btn');
const downloadStatus = document.getElementById('download-status');
const downloadStatusText = document.getElementById('download-status-text');
const cancelDownloadBtn = document.getElementById('cancel-download-btn');
const downloadFrame = document.getElementById('download-frame');
const loadingSpinner = loading.querySelector('.spinner');
const loadingText = loading.querySelector('span');

let currentVideoInfo = null;
let activeDownloadJob = null;
let loadingShownAt = 0;
let loadingHideTimer = null;
const DEFAULT_VIDEO_QUALITY = '1080';
const VIDEO_QUALITY_OPTIONS = [
  { value: 'best', label: 'Best Available' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];

// ===== Event Listeners =====
fetchBtn.addEventListener('click', fetchVideoInfo);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchVideoInfo();
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  urlInput.focus();
  resetUI();
});

audioOnlyToggle.addEventListener('change', () => {
  if (audioOnlyToggle.checked) {
    videoOptions.classList.add('hidden');
    audioOptions.classList.remove('hidden');
  } else {
    videoOptions.classList.remove('hidden');
    audioOptions.classList.add('hidden');
  }
});

downloadBtn.addEventListener('click', startDownload);
cancelDownloadBtn.addEventListener('click', cancelActiveDownload);

// Handle paste
urlInput.addEventListener('paste', () => {
  setTimeout(() => {
    if (urlInput.value.trim()) {
      fetchVideoInfo();
    }
  }, 100);
});

// ===== Functions =====
function normalizeYouTubeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      if (id) {
        return `https://www.youtube.com/watch?v=${id}`;
      }
    }

    if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com') {
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) {
        return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
      }
    }
  } catch {
    return rawUrl.trim();
  }

  return rawUrl.trim();
}

function safeDecodeFilename(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resetUI() {
  videoCard.classList.add('hidden');
  optionsPanel.classList.add('hidden');
  errorToast.classList.add('hidden');
  downloadStatus.classList.add('hidden');
  loading.classList.add('hidden');
  videoCard.classList.remove('is-visible');
  optionsPanel.classList.remove('is-visible');
  currentVideoInfo = null;
  activeDownloadJob = null;
  cancelDownloadBtn.classList.add('hidden');
  setDownloadStatus('Preparing download...');
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorToast.classList.remove('hidden');
  setTimeout(() => {
    errorToast.classList.add('hidden');
  }, 6000);
}

function setDownloadStatus(text) {
  downloadStatusText.textContent = text;
}

function setCancelButtonVisible(visible) {
  cancelDownloadBtn.classList.toggle('hidden', !visible);
}

function restartSpinnerAnimation(spinnerElement) {
  spinnerElement.style.animation = 'none';
  spinnerElement.offsetHeight;
  spinnerElement.style.animation = '';
}

function showLoading(message = 'Fetching video info...') {
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }

  loadingText.textContent = message;
  loading.classList.remove('hidden');
  restartSpinnerAnimation(loadingSpinner);
  loadingShownAt = Date.now();
}

function hideLoading() {
  const minimumVisibleMs = 350;
  const elapsed = Date.now() - loadingShownAt;
  const delay = Math.max(0, minimumVisibleMs - elapsed);

  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
  }

  loadingHideTimer = setTimeout(() => {
    loading.classList.add('hidden');
    loadingHideTimer = null;
  }, delay);
}

async function pollDownloadStatus(jobId) {
  while (activeDownloadJob === jobId) {
    const response = await fetch(`/api/download/${jobId}/status`);
    const status = await response.json();

    if (!response.ok) {
      throw new Error(status.error || 'Failed to read download progress');
    }

    const details = [];
    if (status.eta) details.push(`ETA ${status.eta}`);
    if (status.speed) details.push(status.speed);
    const suffix = details.length ? ` • ${details.join(' • ')}` : '';
    setDownloadStatus(status.ready ? 'Download ready...' : `${status.phase || 'Downloading'}...${suffix}`);
    setCancelButtonVisible(Boolean(status.cancellable));

    if (status.status === 'error') {
      throw new Error(status.error || 'Download failed');
    }

    if (status.status === 'cancelled') {
      throw new Error('Download cancelled');
    }

    if (status.ready) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

async function triggerCompletedDownload(jobId) {
  const checkResponse = await fetch(`/api/download/${jobId}/status`);
  const checkData = await checkResponse.json().catch(() => ({}));
  if (!checkResponse.ok || !checkData.ready) {
    throw new Error(checkData.error || 'Failed to fetch completed file');
  }

  const downloadUrl = `/api/download/${jobId}/file?ts=${Date.now()}`;
  try {
    downloadFrame.src = downloadUrl;
  } catch {
    window.location.assign(downloadUrl);
  }
}

function formatViews(count) {
  if (!count) return '—';
  if (count >= 1_000_000_000) return (count / 1_000_000_000).toFixed(1) + 'B views';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M views';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K views';
  return count.toLocaleString() + ' views';
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchVideoInfo() {
  const url = normalizeYouTubeUrl(urlInput.value.trim());
  if (!url) {
    showError('Please enter a YouTube URL');
    return;
  }
  urlInput.value = url;

  // Reset state
  resetUI();
  showLoading('Fetching video info...');
  fetchBtn.disabled = true;

  try {
    const response = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch video info');
    }

    currentVideoInfo = data;
    renderVideoInfo(data);
  } catch (err) {
    showError(err.message || 'Something went wrong');
  } finally {
    hideLoading();
    fetchBtn.disabled = false;
  }
}

function renderVideoInfo(info) {
  // Thumbnail
  if (isHttpUrl(info.thumbnail)) {
    videoThumb.src = info.thumbnail;
  } else {
    videoThumb.removeAttribute('src');
  }
  videoThumb.alt = info.title;

  // Duration
  videoDuration.textContent = info.duration_string || formatDuration(info.duration);

  // Title
  videoTitle.textContent = info.title;

  // Uploader
  videoUploader.querySelector('span').textContent = info.uploader || 'Unknown';

  // Views
  videoViews.querySelector('span').textContent = formatViews(info.view_count);

  // Show cards
  videoCard.classList.remove('hidden');
  optionsPanel.classList.remove('hidden');
  requestAnimationFrame(() => {
    videoCard.classList.add('is-visible');
    optionsPanel.classList.add('is-visible');
  });

  // Reset options
  audioOnlyToggle.checked = false;
  videoOptions.classList.remove('hidden');
  audioOptions.classList.add('hidden');
  populateVideoQualityOptions(info.formats?.videoQualities || []);
  videoQuality.value = pickDefaultVideoQuality(info.formats?.videoQualities || []);
}

function populateVideoQualityOptions(qualities) {
  const available = new Set((qualities || []).map(String));
  videoQuality.innerHTML = '';

  for (const option of VIDEO_QUALITY_OPTIONS) {
    if (option.value === 'best' || available.size === 0 || available.has(option.value)) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      videoQuality.appendChild(element);
    }
  }

  if (!videoQuality.querySelector(`option[value="${DEFAULT_VIDEO_QUALITY}"]`) && available.size > 0) {
    const closest = [...available]
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => Math.abs(a - 1080) - Math.abs(b - 1080))[0];

    if (closest) {
      const option = document.createElement('option');
      option.value = String(closest);
      option.textContent = `${closest}p`;
      videoQuality.appendChild(option);
    }
  }
}

function pickDefaultVideoQuality(qualities) {
  const normalized = (qualities || [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  if (normalized.includes(1080)) {
    return DEFAULT_VIDEO_QUALITY;
  }

  const bestUnder1080 = normalized.find((quality) => quality < 1080);
  if (bestUnder1080) {
    return String(bestUnder1080);
  }

  const bestAbove1080 = normalized.find((quality) => quality > 1080);
  if (bestAbove1080) {
    return String(bestAbove1080);
  }

  return DEFAULT_VIDEO_QUALITY;
}

async function startDownload() {
  const url = normalizeYouTubeUrl(urlInput.value.trim());
  if (!url || activeDownloadJob) return;
  urlInput.value = url;

  setDownloadStatus('Preparing download...');
  downloadBtn.disabled = true;
  downloadStatus.classList.remove('hidden');
  setCancelButtonVisible(false);

  const isAudioOnly = audioOnlyToggle.checked;

  const body = {
    url,
    audioOnly: isAudioOnly,
    videoFormat: videoFormat.value,
    videoQuality: videoQuality.value,
    audioFormat: audioFormat.value,
    audioQuality: audioQuality.value,
    title: currentVideoInfo ? currentVideoInfo.title : '',
  };

  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Download failed');
    }

    activeDownloadJob = data.jobId;
    setCancelButtonVisible(true);
    await pollDownloadStatus(data.jobId);
    await triggerCompletedDownload(data.jobId);
    setDownloadStatus('Download complete!');
    setCancelButtonVisible(false);
    setTimeout(() => {
      downloadStatus.classList.add('hidden');
    }, 3000);
  } catch (err) {
    if (err.message === 'Download cancelled') {
      setDownloadStatus('Download cancelled');
    } else {
      showError(err.message || 'Download failed');
      downloadStatus.classList.add('hidden');
    }
    setCancelButtonVisible(false);
    if (err.message === 'Download cancelled') {
      setTimeout(() => {
        downloadStatus.classList.add('hidden');
      }, 1500);
    }
  } finally {
    activeDownloadJob = null;
    downloadBtn.disabled = false;
  }
}

async function cancelActiveDownload() {
  if (!activeDownloadJob) return;

  cancelDownloadBtn.disabled = true;
  setDownloadStatus('Stopping download...');

  try {
    const response = await fetch(`/api/download/${activeDownloadJob}/cancel`, {
      method: 'POST',
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to stop download');
    }
  } catch (err) {
    showError(err.message || 'Failed to stop download');
    cancelDownloadBtn.disabled = false;
  }
}
