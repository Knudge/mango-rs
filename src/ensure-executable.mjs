import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import util from 'util';
import cp from 'child_process';
let exec = util.promisify(cp.exec);

import getTempHandle from './get-temp-handle.mjs';

export default async function ensureExecutable({ basePath, version }) {
  let { archive, baseURL, directory } = await getResourceNames({ version });
  let tempDirectory = getTempHandle(path.join('mango-rs', 'mango-rs'));
  let downloadURL = `${ baseURL }/${ archive }`;

  let downloadDirectory = path.join(tempDirectory, 'downloads');
  let installsDirectory = path.join(basePath, 'installs');

  let downloadPath = path.join(downloadDirectory, archive);
  let extractedPath = path.join(downloadDirectory, directory);
  let installPath = path.join(installsDirectory, version);

  for (let directory of [ downloadDirectory, installsDirectory ]) {
    try {
      await fs.access(directory);
    } catch (err) {
      await fs.mkdir(directory, { recursive: true });
    }
  }

  try {
    await Promise.any([
      fs.access(path.join(installPath, 'mongod')),
      fs.access(path.join(installPath, 'mongod.exe'))
    ]);

    // Already downloaded and installed
    return installPath;
  } catch {
    try {
      // Already created the folder
      await fs.access(installPath);
    } catch {
      await fs.mkdir(installPath);
    }
  }

  console.log(`Downloading MongoDB ${ version }...`);

  if (os.platform().startsWith('win')) {
    await exec('powershell.exe -nologo -noprofile -command "&{' +
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;' +
      `(New-Object Net.WebClient).DownloadFile('${
        downloadURL }', '${ downloadPath
      }');` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${
        downloadPath }', '${ downloadDirectory
      }');` +
    '}"');
  } else {
    console.log(`Downloading from ${ downloadURL } to ${ downloadPath }`);
    await exec(`curl -L ${ downloadURL } -o ${ downloadPath }`);
    await exec(`tar -zxvf ${ downloadPath } -C ${ downloadDirectory }`);
  }

  await fs.rm(installPath, { force: true, recursive: true });
  await fs.rename(
    path.join(downloadDirectory, directory, 'bin'),
    installPath
  );
  await fs.rm(extractedPath, { force: true, recursive: true });
  await fs.rm(downloadPath);

  return installPath;
}

async function getResourceNames({ version }) {
  let platform = os.platform();
  let [ archURL, archDir=archURL ] = getArch();

  switch (platform) {
    case 'linux': {
      let systemLinux = await getSystemLinux();
      return {
        archive: `mongodb-linux-${ archURL }-${ systemLinux }-${ version }.tgz`,
        baseURL: 'https://downloads.mongodb.org/linux',
        directory: `mongodb-linux-${ archDir }-${ systemLinux }-${ version }`
      };
    }
    case 'darwin':
      return {
        archive: `mongodb-macos-${ archURL }-${ version }.tgz`,
        baseURL: 'https://fastdl.mongodb.org/osx',
        directory: `mongodb-macos-${ archDir }-${ version }`
      };
    case 'win32':
      return {
        archive: `mongodb-windows-${ archURL }-${ version }.zip`,
        baseURL: 'https://downloads.mongodb.org/windows',
        directory: `mongodb-win32-${ archDir }-windows-${ version }`
      };
    default:
      throw new Error(`Unrecognized platform ${ platform }`);
  }
}

function getArch() {
  switch (process.arch) {
    case 'arm':
    case 'arm64':
      return [ 'arm64', 'aarch64' ];
    case 'x64':
      return [ 'x86_64' ];
  }

  throw new Error(`Unsupported architecture: ${ process.arch }`);
}

async function getSystemLinux() {
  let osRelease = '';

  try {
    osRelease = (await exec('cat /etc/os-release')).stdout;
  } catch (err) {
    console.error(err);
  }

  let [ name, version ] = getLinuxNameAndVersion(osRelease);

  if (!name || !version) {
    return 'ubuntu2004';
  }

  return `${ name }${ version }`;
}

function getLinuxNameAndVersion(osRelease) {
  let fullName = /NAME="([^"]+)"/.exec(osRelease)?.[1];
  let [ , vMajor, vMinor ] = /VERSION="(\d+)(?:\.(\d+))?/.exec(osRelease);
  let version = `${ vMajor ?? '' }${ vMinor ?? '' }`;

  let name = '';
  let versions = [];

  // Versions are static here but will change as mongodb adds binary support for
  // different distros. This reflects:
  // https://www.mongodb.com/try/download/community-kubernetes-operator
  if (/amazon/i.test(fullName)) {
    versions.push('2');
    name = 'amazon';
  } else if (/debian/i.test(fullName)) {
    versions.push('10');
    versions.push('11');
    name = 'debian';
  } else if (/cent|redhat|rhel/i.test(fullName)) {
    versions.push('7');
    versions.push('8');
    versions.push('82'); // ARM only
    name = 'rhel';
  } else if (/suse/i.test(fullName)) {
    versions.push('12');
    versions.push('15');
    name = 'suse';
  } else if (/ubuntu/i.test(fullName)) {
    versions.push('1804');
    versions.push('2004');
    name = 'ubuntu';
  }

  if (!versions.includes(version)) {
    // attempt latest version
    version = versions.at(-1);
  }

  return [ name, version ];
}
