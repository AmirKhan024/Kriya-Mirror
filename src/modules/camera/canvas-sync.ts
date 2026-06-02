/**
 * Syncs a canvas element to match the video display within a container.
 * Handles the contain mode scaling and centering.
 */
export function syncCanvasToVideo(
  container: HTMLElement,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): void {
  if (!video.videoWidth) return;

  const cW = container.clientWidth;
  const cH = container.clientHeight;
  const vW = video.videoWidth;
  const vH = video.videoHeight;

  const scale = Math.min(cW / vW, cH / vH);
  const dispW = vW * scale;
  const dispH = vH * scale;
  const offX = (cW - dispW) / 2;
  const offY = (cH - dispH) / 2;

  if (canvas.width !== vW || canvas.height !== vH) {
    canvas.width = vW;
    canvas.height = vH;
  }

  canvas.style.left = `${offX}px`;
  canvas.style.top = `${offY}px`;
  canvas.style.width = `${dispW}px`;
  canvas.style.height = `${dispH}px`;
}
