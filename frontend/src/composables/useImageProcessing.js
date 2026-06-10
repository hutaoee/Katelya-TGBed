import { computed, ref } from 'vue';
import {
  IMAGE_PROCESSING_FORMATS,
  detectImageProcessingSupport,
  getDefaultImageProcessingOptions,
  getImageProcessingFormat,
  processImageFile,
} from '../utils/image-processing';

const IMAGE_UPLOAD_DECISION_KEY = 'kvault:image-upload-decision';
const IMAGE_UPLOAD_DECISIONS = new Set(['original', 'optimized', 'ask']);

export function useImageProcessing({ formatSize }) {
  const imageProcessing = ref(getDefaultImageProcessingOptions());
  const imageProcessingSupport = ref({});
  const imageUploadDecision = ref(loadImageUploadDecision());

  const activeImageFormat = computed(() => getImageProcessingFormat(imageProcessing.value.format));

  const imageProcessingFormatOptions = computed(() => {
    return IMAGE_PROCESSING_FORMATS.map((format) => ({
      ...format,
      available: imageProcessingSupport.value[format.value] !== false,
    }));
  });

  const imageProcessingSummary = computed(() => {
    if (!imageProcessing.value.enabled) {
      return 'Original files are uploaded unless you switch the image behavior to optimized.';
    }

    const parts = [activeImageFormat.value.label];
    if (activeImageFormat.value.supportsQuality) {
      parts.push(`${imageProcessing.value.quality}% quality`);
    }
    if (Number(imageProcessing.value.maxDimension) > 0) {
      parts.push(`max ${imageProcessing.value.maxDimension}px`);
    }
    return `Enabled for supported images: ${parts.join(', ')}.`;
  });

  async function refreshImageProcessingSupport() {
    imageProcessingSupport.value = await detectImageProcessingSupport();
    if (imageProcessingSupport.value[imageProcessing.value.format] === false) {
      const fallback = IMAGE_PROCESSING_FORMATS.find((format) => imageProcessingSupport.value[format.value] !== false);
      if (fallback) {
        imageProcessing.value.format = fallback.value;
      }
    }
  }

  function selectImageFormat(format) {
    if (imageProcessingSupport.value[format] === false) return;
    imageProcessing.value.format = format;
  }

  function getImageProcessingSnapshot() {
    return {
      ...getDefaultImageProcessingOptions(),
      ...imageProcessing.value,
      enabled: Boolean(imageProcessing.value.enabled),
    };
  }

  function setImageUploadDecision(decision) {
    const normalized = IMAGE_UPLOAD_DECISIONS.has(decision) ? decision : 'original';
    imageUploadDecision.value = normalized;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(IMAGE_UPLOAD_DECISION_KEY, normalized);
    }
  }

  function getImageProcessingSnapshotForDecision(decision = imageUploadDecision.value) {
    const snapshot = getImageProcessingSnapshot();
    if (decision === 'optimized') return { ...snapshot, enabled: true };
    return { ...snapshot, enabled: false };
  }

  async function prepareQueuedImage(item) {
    if (item.imageProcessingPrepared) return;
    item.imageProcessingPrepared = true;

    const options = item.imageProcessingOptions || {};
    if (!options.enabled) return;

    item.status = 'optimizing';
    item.optimizationNote = 'Preparing optimized image...';

    try {
      const result = await processImageFile(item.file, options, imageProcessingSupport.value);
      if (result.changed) {
        item.file = result.file;
      }
      item.optimizationNote = formatOptimizationResult(result, formatSize);
    } catch (err) {
      item.optimizationNote = `Image optimization skipped: ${err.message || 'browser could not process this image'}.`;
    }
  }

  return {
    imageProcessing,
    imageProcessingSupport,
    activeImageFormat,
    imageProcessingFormatOptions,
    imageProcessingSummary,
    refreshImageProcessingSupport,
    selectImageFormat,
    getImageProcessingSnapshot,
    getImageProcessingSnapshotForDecision,
    imageUploadDecision,
    setImageUploadDecision,
    prepareQueuedImage,
  };
}

function loadImageUploadDecision() {
  if (typeof localStorage === 'undefined') return 'original';
  const stored = localStorage.getItem(IMAGE_UPLOAD_DECISION_KEY);
  return IMAGE_UPLOAD_DECISIONS.has(stored) ? stored : 'original';
}

function formatOptimizationResult(result, formatSize) {
  if (!result) return '';
  if (result.changed) {
    const saved = Math.max(0, result.originalSize - result.outputSize);
    const percent = result.originalSize > 0 ? Math.round((saved / result.originalSize) * 100) : 0;
    return `Optimized: ${formatSize(result.originalSize)} -> ${formatSize(result.outputSize)} (${percent}% smaller).`;
  }

  const reasonMap = {
    'animated-or-vector': 'animated GIF or vector image',
    'not-image': 'not an image',
    'unsupported-format': 'browser cannot encode the selected format',
    'larger-output': 'optimized file would be larger',
    'no-change': 'selected PNG settings would not change the file',
  };
  const reason = reasonMap[result.reason] || 'not needed';
  return `Image optimization skipped: ${reason}.`;
}
