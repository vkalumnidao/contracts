# VK Alumni DAO contracts

Collection of TON smart contracts to run VK Alumni DAO

## Development

Install nodejs latest stable version.

Run `npm i` to install dependencies.
Run `make test` to run tests.

## Quirks

If you run tests not using `make` you should set env NODE_OPTIONS=--no-experimental-fetch, becaue in Node 18
experimtal fetch API broke emscripten (https://github.com/emscripten-core/emscripten/pull/16917).
