import { ref, computed } from 'vue'
import type { FileReference, ImageReference, MessageReferences } from '#generated/types.ts'

export interface PendingImage {
  dataUrl: string
  name: string
}

export interface PendingFile {
  name: string
  path: string
  typeLabel: string
  isImage: boolean
  previewUrl?: string
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp',
}


function getFileTypeLabel(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP',
    pdf: 'PDF', md: 'Markdown file', txt: 'Text file', json: 'JSON file',
  }
  return map[ext || ''] || (ext ? `${ext.toUpperCase()} file` : 'File')
}

function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.has(ext)
}

export function useAttachments() {
  const pendingImages = ref<PendingImage[]>([])
  const pendingFiles = ref<PendingFile[]>([])

  const hasAttachments = computed(() => pendingImages.value.length > 0 || pendingFiles.value.length > 0)

  const getUniqueName = (proposed: string, existing: Set<string>): string => {
    const dotIdx = proposed.lastIndexOf('.')
    const base = dotIdx > 0 ? proposed.slice(0, dotIdx) : proposed
    const ext = dotIdx > 0 ? proposed.slice(dotIdx) : ''
    let counter = 1
    while (existing.has(`${base} ${counter}${ext}`)) counter++
    return `${base} ${counter}${ext}`
  }

  const addPendingImage = (blob: Blob, fileName?: string) => {
    const batchNames = new Set(pendingImages.value.map(img => img.name))
    const ext = blob.type.split('/')[1] || 'png'
    const name = getUniqueName(fileName || `image.${ext}`, batchNames)
    const reader = new FileReader()
    reader.onload = () => {
      pendingImages.value = [...pendingImages.value, { dataUrl: reader.result as string, name }]
    }
    reader.readAsDataURL(blob)
  }

  const addImageFromUrl = async (src: string) => {
    try {
      const response = await fetch(src)
      if (!response.ok) return
      const blob = await response.blob()
      if (blob.size === 0 || blob.size > MAX_IMAGE_SIZE) return
      const mime = blob.type || EXT_TO_MIME[new URL(src).pathname.split('.').pop()?.toLowerCase() ?? '']
      if (!mime) return
      addPendingImage(blob.type ? blob : new Blob([blob], { type: mime }))
    } catch (err) {
      console.error('Failed to fetch pasted image:', err)
    }
  }

  const handlePaste = (event: ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault()
        const file = item.getAsFile()
        if (!file || !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_SIZE) continue
        addPendingImage(file, file.name || undefined)
      }
    }
  }

  const removeImage = (i: number) => {
    pendingImages.value = pendingImages.value.filter((_, idx) => idx !== i)
  }

  const handleFileDrop = async (e: DragEvent) => {
    const files = e.dataTransfer?.files
    if (!files?.length) return
    const getPath = window.electronAPI?.fileUtils?.getPathForFile
    if (!getPath) return
    const newFiles = await Promise.all(Array.from(files).map(async (file) => {
      const p = getPath(file) as string
      if (!p) return null
      const name = p.split('/').pop() || p
      const isImg = isImageFile(name)
      let previewUrl: string | undefined
      if (isImg) {
        try {
          const ext = name.split('.').pop()?.toLowerCase() || 'png'
          const mime = EXT_TO_MIME[ext] || 'image/png'
          const base64 = await window.electronAPI?.fileUtils.readFileBase64(p)
          if (base64) previewUrl = `data:${mime};base64,${base64}`
        } catch { /* preview unavailable */ }
      }
      return { name, path: p, typeLabel: getFileTypeLabel(name), isImage: isImg, previewUrl }
    }))
    const valid: PendingFile[] = newFiles.filter((f) => f !== null)
    if (valid.length) pendingFiles.value = [...pendingFiles.value, ...valid]
  }

  const openFilePicker = async () => {
    const result = await window.electronAPI?.fileUtils.selectPath({
      type: 'file',
      allowMultiple: true,
    })
    if (!result) return
    const paths = Array.isArray(result) ? result : [result]
    const newFiles = await Promise.all(paths.map(async p => {
      const name = p.split('/').pop() || p
      const isImg = isImageFile(name)
      let previewUrl: string | undefined
      if (isImg) {
        try {
          const ext = name.split('.').pop()?.toLowerCase() || 'png'
          const mime = EXT_TO_MIME[ext] || 'image/png'
          const base64 = await window.electronAPI?.fileUtils.readFileBase64(p)
          if (base64) previewUrl = `data:${mime};base64,${base64}`
        } catch { /* preview unavailable */ }
      }
      return { name, path: p, typeLabel: getFileTypeLabel(name), isImage: isImg, previewUrl }
    }))
    pendingFiles.value = [...pendingFiles.value, ...newFiles]
  }

  const removeFile = (i: number) => {
    pendingFiles.value = pendingFiles.value.filter((_, idx) => idx !== i)
  }

  /** Snapshot both values and identities before any upload yields to later composer edits. */
  const captureAttachments = () => {
    const images = pendingImages.value.map(item => ({ item, dataUrl: item.dataUrl, name: item.name }))
    const capturedFiles = pendingFiles.value.slice()
    const files: FileReference[] = capturedFiles.map(f => ({ name: f.name, path: f.path, typeLabel: f.typeLabel, isImage: f.isImage }))
    return {
      async collect(entityId: string): Promise<MessageReferences | undefined> {
        const imageRefs: ImageReference[] = []
        for (const img of images) {
          const match = img.dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
          if (!match) throw new Error(`Cannot upload image: ${img.name}`)
          const url = await window.electronAPI?.media.upload(entityId, match[2], match[1])
          if (!url) throw new Error(`Image upload failed: ${img.name}`)
          imageRefs.push({ url, name: img.name })
        }
        if (!imageRefs.length && !files.length) return undefined
        return { ...(imageRefs.length ? { images: imageRefs } : {}), ...(files.length ? { files } : {}) }
      },
      clear() {
        const imageItems = new Set(images.map(image => image.item)), fileItems = new Set(capturedFiles)
        pendingImages.value = pendingImages.value.filter(image => !imageItems.has(image))
        pendingFiles.value = pendingFiles.value.filter(file => !fileItems.has(file))
      },
    }
  }

  /** Restore pending attachments from a persisted MessageReferences (e.g. on revert). */
  const restoreFromReferences = async (refs: MessageReferences) => {
    // Restore images — fetch uploaded URLs back into data URLs for the pending state
    if (refs.images?.length) {
      await Promise.all(refs.images.map(async (img) => {
        try {
          const response = await fetch(img.url)
          if (!response.ok) return
          const blob = await response.blob()
          if (blob.size === 0) return
          const mime = blob.type || 'image/png'
          const reader = new FileReader()
          reader.onload = () => {
            pendingImages.value = [...pendingImages.value, { dataUrl: reader.result as string, name: img.name }]
          }
          reader.readAsDataURL(blob.type ? blob : new Blob([blob], { type: mime }))
        } catch { /* image no longer accessible */ }
      }))
    }

    // Restore files — map references back to PendingFile entries, regenerate preview for images
    if (refs.files?.length) {
      const restored = await Promise.all(refs.files.map(async (f) => {
        let previewUrl: string | undefined
        if (f.isImage) {
          try {
            const ext = f.name.split('.').pop()?.toLowerCase() || 'png'
            const mime = EXT_TO_MIME[ext] || 'image/png'
            const base64 = await window.electronAPI?.fileUtils.readFileBase64(f.path)
            if (base64) previewUrl = `data:${mime};base64,${base64}`
          } catch { /* preview unavailable */ }
        }
        return { name: f.name, path: f.path, typeLabel: f.typeLabel, isImage: f.isImage, previewUrl }
      }))
      pendingFiles.value = [...pendingFiles.value, ...restored]
    }
  }

  return {
    pendingImages,
    pendingFiles,
    hasAttachments,
    handlePaste,
    handleFileDrop,
    addImageFromUrl,
    removeImage,
    openFilePicker,
    removeFile,
    captureAttachments,
    restoreFromReferences,
  }
}
