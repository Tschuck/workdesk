import type { EditorWindows } from './windows'
import { workspacePath, syncWorkspace } from './workspace'
import type { BranchWorktree } from '../domain/types'

/**
 * Opens a WorkDesk's VS Code window, with the workspace file brought up to date with the WorkDesk's Branches
 * first. Every WorkDesk has its own window, left wherever the user put it and however large they made it; the
 * windows of the other WorkDesks are minimised, so one WorkDesk's editor is on screen at a time. VS Code
 * windows that are not a WorkDesk's are never touched.
 */
export class EditorController {
  constructor(
    private readonly root: string,
    private readonly windows: EditorWindows,
    private readonly branchesOf: (deskId: string) => readonly BranchWorktree[],
    private readonly deskIds: () => readonly string[] = () => []
  ) {}

  /** the others first: a window whose title only contains another one's must not end up minimised */
  private async clearOthers(deskId: string): Promise<void> {
    await this.windows.minimizeEditors(this.deskIds().filter((id) => id !== deskId))
  }

  async open(deskId: string): Promise<void> {
    await syncWorkspace(this.root, deskId, this.branchesOf(deskId))
    await this.clearOthers(deskId)
    await this.windows.openEditor(deskId, workspacePath(this.root, deskId))
  }

  isOpen(deskId: string): Promise<boolean> {
    return this.windows.isOpen(deskId)
  }

  async focusFolder(deskId: string, folderPath: string): Promise<void> {
    await syncWorkspace(this.root, deskId, this.branchesOf(deskId))
    await this.clearOthers(deskId)
    await this.windows.focusFolder(deskId, workspacePath(this.root, deskId), folderPath)
  }

  async openFile(deskId: string, file: string, line?: number): Promise<void> {
    await syncWorkspace(this.root, deskId, this.branchesOf(deskId))
    await this.clearOthers(deskId)
    await this.windows.openFile(deskId, workspacePath(this.root, deskId), file, line)
  }

  async close(deskId: string): Promise<void> {
    await this.windows.closeEditor(deskId)
  }
}
