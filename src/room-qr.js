import { parseRoomCode } from "../shared/room-code.mjs";

export async function readRoomQr(file) {
  if (!file?.type.startsWith("image/")) throw new Error("请选择二维码图片");
  if (file.size > 12 * 1024 * 1024) throw new Error("图片过大，请裁剪到二维码区域");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error("图片无法读取，请换一张 PNG 或 JPEG 图片"); }
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 36000000)
      throw new Error("图片尺寸过大，请裁剪到二维码区域");
    const { default: jsQR } = await import("jsqr");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    // Two scales cover both screenshots and small saved QR images.
    for (const max of [1600, 2400]) {
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height);
      if (result) {
        try { return parseRoomCode(result.data); }
        catch { throw new Error("这张二维码不是有效的远程房间邀请"); }
      }
      if (scale === 1) break;
    }
    throw new Error("未识别到二维码，请使用清晰图片或裁剪后重试");
  } finally {
    URL.revokeObjectURL(url);
  }
}
