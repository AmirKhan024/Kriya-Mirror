/**
 * Downloads MediaPipe WASM binaries + pose model at build time.
 * Called by Vercel build via package.json "prebuild" script.
 * Uses Node.js instead of bash to avoid CRLF line-ending issues on Windows.
 */
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import https from 'https';

const DIR = join(process.cwd(), 'public', 'mediapipe');
mkdirSync(DIR, { recursive: true });

const VISION_VER = '0.10.32';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VER}/wasm`;

const WASM_FILES = [
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.wasm',
    'vision_wasm_internal.js',
    'vision_wasm_nosimd_internal.js',
  ];

const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const MODEL_FILE = 'pose_landmarker_lite.task';

function download(url, dest) {
    return new Promise((resolve, reject) => {
          const file = createWriteStream(dest);
          https.get(url, (res) => {
                  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            file.close();
                            return download(res.headers.location, dest).then(resolve).catch(reject);
                  }
                  res.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
          }).on('error', (err) => { file.close(); reject(err); });
    });
}

async function main() {
    for (const f of WASM_FILES) {
          const dest = join(DIR, f);
          if (existsSync(dest)) {
                  console.log(`[ok] ${f} already exists`);
          } else {
                  console.log(`[dl] Downloading ${f} ...`);
                  await download(`${BASE}/${f}`, dest);
          }
    }

  const modelDest = join(DIR, MODEL_FILE);
    if (existsSync(modelDest)) {
          console.log(`[ok] ${MODEL_FILE} already exists`);
    } else {
          console.log(`[dl] Downloading ${MODEL_FILE} ...`);
          await download(MODEL_URL, modelDest);
    }

  console.log('[done] MediaPipe assets ready');
}

main().catch((err) => { console.error(err); process.exit(1); });
