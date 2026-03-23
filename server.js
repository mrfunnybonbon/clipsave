const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { accessSync, constants } = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Temp directory for downloads
const TEMP_DIR = path.join(os.tmpdir(), 'yt-dlp-downloads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
const COOKIES_PATH = path.join(TEMP_DIR, 'youtube-cookies.txt');
if (process.env.YTDLP_COOKIES) {
  fs.writeFileSync(COOKIES_PATH, process.env.YTDLP_COOKIES, 'utf8');
}
const downloadJobs = new Map();

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommandBinary(commandName, extraCandidates = []) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [
    ...extraCandidates,
    ...pathEntries.map(entry => path.join(entry, commandName)),
  ];

  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

const YT_DLP_CANDIDATES = [
  process.env.YT_DLP_PATH,
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/usr/bin/yt-dlp',
].filter(Boolean);

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
].filter(Boolean);

function getYtDlpCommand() {
  const binary = resolveCommandBinary('yt-dlp', YT_DLP_CANDIDATES);
  if (binary) {
    return { command: binary, argsPrefix: [] };
  }

  return null;
}

function getFfmpegBinary() {
  return resolveCommandBinary('ffmpeg', FFMPEG_CANDIDATES);
}

function spawnYtDlp(args) {
  const ytDlp = getYtDlpCommand();
  if (!ytDlp) {
    throw new Error('yt-dlp not found. Install yt-dlp or set YT_DLP_PATH.');
  }

  const finalArgs = process.env.YTDLP_COOKIES
    ? ['--cookies', COOKIES_PATH, ...args]
    : args;

  return spawn(ytDlp.command, [...ytDlp.argsPrefix, ...finalArgs], {
    env: {
      ...process.env,
      PATH: [
        path.dirname(ytDlp.command),
        ...(getFfmpegBinary() ? [path.dirname(getFfmpegBinary())] : []),
        process.env.PATH || '',
      ].filter(Boolean).join(path.delimiter),
    },
  });
}

function createDownloadJob(id) {
  const job = {
    id,
    status: 'queued',
    progress: 0,
    eta: null,
    speed: null,
    phase: 'Preparing download',
    error: null,
    filePath: null,
    fileName: null,
    contentType: null,
    title: null,
    proc: null,
    cancelled: false,
    createdAt: Date.now(),
  };

  downloadJobs.set(id, job);
  return job;
}

function getJob(id) {
  return downloadJobs.get(id);
}

function parseProgressLine(line, job) {
  const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
  const etaMatch = line.match(/ETA\s+([0-9:]+)/i);
  const speedMatch = line.match(/at\s+([0-9.]+[KMG]iB\/s)/i);

  if (percentMatch) {
    job.progress = Math.min(100, Math.max(0, Number(percentMatch[1])));
    job.status = 'downloading';
    job.phase = 'Downloading';
  }

  if (etaMatch) {
    job.eta = etaMatch[1];
  }

  if (speedMatch) {
    job.speed = speedMatch[1];
  }

  if (line.includes('[Merger]')) {
    job.status = 'processing';
    job.phase = 'Merging video and audio';
    job.progress = Math.max(job.progress, 95);
  } else if (line.includes('Extracting audio')) {
    job.status = 'processing';
    job.phase = 'Converting audio';
    job.progress = Math.max(job.progress, 92);
  } else if (line.includes('Destination:')) {
    job.phase = 'Preparing file';
  }
}

function cleanupJobFile(job) {
  if (!job?.filePath) return;
  try {
    fs.unlinkSync(job.filePath);
  } catch {}
  job.filePath = null;
}

function cleanupTempFiles(prefix) {
  const files = fs.readdirSync(TEMP_DIR).filter(file => file.startsWith(prefix));
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    } catch {}
  }
}

function markJobCancelled(job) {
  job.cancelled = true;
  job.status = 'cancelled';
  job.phase = 'Download cancelled';
  job.error = 'Download cancelled';
  job.eta = null;
  job.speed = null;
}

