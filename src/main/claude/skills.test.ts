import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installSkills, skillsStatus, uninstallSkills } from './skills'

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'wd-skills-'))
  const from = join(base, 'bundled')
  await mkdir(join(from, 'desk-open'), { recursive: true })
  await writeFile(join(from, 'desk-open', 'SKILL.md'), '---\nname: desk-open\ndescription: Open a desk.\n---\nbody\n')
  const config = join(base, 'claude')
  await mkdir(join(config, 'skills', 'mine'), { recursive: true })
  await writeFile(join(config, 'skills', 'mine', 'SKILL.md'), 'mine')
  return { from, config }
}

describe('bundled skills', () => {
  it('reports missing, installs, notices a changed copy, and removes only its own', async () => {
    const { from, config } = await fixture()
    expect(await skillsStatus(from, config)).toEqual([{ name: 'desk-open', description: 'Open a desk.', state: 'missing' }])
    await installSkills(from, config)
    expect((await skillsStatus(from, config))[0].state).toBe('installed')
    await writeFile(join(config, 'skills', 'desk-open', 'SKILL.md'), 'old')
    expect((await skillsStatus(from, config))[0].state).toBe('outdated')
    await installSkills(from, config)
    expect(await readFile(join(config, 'skills', 'desk-open', 'SKILL.md'), 'utf8')).toContain('body')
    await uninstallSkills(from, config)
    expect((await skillsStatus(from, config))[0].state).toBe('missing')
    expect(await readFile(join(config, 'skills', 'mine', 'SKILL.md'), 'utf8')).toBe('mine')
  })
})
