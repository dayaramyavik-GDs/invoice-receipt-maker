// Writes a file to the app cache and opens Android's share sheet (WhatsApp, Gmail, Drive, Files…).
// In a desktop browser (dev only) it falls back to a normal download.
export async function shareFile(blob, filename) {
  const safeName = filename.replace(/[^\w.-]/g, '_');
  if (!window.cordova?.file || !window.plugins?.socialsharing) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: safeName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const dir = await new Promise((res, rej) => window.resolveLocalFileSystemURL(cordova.file.cacheDirectory, res, rej));
  const file = await new Promise((res, rej) => dir.getFile(safeName, { create: true }, res, rej));
  await new Promise((res, rej) => file.createWriter((w) => { w.onwriteend = res; w.onerror = rej; w.write(blob); }, rej));
  await new Promise((res, rej) => window.plugins.socialsharing.shareWithOptions(
    { files: [file.nativeURL], subject: safeName, chooserTitle: 'Share or save' }, res, rej));
}
