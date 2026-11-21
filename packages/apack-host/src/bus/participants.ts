// Names claimed by a connection rather than registered by a pack.
//
// A system and a surface are addressable because a pack declared them: the registry knows their refs and what
// events they take. A driver is neither — it is a process outside the app holding a connection — and that is the
// whole reason an agent had to reconstruct "was this for me?" from a correlation id. It could send, and nothing
// could send to it.
//
// A claim closes that with no new address grammar. `host/drive` is spelled like any other feature ref, so
// `splitRef`, `resolveName` and every gate that reads one keep working untaught, and `tell('host/drive',
// …)` resolves the way the rest do. What differs is only where the answer comes from: the registry for a pack's
// features, this for a claimed name.
//
// The caller is the drive engine (`apack-testing/src/engine/index.ts`), which claims `host/drive` once its own
// socket is open. `participants.spec.ts` covers the mechanism, including that an unclaimed name is still
// dropped; what it cannot reach is that caller, being a Playwright session in another package.
//
// **A claim lives exactly as long as its connection.** That is what makes it safe without a disconnect signal:
// the id it is keyed by is minted per WebSocket connection and dies with the socket, so a driver that goes away
// cannot keep a name, and one that reconnects claims again. `release` exists for the socket's own teardown, not
// as something a caller has to remember.
//
// A claim is keyed by a plain string rather than a `FeatureRef`, deliberately. `FeatureRef` is branded and
// "made only by `resolveName`", so narrowing an arbitrary string into one would defeat the brand at exactly the
// boundary it exists to guard. A claimed name arrives from a client, is checked against the ref grammar where it
// arrives (`bus.claim`), and is stored as what it is: a string that looked like a ref.
export interface ParticipantClaims {
  /**
   * Gives `ref` to `client`, or refuses when another live connection holds it.
   *
   * Refusing rather than taking it over is deliberate: a claim dies with its socket, so a reconnect always finds
   * the name free, and a collision therefore means two drivers are genuinely running. Letting the newest win
   * would make that look like it worked and send one of them another's answers.
   */
  claim(ref: string, client: string): { ok: true } | { ok: false; heldBy: string };
  /** Drops whatever `client` claimed. Called when its connection ends; safe for a connection that claimed nothing. */
  release(client: string): void;
  /** The connection that claimed `ref`, if one holds it. What the bus addresses an outgoing message to. */
  clientFor(ref: string): string | undefined;
}

/** A process's claims. An instance, like the pack registry: two of them share nothing. */
export function createParticipantClaims(): ParticipantClaims {
  const byRef = new Map<string, string>();

  return {
    claim(ref, client) {
      const holder = byRef.get(ref);
      if (holder !== undefined && holder !== client) return { ok: false, heldBy: holder };
      byRef.set(ref, client);
      return { ok: true };
    },
    release(client) {
      for (const [ref, holder] of byRef) if (holder === client) byRef.delete(ref);
    },
    clientFor(ref) {
      return byRef.get(ref);
    },
  };
}
