/** Opens, raises and closes the VS Code window of a WorkDesk. The window is the user's own: its size and place are never touched. */
export interface EditorWindows {
  /** bring the WorkDesk's window to the front, opening it when needed */
  openEditor(deskId: string, workspaceFile: string): Promise<void>
  /** is there a VS Code window for this WorkDesk (without opening one) */
  isOpen(deskId: string): Promise<boolean>
  /** get the windows of other WorkDesks out of the way (minimised, not closed) */
  minimizeEditors(deskIds: readonly string[]): Promise<void>
  closeEditor(deskId: string): Promise<void>
  /** show a file (at a line) in the WorkDesk's editor, opening the window when needed */
  openFile(deskId: string, workspaceFile: string, file: string, line?: number): Promise<void>
  /** bring a Branch's folder to the front of the editor, opening the window when needed */
  focusFolder(deskId: string, workspaceFile: string, folderPath: string): Promise<void>
}
