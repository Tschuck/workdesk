export interface ToolCheck {
  name: string
  required: boolean
  ok: boolean
  version?: string
  hint: string
}

export const missingRequired = (checks: readonly ToolCheck[]): ToolCheck[] => checks.filter((c) => c.required && !c.ok)
