/** Reading a JWT (and an SD-JWT with its disclosures) without checking anything: what is in it, with its times in words. */

export interface DecodedJwt {
  header: unknown
  payload: unknown
  /** the signature as it is (base64url): nothing is verified here */
  signature: string
  /** `iat`, `nbf`, `exp` as dates, and how far away they are */
  times: Record<string, string>
  /** the disclosures of an SD-JWT (`jwt~disclosure~…`), each decoded: [salt, name, value] or [salt, value] */
  disclosures?: unknown[]
}

function base64url(part: string): string {
  const text = part.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(text + '='.repeat((4 - (text.length % 4)) % 4)), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** JSON when it is JSON, else the text as it is */
function jsonOrText(part: string, what: string): unknown {
  let text: string
  try {
    text = base64url(part)
  } catch {
    throw new Error(`The ${what} is not base64url`)
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const ago = (seconds: number, now: number): string => {
  const d = Math.round(seconds - now)
  const abs = Math.abs(d)
  const span = abs < 90 ? `${abs} s` : abs < 5400 ? `${Math.round(abs / 60)} min` : abs < 172800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} days`
  return d < 0 ? `${span} ago` : `in ${span}`
}

const when = (seconds: number, now: number): string => `${new Date(seconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} (${ago(seconds, now)})`

/** What was pasted: `Bearer …`, quotes and line breaks are dropped. */
export function cleanToken(input: string): string {
  return input.trim().replace(/^bearer\s+/i, '').replace(/^["'`]+|["'`,;]+$/g, '').replace(/\s+/g, '')
}

export function decodeJwt(input: string, now: number = Date.now() / 1000): DecodedJwt {
  const token = cleanToken(input)
  if (!token) throw new Error('Paste a JWT first')
  const [jwt, ...rest] = token.split('~')
  const parts = jwt.split('.')
  if (parts.length === 5) throw new Error('This is an encrypted JWT (five parts): it cannot be read without the key')
  if (parts.length !== 3) throw new Error(`A JWT has three parts separated by dots; this has ${parts.length}`)
  const header = jsonOrText(parts[0], 'header')
  const payload = jsonOrText(parts[1], 'payload')
  const times: Record<string, string> = {}
  if (payload && typeof payload === 'object') {
    for (const key of ['iat', 'nbf', 'exp']) {
      const v = (payload as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) times[key] = when(v, now)
    }
  }
  const disclosures = rest.filter(Boolean).flatMap((d) => {
    // the last part of an SD-JWT with a key binding is a JWT itself
    if (d.split('.').length === 3) return [{ keyBinding: decodeJwt(d, now) }]
    try {
      return [jsonOrText(d, 'disclosure')]
    } catch {
      return [d]
    }
  })
  return { header, payload, signature: parts[2], times, ...(disclosures.length > 0 ? { disclosures } : {}) }
}

/** The text of the scratch file: the parts in order, readable. */
export function jwtFileText(decoded: DecodedJwt): string {
  const { header, payload, times, disclosures, signature } = decoded
  const out: Record<string, unknown> = { header, payload }
  if (Object.keys(times).length > 0) out.times = times
  if (disclosures) out.disclosures = disclosures
  out.signature = signature
  return JSON.stringify(out, null, 2) + '\n'
}
