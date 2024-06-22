import { config as dotenvConfig } from 'dotenv'
import { hideBin } from 'yargs/helpers'
import _ from 'lodash'
import yargs from 'yargs'
import type { MiddlewareFunction } from 'yargs'

import { Blockchain, connectParachains, connectVertical, environment } from '@acala-network/chopsticks-core'
import { configSchema, fetchConfig, getYargsOptions } from './schema/index.js'
import { loadRpcMethodsByScripts, pluginExtendCli } from './plugins/index.js'
import { setupWithServer } from './index.js'

dotenvConfig()

const processArgv: MiddlewareFunction<{ config?: string; port?: number; unsafeRpcMethods?: string }> = async (argv) => {
  if (argv.unsafeRpcMethods) {
    await loadRpcMethodsByScripts(argv.unsafeRpcMethods)
  }
  if (argv.config) {
    Object.assign(argv, _.defaults(argv, await fetchConfig(argv.config)))
  }
  if (environment.PORT) {
    argv.port = Number(environment.PORT)
  }
}

const commands = yargs(hideBin(process.argv))
  .scriptName('chopsticks')
  .middleware(processArgv, false)
  .command(
    '*',
    'Dev mode, fork off a chain',
    (yargs) =>
      yargs
        .config(
          'config',
          'Path to config file with default options',
          () => ({}), // we load config in middleware
        )
        .options(getYargsOptions(configSchema.shape)),
    async (argv) => {
      await setupWithServer(configSchema.parse(argv))
    },
  )
  .command(
    'xcm',
    'XCM setup with relaychain and parachains',
    (yargs) =>
      yargs
        .options({
          relaychain: {
            desc: 'Relaychain config file path',
            string: true,
          },
          parachain: {
            desc: 'Parachain config file path',
            type: 'array',
            string: true,
            required: true,
          },
        })
        .alias('relaychain', 'r')
        .alias('parachain', 'p'),
    async (argv) => {
      const parachains: Blockchain[] = []
      for (const config of argv.parachain) {
        const { chain } = await setupWithServer(await fetchConfig(config))
        parachains.push(chain)
      }

      if (parachains.length > 1) {
        await connectParachains(parachains, environment.DISABLE_AUTO_HRMP)
      }

      if (argv.relaychain) {
        const { chain: relaychain } = await setupWithServer(await fetchConfig(argv.relaychain))
        for (const parachain of parachains) {
          await connectVertical(relaychain, parachain)
        }
      }
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .alias('version', 'v')
  .alias('config', 'c')
  .alias('endpoint', 'e')
  .alias('port', 'p')
  .alias('block', 'b')
  .alias('unsafe-rpc-methods', 'ur')
  .alias('import-storage', 's')
  .alias('wasm-override', 'w')
  .usage('Usage: $0 <command> [options]')
  .example('$0', '-c acala')

if (!environment.DISABLE_PLUGINS) {
  pluginExtendCli(
    commands.config(
      'config',
      'Path to config file with default options',
      () => ({}), // we load config in middleware
    ),
  ).then(() => commands.parse())
} else {
  commands.parse()
}
