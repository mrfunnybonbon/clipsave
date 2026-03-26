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
function normalizeUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  let url = rawUrl.trim();
  
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');

    // YouTube
    if (hostname === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com') {
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    }

    // TikTok
    if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) {
      // Remove query params (tracking)
      parsed.search = '';
      return parsed.toString();
    }
    if (hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
      // Short URLs are fine as is
      return url;
    }

    // Instagram
    if (hostname === 'instagram.com' || hostname === 'm.instagram.com') {
      parsed.search = '';
      return parsed.toString();
    }

    // Twitter / X
    if (hostname === 'twitter.com' || hostname === 'x.com') {
      // yt-dlp works better with twitter.com
      parsed.hostname = 'twitter.com';
      parsed.search = '';
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}

function detectPlatform(url) {
  if (!url) return 'unknown';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
  } catch {}
  return 'unknown';
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
  const url = normalizeUrl(urlInput.value.trim());
  if (!url) {
    showError('Please enter a valid URL');
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

  // Platform Badge
  const platform = info.platform || detectPlatform(info.url || urlInput.value);
  const platformIndicator = document.getElementById('platform-indicator');
  const platformName = document.getElementById('platform-name');
  const platformIcon = document.getElementById('platform-badge-icon');
  
  platformIndicator.className = 'platform-indicator is-visible ' + platform;
  
  const platformNames = {
    'youtube': 'YouTube',
    'tiktok': 'TikTok',
    'instagram': 'Instagram',
    'twitter': 'X (Twitter)',
    'unknown': 'Unknown Platform'
  };
  
  platformName.textContent = platformNames[platform] || 'Video';
  
  const icons = {
    'youtube': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    'tiktok': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.12-3.44-3.17-3.8-5.46-.4-2.51.56-5.11 2.53-6.66 1.11-.86 2.47-1.36 3.86-1.49.24-.02.48-.04.72-.02v4.06c-.04 0-.08-.01-.11-.01-1.07-.05-2.16.49-2.73 1.44-.5.81-.62 1.83-.24 2.72.39.9 1.3 1.53 2.27 1.62 1.05.07 2.1-.38 2.71-1.22.46-.66.69-1.47.67-2.28 0-4.03.02-8.06-.02-12.08.01-1.25.02-2.51.02-3.76z"/></svg>',
    'instagram': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.88z"/></svg>',
    'twitter': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    'unknown': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };
  
  platformIcon.innerHTML = icons[platform] || icons.unknown;

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
  const url = normalizeUrl(urlInput.value.trim());
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
