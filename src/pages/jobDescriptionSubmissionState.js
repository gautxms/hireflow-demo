export function shouldResetAfterSave({ isEditing, payload }) {
  return !isEditing && Boolean(payload?.item?.id)
}
