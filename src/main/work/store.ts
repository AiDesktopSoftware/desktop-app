import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WorkSession } from '../../renderer/src/views/work/types'

const FILE_NAME = 'work-sessions.json'

function sessionFilePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function asSessions(input: unknown): WorkSession[] {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is WorkSession => Boolean(item) && typeof item === 'object')
}

/** 读取本地会话，文件损坏或不存在时返回空数组 */
export async function loadSessions(): Promise<WorkSession[]> {
  try {
    const raw = await fs.readFile(sessionFilePath(), 'utf-8')
    return asSessions(JSON.parse(raw))
  } catch {
    return []
  }
}

/** 先写临时文件再原子替换，避免写入过程中损坏原文件 */
export async function saveSessions(sessions: unknown): Promise<void> {
  const target = sessionFilePath()
  const temp = `${target}.tmp`
  const data = JSON.stringify(asSessions(sessions), null, 2)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temp, data, 'utf-8')
  await fs.rename(temp, target)
}
