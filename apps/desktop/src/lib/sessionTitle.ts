/** Remove the exact managed-image transport suffix from catalogue titles. */
export function displaySessionTitle(title: string): string {
  const note = /\s*图片原文件（制作用，按附件顺序）：\s+[\s\S]*?[\\/]\.grok[\\/]sessions[\\/]grox-attachments[\\/][\s\S]*?附图为视觉预览，制作时使用原文件。\s*$/;
  const visible = title.replace(note, "");
  return visible.trim() ? visible.trimEnd() : "Untitled mission";
}
