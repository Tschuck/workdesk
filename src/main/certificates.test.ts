import { describe, expect, it } from 'vitest'
import { CertificateLog, fingerprintHex } from './certificates'

const request = (over = {}) => ({
  hostname: 'Github.com',
  verificationResult: 'net::OK',
  certificate: {
    subjectName: 'CN=github.com',
    issuerName: 'CN=Sectigo',
    validStart: 1_700_000_000,
    validExpiry: 1_800_000_000,
    fingerprint: 'sha256/qrvM3u8=',
    subject: { commonName: 'github.com', organizations: ['GitHub, Inc.'] },
    issuer: { commonName: 'Sectigo ECC' }
  },
  ...over
})

describe('certificates of pages', () => {
  it('keeps who it was issued to and by, the dates and the fingerprint, by host', () => {
    const log = new CertificateLog()
    log.record(request())
    expect(log.forUrl('https://github.com/o/r')).toEqual({
      hostname: 'Github.com',
      valid: true,
      subject: 'github.com, GitHub, Inc.',
      issuer: 'Sectigo ECC',
      validFrom: 1_700_000_000_000,
      validTo: 1_800_000_000_000,
      fingerprint: 'AA:BB:CC:DE:EF'
    })
    expect(log.forUrl('https://other.test')).toBeUndefined()
    expect(log.forUrl('not a url')).toBeUndefined()
  })
  it('says why the browser did not trust it', () => {
    const log = new CertificateLog()
    const info = log.record(request({ verificationResult: 'net::ERR_CERT_DATE_INVALID' }))
    expect(info).toMatchObject({ valid: false, error: 'net::ERR_CERT_DATE_INVALID' })
  })
  it('falls back to the plain names', () => {
    const log = new CertificateLog()
    const r = request()
    const info = log.record({ ...r, certificate: { ...r.certificate, subject: undefined, issuer: undefined } })
    expect(info).toMatchObject({ subject: 'CN=github.com', issuer: 'CN=Sectigo' })
  })
  it('writes a fingerprint as hex pairs', () => {
    expect(fingerprintHex('sha256/AAE=')).toBe('00:01')
  })
})