// Fetch video info
app.post('/api/info', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const args = [
    '--dump-json',
    '--skip-download',
    '--no-check-formats',
    '--no-playlist',
    '--no-warnings',
    url
  ];

  let proc;
  try {
    proc = spawnYtDlp(args);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: stderr || 'Failed to fetch video info' });
    }

    try {
      const info = JSON.parse(stdout);
      const response = {
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        duration_string: info.duration_string,
        uploader: info.uploader || info.channel,
        view_count: info.view_count,
        upload_date: info.upload_date,
        description: info.description ? info.description.substring(0, 200) : '',
        formats: extractFormats(info.formats || []),
      };
      res.json(response);
    } catch (e) {
      res.status(500).json({ error: stderr || 'Failed to parse video info' });
    }
  });

  proc.on('error', () => {
    res.status(500).json({ error: 'yt-dlp could not be started.' });
  });
});

function extractFormats(formats) {
  const videoQualities = new Set();
  const audioQualities = new Set();

  for (const f of formats) {
    if (f.height && f.vcodec !== 'none') {
      videoQualities.add(f.height);
    }
    if (f.abr && f.acodec !== 'none') {
      audioQualities.add(Math.round(f.abr));
    }
  }

  return {
    videoQualities: [...videoQualities].sort((a, b) => b - a),
    audioQualities: [...audioQualities].sort((a, b) => b - a),
  };
}

function buildDownloadArgs({ url, audioOnly, videoFormat, videoQuality, audioFormat, audioQuality, outputTemplate }, selectorMode = 'requested') {
  const args = ['--no-playlist', '--no-warnings', '--newline'];
  const ffmpegBinary = getFfmpegBinary();

  if (ffmpegBinary) {
    args.push('--ffmpeg-location', path.dirname(ffmpegBinary));
  }

  if (audioOnly) {
    args.push('-x');
    args.push('--audio-format', audioFormat || 'mp3');
    if (audioQuality && audioQuality !== 'best') {
      args.push('--audio-quality', audioQuality.replace('k', ''));
    } else {
      args.push('--audio-quality', '0');
    }
  } else {
    let formatStr = null;

    if (selectorMode === 'best') {
      formatStr = 'best';
    } else if (selectorMode === 'compatible') {
      formatStr = videoQuality && videoQuality !== 'best'
        ? `bv*+ba/b[height<=${videoQuality}]/b`
        : 'bv*+ba/b';
    } else if (videoQuality && videoQuality !== 'best') {
      formatStr = [
        `bestvideo*[height<=${videoQuality}]+bestaudio`,
        `best[height<=${videoQuality}]`,
        'best',
      ].join('/');
    }

    if (formatStr) {
      args.push('-f', formatStr);
    }

    const vFormat = videoFormat || 'mp4';
    args.push('--merge-output-format', vFormat);
  }

  args.push('-o', outputTemplate);
  args.push(url);
  return args;
}

function shouldRetryWithDifferentSelector(stderr, audioOnly) {
  if (audioOnly) {
    return false;
  }

  return /(Requested format is not available|requested format not available|format specification)/i.test(stderr || '');
}

function getNextSelectorMode(selectorMode) {
  if (selectorMode === 'requested') return 'compatible';
  if (selectorMode === 'compatible') return 'best';
  return null;
}

