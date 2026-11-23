# What a window reaches its backend over

Status: deferred, 2026-11-22. Not designed. It waits on [apack-state](../apack-state.md)'s host port, which puts the
app on [apack-link](https://github.com/spankyed/apack-link), and on one measurement. This records what would
change, what it would take, and what is not known.

## Where it stands

Read on `21f9f833fe`, 2026-11-22.

A window reaches the backend over a WebSocket to a TCP port on `127.0.0.1`. Electron main picks the port, starts
the server as a separate Node process (`spawn`, `packages/main/src/modules/api-server/ApiServer.ts`), and hands the
window the port and a token through the preload.

A port on the machine is a door anything on the machine can try. What the app has built to hold it shut and to
find it:

- a token made for each run, sent as a subprotocol so that it stays out of a URL a browser would print, and
  checked before a connection opens (`acceptsConnection`);
- a port file and a token file, private to the user, that local tools read (`apiPortFile`, `apiTokenFile`): the
  CLI's `dev`, `db`, `doctor` and profile commands, and the testing client;
- a client that reconnects when the server comes back on another port (`reconnectApiClient`).

Both ends are on one machine, and every message is put into JSON text and parsed again.

## What it would be

One protocol, a link's, over what suits whoever is connecting:

| Who connects | Over | In place of |
|---|---|---|
| The app's own windows | A message channel Electron makes between the window and the backend | The port, and a window's token |
| A tool on this machine | A Unix domain socket, or a named pipe on Windows, that only the user can open | The port file and the token file |
| Another machine, if there is ever one | A WebSocket | Nothing: this is what one is for |

A pack sees none of it. It asks, tells and follows a view, and which of these carried that is the host's to say.

What it buys:

- **No door.** Nothing listens that another program, or a web page, can reach. A window needs no token, since a
  channel handed to it is its own.
- **No port to pick, publish, or follow** when the server restarts.
- **A connection that ends when a process does** and for no other reason, where a socket can drop on its own.
- **Bytes without text**, for what is already bytes.

## What it would take

- **The link's own part** is in apack-link's plan, step 4: a message port and a socket are each something a link
  is carried on. A Unix socket is a stream of bytes with no edges between messages, so that one needs each text
  given its length. It is small, and is apack-link's.
- **The server as something Electron can hand a channel to.** A window and another process are joined by a
  message channel only where that process is one of Electron's own (`utilityProcess`). The server is started with
  `spawn` and a Node executable the app chooses, with an IPC channel it uses for one thing, hearing that its
  parent died. Either the server becomes a utility process, which runs on Electron's Node and not the chosen one,
  or main stands between the two and passes everything on, which puts every message through main's thread.
- **The tools on the local socket**: the CLI and the testing client open a path in the data dir where they now
  read a port and a token.
- **The preload** hands a window its channel where it now hands it a port and a token.

## What is not known

- **Whether it is faster.** A message channel copies a value structurally, and for a large plain object that is
  not always quicker than JSON. It has to be measured on what the app sends, a view of a few thousand rows and a
  streamed reply, before speed is given as a reason. The first three things above are reasons without it.
- **What the server loses as a utility process.** It runs a Node version the app picks, and loads elmdb's native
  binding and the terminal broker's client. Whether each loads under Electron's Node, on each platform, is to try.
- **Development.** `npm run dev` runs the server from source with a loader and restarts it on a change. What of
  that a utility process keeps is to read.
- **The pack frontends' own protocol** (`pack://`) and the development endpoints (`/dev/reload`, `/dev/install`)
  are HTTP on the same port today, and would need somewhere to go.

## What would make it worth starting

- The host is on a link, so that changing what carries it is changing one argument.
- And one of: the measurement says it is faster by enough to feel; or the door is to be shut for its own sake,
  which needs no measurement.

Until the host is on a link there is nothing to change the carrier of: tRPC's client is a WebSocket's.

## Who has done it

VS Code joins its windows to its extension host and its other processes with message ports, and keeps sockets for
a remote. Chromium's own processes talk over pipes it makes, never a port. An app that serves its own windows over
`localhost` is the less usual choice among desktop apps of this size.
