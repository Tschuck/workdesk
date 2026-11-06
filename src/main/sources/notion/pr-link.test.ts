import { describe, expect, it } from 'vitest'
import { githubRelations, ticketKeysIn, uniqueIdProperty, urlProperty } from './pr-link'

describe('ticket keys in a branch and a title', () => {
  it('finds ACME-1205 in a branch, a title and with other separators', () => {
    expect(ticketKeysIn('acme-1205-login-selection-overhaul').map((k) => k.key)).toEqual(['ACME-1205'])
    expect(ticketKeysIn('feature/ACME-1228-extend-report-export', 'ACME-1228 Extend Report').map((k) => k.key)).toEqual(['ACME-1228'])
    expect(ticketKeysIn('fix(ACME-1251): issuer bugs')[0]).toEqual({ prefix: 'ACME', number: 1251, key: 'ACME-1251' })
    expect(ticketKeysIn('Feature ACME 1208 acme app')[0].key).toBe('ACME-1208')
  })
  it('keeps the order of the texts and leaves out what is not a key', () => {
    expect(ticketKeysIn('chore/ACME-1-x', 'ENG-22 and ACME-1').map((k) => k.key)).toEqual(['ACME-1', 'ENG-22'])
    expect(ticketKeysIn('bump undici from 5.29.0 to 8.12.3', 'sha-256-abc')).toEqual([{ prefix: 'SHA', number: 256, key: 'SHA-256' }])
    expect(ticketKeysIn(undefined, '')).toEqual([])
  })
})

describe('the schema of the tasks database', () => {
  const schema = {
    properties: {
      Name: { type: 'title' },
      ID: { type: 'unique_id', unique_id: { prefix: 'ACME' } },
      Sprint: { type: 'relation', relation: { database_id: 'aaaa-bbbb' } },
      'GitHub PRs': { type: 'relation', relation: { database_id: 'cccc-dddd' } },
      Parent: { type: 'relation', relation: { database_id: 'eeee' } }
    }
  }
  it('finds the GitHub relation and the auto-number', () => {
    expect(githubRelations(schema)).toEqual([{ name: 'GitHub PRs', databaseId: 'ccccdddd' }])
    expect(uniqueIdProperty(schema)).toEqual({ name: 'ID', prefix: 'ACME' })
    expect(githubRelations({})).toEqual([])
    expect(uniqueIdProperty({ properties: { Name: { type: 'title' } } })).toBeUndefined()
  })
  it('finds the URL property of the pull request database', () => {
    expect(urlProperty({ properties: { Name: { type: 'title' }, 'PR URL': { type: 'url' }, URL: { type: 'url' } } })).toBe('URL')
    expect(urlProperty({ properties: { Link2: { type: 'url' } } })).toBe('Link2')
    expect(urlProperty({ properties: { Name: { type: 'title' } } })).toBeUndefined()
  })
})
