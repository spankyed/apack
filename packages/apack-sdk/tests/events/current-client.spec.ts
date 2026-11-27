import { describe, expect, it } from 'vitest';
import { _runDelivery } from '../../src/events/delivery.ts';
import { currentClient } from '../../src/events/index.ts';

describe('currentClient', () => {
  it('returns undefined outside any delivery scope', () => {
    expect(currentClient()).toBeUndefined();
  });

  it('returns the connection client id inside a connection-backed delivery scope', () => {
    const seen = _runDelivery(
      {
        receiver: 'default-setup/notes',
        asker: { kind: 'connection', ref: 'default-setup/notes', client: 'client-42' },
      },
      () => currentClient(),
    );

    expect(seen).toBe('client-42');
    expect(currentClient()).toBeUndefined();
  });

  it('returns undefined inside a delivery scope without a client connection', () => {
    expect(_runDelivery({ receiver: 'default-setup/notes' }, () => currentClient())).toBeUndefined();

    expect(
      _runDelivery(
        { receiver: 'default-setup/notes', asker: { kind: 'bus', ref: 'default-setup/brain' } },
        () => currentClient(),
      ),
    ).toBeUndefined();

    expect(
      _runDelivery(
        { receiver: 'default-setup/notes', asker: { kind: 'window', ref: 'default-setup/notes' } },
        () => currentClient(),
      ),
    ).toBeUndefined();
  });

  it('restores the enclosing delivery scope after nested calls and thrown errors', () => {
    _runDelivery(
      {
        receiver: 'default-setup/notes',
        asker: { kind: 'connection', ref: 'default-setup/notes', client: 'outer-client' },
      },
      () => {
        expect(currentClient()).toBe('outer-client');

        const inner = _runDelivery(
          {
            receiver: 'default-setup/code',
            asker: { kind: 'connection', ref: 'default-setup/code', client: 'inner-client' },
          },
          () => currentClient(),
        );
        expect(inner).toBe('inner-client');
        expect(currentClient()).toBe('outer-client');

        expect(() =>
          _runDelivery(
            {
              receiver: 'default-setup/code',
              asker: { kind: 'bus', ref: 'default-setup/brain' },
            },
            () => {
              expect(currentClient()).toBeUndefined();
              throw new Error('boom');
            },
          ),
        ).toThrow('boom');

        expect(currentClient()).toBe('outer-client');
      },
    );

    expect(currentClient()).toBeUndefined();
  });
});