function attachDownloadProcess(job, request, selectorMode = 'requested') {
  const args = buildDownloadArgs(request, selectorMode);
  const proc = spawnYtDlp(args);
  let stderr = '';

  job.status = 'starting';
  job.phase = selectorMode === 'requested'
    ? 'Preparing download'
    : selectorMode === 'compatible'
      ? 'Retrying with compatible format'
      : 'Retrying with best available format';
  job.error = null;
  job.proc = proc;

  const handleProgressChunk = (chunk) => {
    const text = chunk.toString();
    stderr += text;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        parseProgressLine(line, job);
      }
    }
  };

  proc.stdout.on('data', handleProgressChunk);
  proc.stderr.on('data', handleProgressChunk);

  proc.on('close', (code) => {
    job.proc = null;

    if (job.cancelled) {
      cleanupJobFile(job);
      cleanupTempFiles(job.id);
      return;
    }

    if (code !== 0) {
      if (shouldRetryWithDifferentSelector(stderr, request.audioOnly)) {
        cleanupTempFiles(job.id);
        const nextSelectorMode = getNextSelectorMode(selectorMode);
        if (nextSelectorMode) {
          try {
            attachDownloadProcess(job, request, nextSelectorMode);
            return;
          } catch (err) {
            job.status = 'error';
            job.error = err.message;
            return;
          }
        }
      }

      job.status = 'error';
      job.error = stderr || 'Download failed';
      return;
    }

    const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(job.id));
    if (files.length === 0) {
      job.status = 'error';
      job.error = 'Downloaded file not found';
      return;
    }

    const filePath = path.join(TEMP_DIR, files[0]);
    const ext = path.extname(files[0]);
    const contentType = getContentType(ext);

    let safeTitle = (request.title || 'download')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
    if (!safeTitle) safeTitle = 'download';
    const fileName = `${safeTitle}${ext}`;
    job.filePath = filePath;
    job.fileName = fileName;
    job.contentType = contentType;
    job.status = 'ready';
    job.phase = 'Ready to save';
    job.progress = 100;
    job.eta = null;
  });

  proc.on('error', () => {
    if (job.cancelled) {
      return;
    }
    job.status = 'error';
    job.error = 'yt-dlp could not be started';
  });
}

app.post('/api/download', (req, res) => {
  const { url, audioOnly, videoFormat, videoQuality, audioFormat, audioQuality, title } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const id = uuidv4();
  const job = createDownloadJob(id);
  const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
  const request = { url, audioOnly, videoFormat, videoQuality, audioFormat, audioQuality, title, outputTemplate };

  try {
    attachDownloadProcess(job, request);
  } catch (err) {
    downloadJobs.delete(id);
    return res.status(500).json({ error: err.message });
  }
  job.title = title || null;

  res.json({ jobId: id });
});

app.get('/api/download/:id/status', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    eta: job.eta,
    speed: job.speed,
    phase: job.phase,
    error: job.error,
    ready: job.status === 'ready',
    cancellable: ['starting', 'downloading', 'processing'].includes(job.status),
  });
});

app.post('/api/download/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found' });
  }

  if (job.status === 'ready') {
    cleanupJobFile(job);
    downloadJobs.delete(job.id);
    return res.json({ cancelled: true });
  }

  if (!['starting', 'downloading', 'processing'].includes(job.status) || !job.proc) {
    return res.status(409).json({ error: 'Download is not currently running' });
  }

  markJobCancelled(job);
  try {
    job.proc.kill('SIGTERM');
  } catch {
    return res.status(500).json({ error: 'Failed to cancel download' });
  }

  res.json({ cancelled: true });
});

app.get('/api/download/:id/file', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Download job not found' });
  }

  if (job.status !== 'ready' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(409).json({ error: 'File is not ready yet' });
  }

  const encodedFilename = encodeURIComponent(job.fileName).replace(/'/g, '%27');

  res.setHeader('Content-Type', job.contentType || 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(job.filePath).size);
  res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"; filename*=UTF-8''${encodedFilename}`);

  const fileStream = fs.createReadStream(job.filePath);
  fileStream.pipe(res);

  fileStream.on('close', () => {
    cleanupJobFile(job);
    downloadJobs.delete(job.id);
  });

  fileStream.on('error', () => {
    cleanupJobFile(job);
    job.status = 'error';
    job.error = 'Failed to stream file';
  });
});

// Get filename from yt-dlp
app.post('/api/filename', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let proc;
  try {
    proc = spawnYtDlp(['--get-filename', '--no-playlist', url]);
  } catch {
    return res.json({ filename: 'download' });
  }
  let stdout = '';
  proc.stdout.on('data', d => stdout += d.toString());
  proc.on('close', () => {
    res.json({ filename: stdout.trim() });
  });
  proc.on('error', () => {
    res.json({ filename: 'download' });
  });
});

function getContentType(ext) {
  const types = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  yt-dlp Downloader running on 0.0.0.0:${PORT}\n`);
});
