import { program } from 'commander';
import fs from 'fs/promises';
import mongodb from 'mongodb';
import { ReplSet } from './topology-manager.mjs';
import os from 'os';
import path from 'path';

import ensureExecutable from './ensure-executable.mjs';

let basePath = (() => {
  let platform = os.platform();

  switch (platform) {
    case 'win32': return path.join(
      process.env.APPDATA, 'mango-rs'
    );
    case 'darwin': return path.join(
      process.env.HOME, 'Library', 'Application Support', 'mango-rs'
    );
    default: return path.join(
      process.env.HOME, '.mango-rs'
    );
  }
})();

async function run() {
  const isWindows = os.platform() === 'win32';
  let { debug, fresh, version } = program
    .storeOptionsAsProperties(false)
    .requiredOption('-v, --version <version>', 'full version number of mongodb')
    .option('-d, --debug', 'log db operations to the console')
    .option('-f, --fresh', 'clear the database before running')
    .parse(process.argv)
    .opts();

  let dataPath = path.join(basePath, 'data');
  let hostname = isWindows ? os.hostname() : 'localhost';
  let installPath = await ensureExecutable({ basePath, version });
  let ports = [ '27017', '27018', '27019' ];
  let replicaSetName = 'rs';

  if (fresh) {
    await fs.rm(dataPath, { force: true, recursive: true });
  }

  try {
    await fs.access(dataPath);
  } catch {
    await fs.mkdir(dataPath, { recursive: true });
  }

  let serverDescriptors = ports.map(port => ({
    args: {
      ipv6: true,
      port: parseInt(port),
      dbpath: path.join(dataPath, port),
      // eslint-disable-next-line camelcase
      bind_ip: hostname
    }
  }));

  let mongod = path.join(installPath, 'mongod');

  let replicaSet = new ReplSet({
    mongod,
    servers: serverDescriptors,
    replSet: replicaSetName
  });

  if (fresh) {
    console.log('Clearing mango database...');
    await replicaSet.purge();
    console.log('Mango database reset.');
  }

  let client;
  let oplogCursor;

  let exit;
  let wantsToQuit = false;

  process.on('SIGINT', async () => {
    if (wantsToQuit) {
      return;
    }

    wantsToQuit = true;

    if (client) {
      console.log('Closing mango client...');
      await oplogCursor?.close();
      await client.close();
    }

    console.log('Stopping mango replica set...');
    await replicaSet.stop();
    exit ? exit() : process.exit(1);
  });

  const hosts = serverDescriptors.map(({ args }) =>
    `${ args.bind_ip }:${ args.port }`);
  let connectionString =
    `mongodb://${ hosts.join(',') }/?replicaSet=${ replicaSetName }`;

  console.log(`Starting mango replica set at ${ connectionString }`);
  console.log('Mango data stored in', dataPath);

  console.log(`Started replica set on "${ connectionString }"`);

  await replicaSet.start();

  if (debug) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    client = await mongodb.MongoClient.connect(`mongodb://${ hosts[0] }/`);

    oplogCursor = client
      .db('local')
      .collection('oplog.rs')
      .find({ ts: { $gte: new mongodb.Timestamp() } }, {
        tailable: true,
        awaitData: true,
        noCursorTimeout: true,
        numberOfRetries: 69
      })
      .stream();

    console.log('Connected to mango oplog');

    oplogCursor.on('end', () => {
      logTimestamped('MongoDB oplog finished');
    });

    const ops = {
      c: 'createCollection',
      d: 'delete',
      i: 'insert',
      u: 'update'
    };

    oplogCursor.on('data', data => {
      if (data.ns.match(/^(?:admin|config)\./)) {
        return;
      }

      const op = ops[data.op];

      if (!op) {
        return;
      }

      let log = JSON.stringify(data.o, null, 2);
      let metadata = data.o2 && JSON.stringify(data.o2, null, 2);

      if (metadata) {
        logTimestamped(op, log);
      } else {
        logTimestamped(op, metadata, log);
      }
    });
  }

  await new Promise(resolve => exit = resolve);
}

function logTimestamped(...messages) {
  console.log(new Date().toISOString(), ...messages);
}

await run();
