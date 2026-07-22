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
const patternRow = document.getElementById('patternRow');
const patternLabel = document.getElementById('patternLabel');
const patternNote = document.getElementById('patternNote');
const assocWrap = document.getElementById('assocWrap');
const assocTags = document.getElementById('assocTags');

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

// Iterative 4-connectivity flood fill — the same idea as cv2.connectedComponents,
// just written by hand so it runs with nothing but the browser's canvas API.
function findBlobs(mask, w, h){
  const visited = new Uint8Array(w * h);
  const blobs = [];
  for (let start = 0; start < mask.length; start++){
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    let size = 0, touchesEdge = false;
    while (stack.length){
      const idx = stack.pop();
      size++;
      const x = idx % w, y = (idx / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      const neighbors = [idx-1, idx+1, idx-w, idx+w];
      for (const n of neighbors){
        if (n < 0 || n >= mask.length) continue;
        if (x === 0 && n === idx - 1) continue;
        if (x === w - 1 && n === idx + 1) continue;
        if (mask[n] && !visited[n]){ visited[n] = 1; stack.push(n); }
      }
    }
    blobs.push({ size, touchesEdge });
  }
  return blobs;
}

function analyzeImageSource(source){
  const w = WORK_SIZE, h = WORK_SIZE;
  workCanvas.width = w; workCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  const ctx = workCanvas.getContext('2d');

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

  const lesionMask = new Uint8Array(w * h);
  let leafPixels = 0, lesionPixels = 0, mildewPixels = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++){
    const r = data[i], g = data[i+1], b = data[i+2];
    const [hue, sat, val] = rgbToHsv(r, g, b);

    const isHealthy = hue >= 65 && hue <= 170 && sat > 0.18 && val > 0.18;
    const isDarkOrBrown = (hue >= 15 && hue < 65 && sat > 0.22 && val > 0.15) || (val < 0.22 && sat > 0.08 && sat < 0.7);
    const isMildew = sat < 0.14 && val > 0.45 && !isHealthy;
    const isLesion = isDarkOrBrown || isMildew;

    if (isHealthy) leafPixels++;
    if (isLesion){ lesionPixels++; lesionMask[p] = 1; }
    if (isMildew) mildewPixels++;

    if (isLesion){
      out[i]=178; out[i+1]=45; out[i+2]=35; out[i+3]=235;
    } else if (isHealthy){
      out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255;
    } else {
      out[i]=r*0.35; out[i+1]=g*0.35; out[i+2]=b*0.35; out[i+3]=255;
    }
  }

  octx.putImageData(outData, 0, 0);
  showOnly(overlayCanvas);

  const plantPixels = leafPixels + lesionPixels;
  const totalPixels = w * h;

  if (plantPixels < totalPixels * 0.06){
    renderResult({ key: 'no-leaf' });
    return;
  }

  const severity = (lesionPixels / plantPixels) * 100;
  const severityKey = severity < 8 ? 'healthy' : severity < 25 ? 'moderate' : 'severe';

  if (severityKey === 'healthy'){
    renderResult({ key: 'healthy', severity });
    return;
  }

  const blobs = findBlobs(lesionMask, w, h).filter(b => b.size >= 6); // drop noise specks
  const blobCount = blobs.length || 1;
  const avgBlobSize = lesionPixels / blobCount;
  const edgeTouchRatio = blobs.filter(b => b.touchesEdge).length / blobCount;
  const mildewRatio = mildewPixels / plantPixels;

  let pattern;
  if (mildewRatio > 0.12){
    pattern = 'mildew';
  } else if (blobCount >= 6 && avgBlobSize < 90 && edgeTouchRatio < 0.35){
    pattern = 'spot';
  } else if (edgeTouchRatio > 0.4 && avgBlobSize >= 90){
    pattern = 'blight';
  } else {
    pattern = 'diffuse';
  }

  renderResult({ key: severityKey, severity, pattern });
}

const COPY = {
  'no-leaf': {
    pill:'No leaf detected', pillBg:'#e8e6dc', pillColor:'#4a4844',
    title:'Fill more of the frame', advice:'Move closer so the leaf takes up most of the square, then scan again.',
    gaugeColor:'#b0aea5'
  },
  healthy: {
    pill:'Healthy', pillBg:'#e4e8dc', pillColor:'#4d5c3a',
    title:'Looks healthy', advice:'Little to no discoloration detected. No action needed — recheck in a few days.',
    gaugeColor:'#788c5d'
  },
  moderate: {
    pill:'Early signs', pillBg:'#f4e2d8', pillColor:'#8a4d30',
    title:'Early signs of stress', advice:'Watch for spread over the next 2–3 days before deciding whether treatment is worth the cost.',
    gaugeColor:'#d97757'
  },
  severe: {
    pill:'Advanced', pillBg:'#f0d3c5', pillColor:'#7a3a1f',
    title:'Significant leaf damage', advice:'Consider isolating affected plants and consulting local extension guidance before harvest.',
    gaugeColor:'#b85c3e'
  }
};

const PATTERNS = {
  spot: {
    label:'Leaf-spot pattern', note:'many small, separate lesions',
    tags:['Septoria leaf spot','Bacterial spot','Alternaria leaf spot']
  },
  blight: {
    label:'Blight pattern', note:'large lesions reaching the leaf edge',
    tags:['Early blight','Late blight','Bacterial blight']
  },
  mildew: {
    label:'Powdery-mildew pattern', note:'pale, dusty-looking texture',
    tags:['Powdery mildew']
  },
  diffuse: {
    label:'Diffuse chlorosis pattern', note:'soft, spreading discoloration, no sharp lesions',
    tags:['Nutrient deficiency','Natural senescence','Early-stage infection']
  }
};

function renderResult({ key, severity = null, pattern = null }){
  const c = COPY[key];
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

  if (pattern && PATTERNS[pattern]){
    const p = PATTERNS[pattern];
    patternRow.style.display = 'flex';
    patternLabel.textContent = p.label;
    patternNote.textContent = '· ' + p.note;
    assocWrap.style.display = 'block';
    assocTags.innerHTML = p.tags.map(t => `<span>${t}</span>`).join('');
  } else {
    patternRow.style.display = 'none';
    assocWrap.style.display = 'none';
  }
}
