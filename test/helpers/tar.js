import { gzipSync } from "node:zlib";

export function makeTarball(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.text ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100);
    header.write("0000644\0", 100, 8);
    header.write((entry.declaredSize ?? data.length).toString(8).padStart(11, "0") + "\0", 124, 12);
    header.fill(32, 148, 156);
    header.write(entry.type ?? "0", 156, 1);
    if (entry.link) header.write(entry.link, 157, 100);
    header.write("ustar\0", 257, 6);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
