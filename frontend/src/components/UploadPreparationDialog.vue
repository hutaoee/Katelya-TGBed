<template>
  <div class="upload-prep-backdrop" role="presentation" @click.self="$emit('cancel')">
    <section class="upload-prep-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-prep-title">
      <header class="upload-prep-header">
        <span class="upload-prep-badge">Before upload</span>
        <h2 id="upload-prep-title">Choose how to upload images</h2>
        <p class="muted">Nothing uploads until you choose an upload mode.</p>
      </header>

      <div class="upload-prep-stats">
        <span><strong>{{ fileCount }}</strong> files selected</span>
        <span><strong>{{ imageCount }}</strong> optimizable images</span>
        <span><strong>{{ formatSize(totalSize) }}</strong> total</span>
      </div>

      <div class="upload-mode-grid">
        <button
          class="upload-mode-card"
          :class="{ active: !imageProcessing.enabled }"
          type="button"
          @click="setOptimization(false)"
        >
          <strong>Original upload</strong>
          <span>Keep every file unchanged. Fastest and safest.</span>
        </button>
        <button
          class="upload-mode-card"
          :class="{ active: imageProcessing.enabled }"
          type="button"
          @click="setOptimization(true)"
        >
          <strong>Compress / convert images</strong>
          <span>Use WebP, AVIF, JPEG, or PNG before uploading.</span>
        </button>
      </div>

      <ImageProcessingPanel
        :model-value="imageProcessing"
        :active-format="activeFormat"
        :format-options="formatOptions"
        :summary="summary"
        @update:model-value="$emit('update:imageProcessing', $event)"
        @select-format="$emit('select-format', $event)"
      />

      <div class="upload-prep-files" v-if="previewFiles.length">
        <span v-for="(file, index) in previewFiles" :key="`${file.name}_${file.size}_${index}`" class="badge">
          {{ file.name }}
        </span>
        <span v-if="fileCount > previewFiles.length" class="badge">
          +{{ fileCount - previewFiles.length }} more
        </span>
      </div>

      <footer class="upload-prep-actions">
        <button class="btn btn-ghost" type="button" @click="$emit('cancel')">Cancel</button>
        <button class="btn btn-ghost" type="button" @click="$emit('upload-original')">Upload original</button>
        <button class="btn" type="button" @click="$emit('upload-optimized')">Optimize & upload</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import ImageProcessingPanel from './ImageProcessingPanel.vue';

const props = defineProps({
  batch: {
    type: Object,
    required: true,
  },
  imageProcessing: {
    type: Object,
    required: true,
  },
  activeFormat: {
    type: Object,
    required: true,
  },
  formatOptions: {
    type: Array,
    default: () => [],
  },
  summary: {
    type: String,
    default: '',
  },
  formatSize: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits([
  'update:imageProcessing',
  'select-format',
  'upload-original',
  'upload-optimized',
  'cancel',
]);

const files = computed(() => props.batch?.files || props.batch?.items?.map((item) => item.file) || []);
const fileCount = computed(() => files.value.length);
const imageCount = computed(() => Number(props.batch?.imageCount || 0));
const totalSize = computed(() => files.value.reduce((sum, file) => sum + Number(file?.size || 0), 0));
const previewFiles = computed(() => files.value.slice(0, 5));

function setOptimization(enabled) {
  emit('update:imageProcessing', {
    ...props.imageProcessing,
    enabled,
  });
}
</script>
