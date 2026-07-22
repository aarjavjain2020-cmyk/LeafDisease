const video = document.getElementById('video');
const workCanvas = document.getElementById('workCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const hint = document.getElementById('hint');
const camBtn = document.getElementById('camBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const captureRow = document.getElementById('captureRow');
const shotBtn = document.getElementById('shotBtn');
const cancelBtn = document.getElementById('cancelBtn');
const resultEl = document.getElementById('result');
const fillRect = document.getElementById('fillRect');
const gaugeLabel = document.getElementById('gaugeLabel');
const statusPill = document.getElementById('statusPill');
const diagTitle = document.getElementById('diagTitle');
const diagAdvice = document.getElementById('diagAdvice');

let stream = null;
const WORK_SIZE = 260; // downscale for fast per-pixel analysis

function showOnly(el){
  [video, workCanvas, overlayCanvas].forEach(e => e.style.display = 'none');
  hint.style.display = 'none';
  if (el) el.style.display = 'block';
}

async function startCamera(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    showOnly(video);
    captureRow.style.display = 'flex';
    resultEl.classList.remove('show');
  }catch(err){
    hint.style.display = 'flex';
    hint.textContent = 'Camera unavailable (' + err.name + '). Try "Upload photo" instead.';
  }
}

function stopCamera(){
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
}

camBtn.addEventListener('click', startCamera);
uploadBtn.addEventListener('click', () => fileInput.click());
cancelBtn.addEventListener('click', () => {
  stopCamera();
  captureRow.style.display = 'none';
  showOnly(null);
  hint.style.display = 'flex';
  hint.innerHTML = 'Camera off.<br>Use camera or upload a leaf photo to begin.';
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => { stopCamera(); analyzeImageSource(img); };
  img.src = URL.createObjectURL(file);
});

shotBtn.addEventListener('click', () => {
  analyzeImageSource(video);
  captureRow.style.display = 'none';
});

function rgbToHsv(r, g, b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  const d = max-min;
  let h=0;
  if (d!==0){
    if (max===r) h = ((g-b)/d) % 6;
    else if (max===g) h = (b-r)/d + 2;
    else h = (r-g)/d + 4;
    h *= 60; if (h<0) h+=360;
  }
  const s = max===0 ? 0 : d/max;
  const v = max;
  return [h, s, v];
}

function analyzeImageSource(source){
  const w = WORK_SIZE, h = WORK_SIZE;
  workCanvas.width = w; workCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  const ctx = workCanvas.getContext('2d');

  // center-crop to a square before downscaling, so we're not comparing a squished image
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2, sy = (sh - side) / 2;
  ctx.drawImage(source, sx, sy, side, side, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const octx = overlayCanvas.getContext('2d');
  const outData = octx.createImageData(w, h);
  const out = outData.data;

  let leafPixels = 0, lesionPixels = 0;

  for (let i = 0; i < data.length; i += 4){
    const r = data[i], g = data[i+1], b = data[i+2];
    const [hue, sat, val] = rgbToHsv(r, g, b);

    const isHealthy = hue >= 65 && hue <= 170 && sat > 0.18 && val > 0.18;
    const isLesion  = (hue >= 15 && hue < 65 && sat > 0.22 && val > 0.15) || (val < 0.22 && sat > 0.08 && sat < 0.7);

    if (isHealthy) leafPixels++;
    if (isLesion) lesionPixels++;

    if (isLesion){
      out[i]=178; out[i+1]=45; out[i+2]=35; out[i+3]=235;      // rust red overlay
    } else if (isHealthy){
      out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255;
    } else {
      out[i]=r*0.35; out[i+1]=g*0.35; out[i+2]=b*0.35; out[i+3]=255; // dim non-plant background
    }
  }

  octx.putImageData(outData, 0, 0);
  showOnly(overlayCanvas);

  const plantPixels = leafPixels + lesionPixels;
  const totalPixels = w * h;

  if (plantPixels < totalPixels * 0.06){
    renderResult(null, 0, 'no-leaf');
  } else {
    const severity = (lesionPixels / plantPixels) * 100;
    renderResult(severity, plantPixels / totalPixels, severity < 8 ? 'healthy' : severity < 25 ? 'moderate' : 'severe');
  }
}

const COPY = {
  'no-leaf': {
    pill:'No leaf detected', pillBg:'#e2d8ba', pillColor:'#5a5142',
    title:'Fill more of the frame', advice:'Move closer so the leaf takes up most of the square, then scan again.',
    gaugeColor:'#c9bd9c'
  },
  healthy: {
    pill:'Healthy', pillBg:'#dcecd0', pillColor:'#3d6b2a',
    title:'Looks healthy', advice:'Little to no discoloration detected. No action needed — recheck in a few days.',
    gaugeColor:'#7fae5c'
  },
  moderate: {
    pill:'Early signs', pillBg:'#f3e3bb', pillColor:'#8a5f16',
    title:'Early signs of stress', advice:'Some yellowing or spotting detected. Inspect nearby plants and watch for spread over the next 2–3 days.',
    gaugeColor:'#d9a441'
  },
  severe: {
    pill:'Advanced', pillBg:'#f0d3ca', pillColor:'#7a2c19',
    title:'Significant leaf damage', advice:'Large diseased area detected. Consider isolating or removing affected plants and consult local extension guidance before harvest.',
    gaugeColor:'#b24a2e'
  }
};

function renderResult(severity, coverage, key){
  const c = COPY[key];
  resultEl.classList.add('show');
  statusPill.textContent = c.pill;
  statusPill.style.background = c.pillBg;
  statusPill.style.color = c.pillColor;
  diagTitle.textContent = c.title;
  diagAdvice.textContent = c.advice;

  const pct = severity === null ? 0 : Math.min(100, Math.round(severity));
  gaugeLabel.textContent = key === 'no-leaf' ? '—' : pct + '%';
  gaugeLabel.style.color = c.gaugeColor;

  const fillHeight = key === 'no-leaf' ? 4 : Math.max(6, (pct/100) * 128);
  fillRect.setAttribute('y', 140 - fillHeight - 6);
  fillRect.setAttribute('height', fillHeight);
  fillRect.setAttribute('fill', c.gaugeColor);
}
