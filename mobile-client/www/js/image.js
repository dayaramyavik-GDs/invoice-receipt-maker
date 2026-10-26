// Shrinks logos so the database, sync payloads and PDFs stay small.
export function resizeImage(file, max = 400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = Object.assign(document.createElement('canvas'), {
        width: Math.round(img.width * scale), height: Math.round(img.height * scale),
      });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('That file is not a supported image'));
    img.src = URL.createObjectURL(file);
  });
}
