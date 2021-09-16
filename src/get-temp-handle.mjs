import os from 'os';
import path from 'path';

export default function getTempHandle(...paths) {
  return path.join(os.tmpdir(), ...paths);
}
