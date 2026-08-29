export async function copyText(value: string) {
  if (!value) throw new Error('There is nothing to copy.');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Chromium can deny the async clipboard API without a persistent browser permission.
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.documentElement.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied)
    throw new Error('Clipboard access is unavailable. Select and copy the text manually.');
}
