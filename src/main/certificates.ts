/** What is known of the certificate a web page's server showed. */
export interface CertificateInfo {
  hostname: string
  /** the browser's own checks (chain, date, name) passed */
  valid: boolean
  /** why not, e.g. net::ERR_CERT_DATE_INVALID */
  error?: string
  /** who the certificate was issued to: common name and organization */
  subject: string
  /** who issued it */
  issuer: string
  /** valid from / to, in ms since 1970 */
  validFrom: number
  validTo: number
  /** SHA-256 of the certificate, as hex pairs */
  fingerprint: string
}

/** The part of Electron's verify request that is used here. */
export interface VerifyRequest {
  hostname: string
  verificationResult: string
  certificate: {
    subjectName: string
    issuerName: string
    validStart: number
    validExpiry: number
    fingerprint: string
    subject?: { commonName?: string; organizations?: string[] }
    issuer?: { commonName?: string; organizations?: string[] }
  }
}

const who = (p: { commonName?: string; organizations?: string[] } | undefined, fallback: string): string => {
  const parts = [p?.commonName, p?.organizations?.[0]].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : fallback
}

/** `sha256/<base64>` as `AB:CD:…`. */
export function fingerprintHex(fingerprint: string): string {
  const b64 = fingerprint.replace(/^sha256\//i, '')
  try {
    return Buffer.from(b64, 'base64').toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1:')
  } catch {
    return fingerprint
  }
}

/** The certificates the pages' servers showed, by host: what the lock in the address bar tells. Only reads what the browser decided; it decides nothing. */
export class CertificateLog {
  private readonly byHost = new Map<string, CertificateInfo>()

  record(r: VerifyRequest): CertificateInfo {
    const c = r.certificate
    const info: CertificateInfo = {
      hostname: r.hostname,
      valid: r.verificationResult === 'net::OK',
      ...(r.verificationResult === 'net::OK' ? {} : { error: r.verificationResult }),
      subject: who(c.subject, c.subjectName),
      issuer: who(c.issuer, c.issuerName),
      validFrom: c.validStart * 1000,
      validTo: c.validExpiry * 1000,
      fingerprint: fingerprintHex(c.fingerprint)
    }
    this.byHost.set(r.hostname.toLowerCase(), info)
    return info
  }

  /** The certificate shown for the host of this address. */
  forUrl(url: string): CertificateInfo | undefined {
    try {
      return this.byHost.get(new URL(url).hostname.toLowerCase())
    } catch {
      return undefined
    }
  }
}
