import cp from 'child_process';
import fs from 'fs/promises';
import MongoDBCore from 'mongodb-core';
const { Server } = MongoDBCore;

export class ReplSet {
  #mongod;
  #replSet;
  #servers;

  constructor({ mongod, servers, replSet }) {
    this.#mongod = mongod ?? 'mongod';
    this.#replSet = replSet;
    this.#servers = servers.map(serverConfig => new ReplSetServer({
      mongod: this.#mongod,
      ...serverConfig,
      args: {
        ...serverConfig.args,
        replSet
      }
    }));
  }

  async purge() {
    await Promise.all(this.#servers.map(server => server.purge()));
  }

  async start() {
    await Promise.all(this.#servers.map(server => server.start()));
    await new Promise(resolve => setTimeout(resolve, 5000));
    await this.#servers[0].exec(
      'admin.$cmd',
      {
        replSetInitiate: {
          _id: this.#replSet,
          version: 1,
          members: this.#servers.map(({ args }, index) => ({
            _id: index + 1,
            host: `${ args.bind_ip }:${ args.port }`
          }))
        }
      }
    );
  }

  async stop() {
    await Promise.all(this.#servers.map(server => server.stop()));
  }
}

export class ReplSetServer {
  #mongod;
  #args;
  #process;

  get args() {
    return { ...this.#args };
  }

  constructor({ args, mongod }) {
    this.#args = { ...args };
    this.#mongod = mongod;

    if (!this.#args) {
      throw new Error('Missing args for mongo server');
    }

    if (!this.#args.dbpath) {
      throw new Error('Missing required option: dbpath');
    }
  }

  async exec(namespace, command) {
    // This was copied from mongodb-topology-manager but I'm not a fan of what
    // it is doing. Using a normal Client is likely much cleaner.
    return new Promise((resolve, reject) => {
      let cs = new Server({
        connectionTimeout: 30000,
        emitError: true,
        host: this.#args.bind_ip,
        pool: 1,
        port: this.#args.port,
        reconnect: false,
        socketTimeout: 0
      });

      cs.on('error', function(err) {
        reject(err);
      });

      cs.on('close', function(err) {
        reject(err);
      });

      cs.on('timeout', function(err) {
        reject(err);
      });

      cs.on('connect', function(_server) {
        cs.command(namespace, command, function(err, result) {
          cs.destroy();

          if (err && err.code !== 23) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });

      cs.connect();
    });
  }

  async purge() {
    await fs.rm(this.#args.dbpath, { force: true, recursive: true });
  }

  async start() {
    if (this.#process) {
      throw new Error('Server is already running');
    }

    try {
      await fs.access(this.#args.dbpath);
    } catch {
      await fs.mkdir(this.#args.dbpath, { recursive: true });
    }

    let args = Object.entries(this.#args).flatMap(([ key, val ]) => {
      if (val === true) {
        return [ `--${ key }` ];
      }

      if (!val) {
        return [];
      }

      return [ `--${ key }`, val ];
    });

    this.#process = cp.spawn(this.#mongod, args, { stdio: 'inherit' });

    this.#process.on('error', err => {
      console.error(err);
      this.#process = null;
    });
  }

  async stop() {
    if (!this.#process) {
      throw new Error('Server is not running');
    }

    let resolve;
    let promise = new Promise(r => resolve = r);

    this.#process.once('exit', () => {
      resolve();
    });

    this.#process.kill();
    this.#process = null;

    await promise;
  }
}
