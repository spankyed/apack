/**
 * Local-tool socket client helpers for `@apackdev/testing` and `apack drive`.
 *
 * Reads `<userDataDir>/apack/api-runtime.json`, authenticates over the user-private local tool socket,
 * and exposes the multiplexed Control RPC lane (`HostControlContract`) and `@apackdev/link` lane.
 */
import { _appDirOf } from '@apackdev/sdk/env';
import {
  connectToolClient,
  inspectApiRuntime,
  readApiRuntime,
  type ApiRuntimeReadResult,
  type ApiRuntimeRecord,
  type ConnectToolClientOptions,
  type ToolClient,
} from '@apackdev/host/transport/tool-client';

export {
  connectToolClient,
  inspectApiRuntime,
  readApiRuntime,
  type ApiRuntimeReadResult,
  type ApiRuntimeRecord,
  type ConnectToolClientOptions,
  type ToolClient,
};

/** Reads the live `api-runtime.json` for an app running on `userDataDir`. */
export function readApiRuntimeIn(userDataDir: string): ApiRuntimeRecord | undefined {
  return readApiRuntime(_appDirOf(userDataDir));
}

/** Connects a local-tool Control/Link client to the app running on `userDataDir`. */
export function connectToolClientIn(
  userDataDir: string,
  options?: Omit<Extract<ConnectToolClientOptions, { readonly appDir: string }>, 'appDir'>,
): Promise<ToolClient> {
  return connectToolClient({
    ...options,
    appDir: _appDirOf(userDataDir),
  });
}
