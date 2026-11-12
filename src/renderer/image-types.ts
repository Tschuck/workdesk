// The images a File pane shows as a picture instead of as text, by their file name.
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

/** The MIME type of an image file, or undefined when it is no image the pane shows. */
export function imageMime(path: string): string | undefined {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  return ext ? IMAGE_MIME[ext] : undefined
}

/** SVG is text: the pane keeps it in the editor too, and the picture is drawn from that text. */
export const isSvg = (path: string): boolean => imageMime(path) === 'image/svg+xml'

/** "12 KB", "3.4 MB": the size of a file in the image bar. */
export function byteSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
