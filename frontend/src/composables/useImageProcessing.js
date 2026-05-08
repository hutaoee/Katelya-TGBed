import { computed, ref } from 'vue';
import {
  IMAGE_PROCESSING_FORMATS,
  detectImageProcessingSupport,
  getDefaultImageProcessingOptions,
  getImageProcessingFormat,
  processImageFile,
} from '../utils/image-processing';

export function useImageProcessing({ formatSize }) {
  const imageProcessing = ref(getDefaultImageProcessingOptions());
  const imageProcessingSupport = ref({});

  const activeImageFormat = computed(() => getImageProcessingFormat(imageProcessing.value.format));

  const imageProcessingFormatOptions = computed(() => {
    return IMAGE_PROCESSING_FORMATS.map((format) => ({
      ...format,
      available: imageProcessingSupport.value[format.value] !== false,
    }));
  });

  const imageProcessingSummary = computed(() => {
    if (!imageProcessing.value.enabled) {
      return 'Off by default. You can choose compression after selecting image files.';
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
    prepareQueuedImage,
  };
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
