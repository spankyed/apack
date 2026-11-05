export interface __PASCAL__ConnectedData {
  // Define connected data shape
}

// What anything outside this system may send it. SEND_STATE, CLIENT_CONNECTED, PACK_CHANGED, DATA_REPLACED,
// DATA_CHANGED_ELSEWHERE and FEATURE_SETTINGS_UPDATED are the app's, which every system receives, so no contract declares them.
export type Incoming__PASCAL__Events =
  | { type: '__REFRESH_EVENT__' };

export type Outgoing__PASCAL__Events =
  | { type: '__CONNECTED_EVENT__'; data: Record<string, unknown> };
