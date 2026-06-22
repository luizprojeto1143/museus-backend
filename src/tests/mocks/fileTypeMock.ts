// Jest mock for file-type package
export async function fileTypeFromBuffer(buffer: Buffer) {
  if (buffer && buffer.length > 4) {
    const hex = buffer.toString('hex', 0, 4).toUpperCase();
    if (hex.startsWith('89504E47')) {
      return { ext: 'png', mime: 'image/png' };
    }
    if (hex.startsWith('FFD8FF')) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
    if (hex.startsWith('47494638')) {
      return { ext: 'gif', mime: 'image/gif' };
    }
  }
  return {
    ext: 'jpg',
    mime: 'image/jpeg'
  };
}
