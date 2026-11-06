import { useEffect, useState } from 'react'
import type { CertificateInfo } from '../main/certificates'

export interface LoadFailure {
  url: string
  code: number
  description: string
}

/** Chromium's certificate errors are -200 to -299 (ERR_CERT_…). */
export const isCertificateError = (f?: LoadFailure): boolean => !!f && f.code <= -200 && f.code > -300

type Level = 'secure' | 'local' | 'insecure' | 'broken' | 'none'

const isLocal = (host: string): boolean => /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/i.test(host)

function levelOf(url: string, cert: CertificateInfo | undefined, failure: LoadFailure | undefined): Level {
  if (failure && isCertificateError(failure)) return 'broken'
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return cert && !cert.valid ? 'broken' : 'secure'
    if (u.protocol === 'http:') return isLocal(u.hostname) ? 'local' : 'insecure'
  } catch {
    // not an address
  }
  return 'none'
}

const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const LABEL: Record<Level, string> = {
  secure: 'Connection is secure',
  local: 'Local address: not encrypted, and it does not leave this machine',
  insecure: 'Not secure: the connection is not encrypted',
  broken: 'Certificate problem: this connection cannot be trusted',
  none: ''
}

const ICON: Record<Level, string> = { secure: '🔒', local: '🔓', insecure: '⚠', broken: '⛔', none: '' }

/** The lock of the address bar: how the page was reached, and the certificate the server showed (checked by the browser, nothing is decided here). */
export function SecurityInfo({ url, failure }: { url: string; failure?: LoadFailure }) {
  const [cert, setCert] = useState<CertificateInfo>()
  const [open, setOpen] = useState(false)
  // the certificate is known once the page has been asked for: look again when the address changes or the load fails
  useEffect(() => {
    let live = true
    setCert(undefined)
    if (/^https:/i.test(failure?.url ?? url)) void window.workdesk.certificateInfo(failure?.url ?? url).then((c) => live && setCert(c), () => undefined)
    return () => {
      live = false
    }
  }, [url, failure?.url])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const level = levelOf(failure?.url ?? url, cert, failure)
  if (level === 'none') return null
  const host = (() => {
    try {
      return new URL(failure?.url ?? url).hostname
    } catch {
      return ''
    }
  })()
  return (
    <div className="security" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className={'security-btn ' + level} title={LABEL[level]} aria-label={LABEL[level]} onClick={() => setOpen(!open)}>
        {ICON[level]}
        {level === 'insecure' && <span className="security-text">Not secure</span>}
      </button>
      {open && (
        <div className="security-pop" role="dialog" aria-label="Connection and certificate">
          <p className={'security-head ' + level}>{ICON[level]} {LABEL[level]}</p>
          <p className="hint">{host}</p>
          {failure && isCertificateError(failure) && <p>The browser refused the certificate: <code>{failure.description}</code>. The page was not loaded.</p>}
          {cert ? (
            <dl className="security-cert">
              <dt>Issued to</dt><dd>{cert.subject}</dd>
              <dt>Issued by</dt><dd>{cert.issuer}</dd>
              <dt>Valid</dt><dd>{day(cert.validFrom)} – {day(cert.validTo)}{Date.now() > cert.validTo ? ' (expired)' : Date.now() < cert.validFrom ? ' (not yet valid)' : ''}</dd>
              <dt>Browser check</dt><dd>{cert.valid ? '✓ chain, date and name are in order' : `✗ ${cert.error}`}</dd>
              <dt>SHA-256</dt><dd className="mono">{cert.fingerprint}</dd>
            </dl>
          ) : (
            /^https:/i.test(failure?.url ?? url) && <p className="hint">No certificate seen yet for this host.</p>
          )}
        </div>
      )}
    </div>
  )
}
