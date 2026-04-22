export const SYSTEM_PROMPT_SAVE_PATH = '/admin/system-prompt'
export const SYSTEM_PROMPT_TEXTAREA_CLASS = 'min-h-[24rem] w-full max-w-full resize-y rounded border border-admin px-3 py-2 font-mono text-xs md:text-sm'

export function getSystemPromptSaveErrorMessage(error) {
  const payload = error?.payload || {}
  return payload?.error || payload?.details || payload?.message || 'Unable to save system prompt.'
}
