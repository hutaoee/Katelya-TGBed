export const IMAGE_PROCESSING_FORMATS = [
  {
    value: 'webp',
    label: 'WebP',
    mime: 'image/webp',
    extension: 'webp',
    supportsQuality: true,
  },
  {
    value: 'avif',
    label: 'AVIF',
    mime: 'image/avif',
    extension: 'avif',
    supportsQuality: true,
  },
  {
    value: 'jpeg',
    label: 'JPEG',
    mime: 'image/jpeg',
    extension: 'jpg',
    supportsQuality: true,
  },
  {
    value: 'png',
    label: 'PNG',
    mime: 'image/png',
    extension: 'png',
    supportsQuality: false,
  },
];

const UNSAFE_INPUT_MIMES = new Set(['image/gif', 'image/svg+xml']);
const IMAGE_NAME_PATTERN = /\.(avif|bmp|jpeg|jpg|png|webp)$/i;

export function getDefaultImageProcessingOptions() {
  return {
    enabled: false,
    format: 'webp',
    quality: 82,
    maxDimension: 0,
    keepOriginalWhenLarger: true,
  };
}

export async function detectImageProcessingSupport() {
  if (typeof document === 'undefined') {
    return {};
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return {};
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1, 1);

  const entries = await Promise.all(
    IMAGE_PROCESSING_FORMATS.map(async (format) => {
      try {
        const blob = await canvasToBlob(canvas, format.mime, 0.82);
        return [format.value, Boolean(blob && blob.type === format.mime)];
      } catch {
        return [format.value, false];
      }
    })
  );

  return Object.fromEntries(entries);
}

export function getImageProcessingFormat(value) {
  return IMAGE_PROCESSING_FORMATS.find((format) => format.value === value) || IMAGE_PROCESSING_FORMATS[0];
}

export function isImageProcessable(file) {
  if (!file) return false;
  const mime = String(file.type || '').toLowerCase();
  if (UNSAFE_INPUT_MIMES.has(mime)) return false;
  return mime.startsWith('image/') || IMAGE_NAME_PATTERN.test(String(file.name || ''));
}

export async function processImageFile(file, options = {}, support = {}) {
  const normalized = {
    ...getDefaultImageProcessingOptions(),
    ...options,
  };

  if (!normalized.enabled) {
    return { file, changed: false, skipped: true, reason: 'disabled' };
  }

  if (!isImageProcessable(file)) {
    return {
      file,
      changed: false,
      skipped: true,
      reason: isUnsafeImage(file) ? 'animated-or-vector' : 'not-image',
    };
  }

  const format = getImageProcessingFormat(normalized.format);
  if (support && support[format.value] === false) {
    return { file, changed: false, skipped: true, reason: 'unsupported-format' };
  }

  const maxDimension = clampInteger(normalized.maxDimension, 0, 12000);
  const quality = clampNumber(normalized.quality, 1, 100) / 100;
  const image = await loadImage(file);

  try {
    const target = resolveTargetSize(image.width, image.height, maxDimension);
    const sameFormat = sameImageFormat(file, format);
    const sameSize = target.width === image.width && target.height === image.height;

    if (sameFormat && sameSize && !format.supportsQuality) {
      return { file, changed: false, skipped: true, reason: 'no-change' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;

    const ctx = canvas.getContext('2d', { alpha: format.mime !== 'image/jpeg' });
    if (!ctx) {
      throw new Error('Image canvas is not available in this browser.');
    }

    if (format.mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, target.width, target.height);
    }

    ctx.drawImage(image.source, 0, 0, target.width, target.height);

    const blob = await canvasToBlob(
      canvas,
      format.mime,
      format.supportsQuality ? quality : undefined
    );

    if (!blob || blob.type !== format.mime) {
      return { file, changed: false, skipped: true, reason: 'unsupported-format' };
    }

    if (normalized.keepOriginalWhenLarger && blob.size >= file.size) {
      return {
        file,
        changed: false,
        skipped: true,
        reason: 'larger-output',
        originalSize: file.size,
        outputSize: blob.size,
      };
    }

    const nextFile = new File([blob], replaceExtension(file.name, format.extension), {
      type: format.mime,
      lastModified: file.lastModified || Date.now(),
    });

    return {
      file: nextFile,
      changed: true,
      skipped: false,
      reason: '',
      format: format.value,
      originalName: file.name,
      originalSize: file.size,
      outputName: nextFile.name,
      outputSize: nextFile.size,
      width: target.width,
      height: target.height,
    };
  } finally {
    image.close?.();
  }
}

function isUnsafeImage(file) {
  const mime = String(file?.type || '').toLowerCase();
  return UNSAFE_INPUT_MIMES.has(mime) || /\.gif$/i.test(String(file?.name || ''));
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mime, quality);
  });
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      };
    } catch {
      // Fall back to HTMLImageElement decoding below.
    }
  }

  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to decode this image in the browser.'));
    };

    image.decoding = 'async';
    image.src = url;
  });
}

function resolveTargetSize(width, height, maxDimension) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));

  if (!maxDimension || (safeWidth <= maxDimension && safeHeight <= maxDimension)) {
    return { width: safeWidth, height: safeHeight };
  }

  const scale = maxDimension / Math.max(safeWidth, safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function sameImageFormat(file, format) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime) return mime === format.mime;
  return new RegExp(`\\.${format.extension}$`, 'i').test(String(file?.name || ''));
}

function replaceExtension(name, extension) {
  const safeName = String(name || 'image').trim() || 'image';
  const base = safeName.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${extension}`;
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}
