// Decode invitation text only; never navigate to or fetch a QR's URL.
export function parseRoomCode(input) {
  let code = String(input || "").trim();
  if (/^(https?:|dglab4:)/i.test(code)) {
    try {
      const url = new URL(code);
      if (url.searchParams.get("action") !== "remote") throw new Error();
      code = url.searchParams.get("code") || "";
    } catch {
      throw new Error("请粘贴官方远程房间邀请链接");
    }
  }
  if (code.includes("#DGLAB-4#")) code = code.split("#DGLAB-4#")[1];
  if (!/^[A-Za-z0-9]{4,32}$/.test(code))
    throw new Error("请输入有效远程码，或粘贴完整邀请链接");
  return code;
}
