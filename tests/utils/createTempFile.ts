import { v4 } from "uuid";
import * as os from "os";
import path from "path";
import { writeFile, unlink } from "fs/promises";

export async function createTempFile(ext: string) {
  let name = v4();
  let fullPath = path.resolve(os.tmpdir(), name + ext);
  await writeFile(fullPath, Buffer.alloc(0));
  return {
    name: fullPath,
    destroy: async () => {
      await unlink(fullPath);
    },
  };
}
