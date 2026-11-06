import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Our skills are the bundled folders; only these names are ever written or removed in a Claude config dir. */
export interface SkillStatus {
  name: string
  description: string
  /** in the config dir, with the same text as the bundled one */
  state: 'missing' | 'outdated' | 'installed'
}

const expand = (dir: string): string => (dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir)

const describe = (text: string): string => /^description:\s*(.+)$/m.exec(text)?.[1].trim() ?? ''

async function bundled(from: string): Promise<{ name: string; text: string }[]> {
  const names = (await readdir(from, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const out: { name: string; text: string }[] = []
  for (const name of names) {
    const text = await readFile(join(from, name, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (text !== undefined) out.push({ name, text })
  }
  return out
}

export async function skillsStatus(from: string, configDir: string): Promise<SkillStatus[]> {
  const target = join(expand(configDir), 'skills')
  return Promise.all(
    (await bundled(from)).map(async ({ name, text }) => {
      const have = await readFile(join(target, name, 'SKILL.md'), 'utf8').catch(() => undefined)
      return { name, description: describe(text), state: have === undefined ? 'missing' : have === text ? 'installed' : 'outdated' } as SkillStatus
    })
  )
}

/** Copy the bundled skills into `<configDir>/skills/<name>/SKILL.md`; other skills there are not touched. */
export async function installSkills(from: string, configDir: string): Promise<void> {
  const target = join(expand(configDir), 'skills')
  for (const { name, text } of await bundled(from)) {
    await mkdir(join(target, name), { recursive: true })
    await writeFile(join(target, name, 'SKILL.md'), text)
  }
}

export async function uninstallSkills(from: string, configDir: string): Promise<void> {
  const target = join(expand(configDir), 'skills')
  for (const { name } of await bundled(from)) await rm(join(target, name), { recursive: true, force: true })
}
