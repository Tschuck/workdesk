const MAX_BYTES = 48 * 1024

/**
 * Keeps a page's icon as a data: address, so a favorite shows it without loading the page (or being online).
 * Undefined when it is not an image, too big, or cannot be fetched.
 */
export async function cacheFavicon(src: string, fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  if (/^data:image\//i.test(src)) return src.length <= MAX_BYTES * 2 ? src : undefined
  if (!/^https?:\/\//i.test(src)) return undefined
  const res = await fetchFn(src, { signal: AbortSignal.timeout(5000) })
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!res.ok || !(type.startsWith('image/') || type === 'application/octet-stream')) return undefined
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return undefined
  // a favicon.ico is often served as octet-stream
  const mime = type.startsWith('image/') ? type : /\.ico(\?|$)/i.test(src) ? 'image/x-icon' : undefined
  return mime ? `data:${mime};base64,${bytes.toString('base64')}` : undefined
}
