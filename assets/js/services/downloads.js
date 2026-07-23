export function downloadText(fileName, text) {
  downloadBlob(
    fileName,
    new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' })
  );
}

export function downloadJson(fileName, value) {
  downloadBlob(
    fileName,
    new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json;charset=utf-8'
    })
  );
}

export function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
